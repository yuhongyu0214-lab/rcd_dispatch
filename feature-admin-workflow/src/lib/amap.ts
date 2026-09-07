/**
 * 高德 API 封装 — 生产级实现
 *
 * 基于 docs/production-amap-strategy.md v1.0 的策略规范。
 * 支持地理编码缓存、路径规划、批量 ETA、限流重试。
 *
 * 环境变量：
 * - AMAP_SERVER_KEY：高德 Web 服务 API Key
 *
 * 注意：geocode_cache 表在 Prisma schema 定义后可用；
 * 若表不存在，自动回退到直接调用高德 API 不缓存。
 */

import { createLogger } from "@/lib/logger";
import type { DispatchCoordinate } from "@/lib/dispatch/types";

const log = createLogger("amap");

// ============================================================================
// 配置
// ============================================================================

const AMAP_BASE_URL = "https://restapi.amap.com/v3";
const GEOCODE_TIMEOUT_MS = 4000;
const DRIVING_TIMEOUT_MS = 5000;
const HEALTH_TIMEOUT_MS = 3000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

// Every real HTTP attempt (including retries and readiness probes) passes
// through this process-wide limiter. Gate 3 preproduction runs one app
// process, so spacing request starts is sufficient to keep the account at
// the approved safe ceiling without adding another infrastructure dependency.
const AMAP_REQUESTS_PER_SECOND = 3;
const REQUEST_START_INTERVAL_MS = Math.ceil(1000 / AMAP_REQUESTS_PER_SECOND);
const CONCURRENCY_LIMIT = 3;

// ============================================================================
// 类型定义
// ============================================================================

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeocodeResult {
  success: boolean;
  lat?: number;
  lng?: number;
  formattedAddress?: string;
  confidence?: number;
  failReason?: string;
}

export interface DrivingRouteResult {
  distance: number; // 米
  duration: number; // 秒
  polyline?: string;
  steps?: RouteStep[];
}

export interface RouteStep {
  instruction: string;
  road: string;
  distance: number;
}

export interface EtaResult {
  driverId: string;
  distance: number;
  duration: number;
  etaStatus: "NORMAL" | "EXCEEDED" | "FALLBACK" | "FAILED";
}

// 高德 API 原始响应类型
interface AmapGeocodeResponse {
  status: string;
  infocode: string;
  info: string;
  geocodes: Array<{
    location: string; // "lng,lat"
    formatted_address?: string;
    level?: string;
  }>;
}

interface AmapDrivingResponse {
  status: string;
  infocode: string;
  info: string;
  route: {
    paths: Array<{
      distance: string;
      duration: string;
      steps: Array<{
        instruction: string;
        road: string;
        distance: string;
      }>;
    }>;
  };
}

// ============================================================================
// 请求队列（简易并发控制）
// ============================================================================

interface QueueItem<T> {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

class AmapRequestQueue {
  private pending: QueueItem<unknown>[] = [];
  private activeCount = 0;
  private nextStartAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  get concurrency(): number {
    return this.activeCount;
  }

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.push({ fn, resolve, reject } as QueueItem<unknown>);
      this.flush();
    });
  }

  resetForTests(): void {
    if (this.pending.length > 0 || this.activeCount > 0) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.nextStartAt = 0;
  }

  private flush(): void {
    if (this.pending.length === 0 || this.activeCount >= CONCURRENCY_LIMIT) {
      return;
    }

    const now = Date.now();
    const waitMs = Math.max(0, this.nextStartAt - now);
    if (waitMs > 0) {
      if (!this.timer) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.flush();
        }, waitMs);
      }
      return;
    }

    const item = this.pending.shift();
    if (!item) return;

    this.activeCount += 1;
    this.nextStartAt = Math.max(this.nextStartAt, now) + REQUEST_START_INTERVAL_MS;

    Promise.resolve()
      .then(item.fn)
      .then(item.resolve, item.reject)
      .finally(() => {
        this.activeCount -= 1;
        this.flush();
      });

    // Schedule the next start independently of the current request's latency.
    this.flush();
  }
}

const requestQueue = new AmapRequestQueue();

/**
 * Run one real AMap Web Service HTTP attempt through the process-wide limiter.
 * All modules that use AMAP_SERVER_KEY must enter through this function so
 * route planning, readiness and geocoding share the same 3 QPS budget.
 */
export function scheduleAmapServerRequest<T>(
  request: () => Promise<T>
): Promise<T> {
  return requestQueue.enqueue(request);
}

/** Test isolation only; production callers must not reset the limiter. */
export function __resetAmapRateLimiterForTests(): void {
  if (process.env.NODE_ENV !== "test") return;
  requestQueue.resetForTests();
}

// ============================================================================
// 工具函数
// ============================================================================

function getAmapKey(): string | null {
  const key = process.env.AMAP_SERVER_KEY;
  if (!key) {
    log.warn("AMAP_SERVER_KEY not configured");
    return null;
  }
  return key;
}

function formatCoordinate(coord: LatLng): string {
  return `${coord.lng},${coord.lat}`;
}

function withTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
    }
  };
}

/**
 * 指数退避延迟
 */
function getRetryDelay(attempt: number): number {
  return RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
}

/**
 * 判断错误是否应重试
 */
function shouldRetry(status: number | undefined, infocode: string | undefined): boolean {
  // 网络错误（HTTP status 和高德 infocode 均缺失）可重试。
  // 明确的高德业务错误（例如配额耗尽）不得误判为网络故障。
  if (status === undefined && infocode === undefined) return true;
  // 5xx 可重试
  if (status !== undefined && status >= 500 && status < 600) return true;
  // Transient service/QPS errors may recover after bounded backoff. Explicit
  // daily quota and key errors (for example 10003) still fail immediately.
  if (infocode === "10021" || infocode === "30000") return true;
  return false;
}

// ============================================================================
// 内部 HTTP 调用（带重试）
// ============================================================================

async function fetchAmapApi<T>(
  path: string,
  params: Record<string, string>,
  timeoutMs: number
): Promise<T> {
  const key = getAmapKey();
  if (!key) {
    throw new Error("AMAP_SERVER_KEY not configured");
  }

  const url = new URL(`${AMAP_BASE_URL}${path}`);
  url.searchParams.set("key", key);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = getRetryDelay(attempt);
      log.info("amap_retry_attempt", {
        path,
        attempt: String(attempt),
        delayMs: String(delay)
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    try {
      const { response, payload } = await scheduleAmapServerRequest(async () => {
        const { signal, cleanup } = withTimeoutSignal(timeoutMs);
        try {
          const response = await fetch(url, {
            method: "GET",
            signal,
            cache: "no-store"
          });
          const payload = response.ok
            ? ((await response.json()) as {
                status?: string;
                infocode?: string;
              })
            : undefined;
          return { response, payload };
        } finally {
          cleanup();
        }
      });

      if (!response.ok) {
        const err = new Error(`AMAP_HTTP_${response.status}`);
        if (!shouldRetry(response.status, undefined)) {
          throw err;
        }
        lastError = err;
        continue;
      }

      if (payload?.status !== "1") {
        const err = new Error(`AMAP_API_ERROR_${payload?.infocode ?? "UNKNOWN"}`);
        if (!shouldRetry(undefined, payload?.infocode)) {
          throw err;
        }
        lastError = err;
        continue;
      }

      return payload as T;
    } catch (err) {
      // AbortError（超时）可重试
      if (err instanceof DOMException && err.name === "AbortError") {
        lastError = new Error("AMAP_TIMEOUT");
        continue;
      }

      // 网络错误可重试
      if (err instanceof TypeError) {
        lastError = err;
        continue;
      }

      throw err;
    }
  }

  // 所有重试耗尽
  log.warn("amap_retry_exhausted", {
    path,
    retries: String(MAX_RETRIES)
  });
  throw lastError ?? new Error("AMAP_REQUEST_FAILED");
}

/**
 * 高德 Web 服务就绪探针。
 *
 * 使用官方 IP 定位基础接口验证网络、Key 与服务响应，不执行路径规划，
 * 避免 readiness 消耗驾车路线配额或产生任何业务 ETA。
 */
export async function amapHealthCheck(): Promise<boolean> {
  const key = getAmapKey();
  if (!key) return false;

  const url = new URL(`${AMAP_BASE_URL}/ip`);
  url.searchParams.set("key", key);
  url.searchParams.set("ip", "114.247.50.2");

  try {
    const { response, payload } = await scheduleAmapServerRequest(async () => {
      const { signal, cleanup } = withTimeoutSignal(HEALTH_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          method: "GET",
          signal,
          cache: "no-store"
        });
        const payload = response.ok
          ? ((await response.json()) as {
              status?: string;
              infocode?: string;
            })
          : undefined;
        return { response, payload };
      } finally {
        cleanup();
      }
    });
    if (!response.ok) return false;
    return payload?.status === "1" && payload.infocode === "10000";
  } catch (error) {
    log.warn("amap_health_check_failed", {
      reason: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

// ============================================================================
// 地理编码缓存（通过 Prisma geocode_cache 表）
// ============================================================================

/**
 * 地址归一化。
 * 文档参考：production-amap-strategy 2.4 地址归一化规则
 */
function normalizeAddress(address: string): string {
  let normalized = address.trim();

  // 全角数字转半角
  normalized = normalized.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0)
  );

  // 全角字母转半角
  normalized = normalized.replace(/[Ａ-Ｚ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0)
  );
  normalized = normalized.replace(/[ａ-ｚ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0)
  );

  // 去尾部括号冗余词（如 "xxx（近地铁站）" → "xxx"）
  normalized = normalized.replace(/\s*[（(][^)）]*[)）]\s*$/, "");

  return normalized;
}

/**
 * 地理编码：地址 → 坐标。
 * 流程：先查 RDS geocode_cache → 未命中调高德 → 写入缓存
 * 文档参考：production-amap-strategy 2.2 调用流程
 */
export async function geocode(
  address: string,
  city?: string
): Promise<GeocodeResult> {
  const normalized = normalizeAddress(address);

  // 1. 先查 geocode_cache（RDS）
  try {
    // 动态 import prisma，避免循环依赖
    const { prisma } = await import("@/lib/prisma");

    // geocode_cache 表可能尚不存在（S2 阶段预留），做 try-catch 容错
    try {
      const cached = await (prisma as unknown as Record<string, unknown>)
        .geocodeCache
        ? await (prisma as unknown as {
            geocodeCache: {
              findUnique(args: {
                where: { normalizedAddress: string };
              }): Promise<{ lat: number; lng: number } | null>;
            };
          }).geocodeCache.findUnique({
            where: { normalizedAddress: normalized }
          })
        : null;

      if (cached) {
        log.info("amap_cache_hit", { key: "geocode", address: normalized });
        return {
          success: true,
          lat: cached.lat,
          lng: cached.lng,
          formattedAddress: normalized
        };
      }
    } catch {
      // geocode_cache 表不存在，回退到直接调高德
      log.info("geocode_cache table not found, falling back to direct API call");
    }
  } catch {
    // Prisma 导入失败（极端情况），回退到直接调高德
  }

  log.info("amap_cache_miss", { key: "geocode", address: normalized });

  // 2. 调用高德地理编码 API
  const params: Record<string, string> = { address: normalized };
  if (city) {
    params.city = city;
  }

  try {
    const result = await fetchAmapApi<AmapGeocodeResponse>(
      "/geocode/geo",
      params,
      GEOCODE_TIMEOUT_MS
    );

    const geocode = result.geocodes?.[0];
    if (!geocode?.location) {
      return {
        success: false,
        failReason: "GEOCODE_RESULT_EMPTY"
      };
    }

    const [lngStr, latStr] = geocode.location.split(",");
    const lng = Number(lngStr);
    const lat = Number(latStr);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return {
        success: false,
        failReason: "GEOCODE_COORDINATE_INVALID"
      };
    }

    // 3. 写入 geocode_cache（如果表存在）
    try {
      const { prisma } = await import("@/lib/prisma");
      try {
        const prismaWithCache = prisma as unknown as {
          geocodeCache: {
            upsert(args: {
              where: { normalizedAddress: string };
              create: Record<string, unknown>;
              update: Record<string, unknown>;
            }): Promise<void>;
          };
        };
        await prismaWithCache.geocodeCache.upsert({
          where: { normalizedAddress: normalized },
          create: {
            normalizedAddress: normalized,
            lat,
            lng
          },
          update: {
            lat,
            lng,
            updatedAt: new Date()
          }
        });
      } catch {
        // geocode_cache 表不存在，静默跳过
      }
    } catch {
      // Prisma 导入失败，静默跳过
    }

    // 根据高德返回的 level 估算 confidence
    let confidence: number | undefined;
    if (geocode.level) {
      const confidenceMap: Record<string, number> = {
        国家: 0.2,
        省: 0.3,
        城市: 0.5,
        区县: 0.6,
        乡镇: 0.7,
        村庄: 0.8,
        门址: 0.9,
        兴趣点: 1.0
      };
      confidence = confidenceMap[geocode.level] ?? undefined;
    }

    return {
      success: true,
      lat,
      lng,
      formattedAddress: geocode.formatted_address ?? normalized,
      confidence
    };
  } catch (err) {
    log.warn("import_geocode_failed", {
      address: normalized,
      reason: String(err)
    });
    return {
      success: false,
      failReason: `GEOCODE_FAILED: ${String(err)}`
    };
  }
}

// ============================================================================
// 驾车路径规划
// ============================================================================

/**
 * 驾车路径规划：两点之间距离和时间。
 * 文档参考：production-amap-strategy 3 路径规划与 ETA 策略、9.2 API 端点
 */
export async function drivingRoute(
  origin: LatLng,
  dest: LatLng
): Promise<DrivingRouteResult> {
  const result = await fetchAmapApi<AmapDrivingResponse>(
    "/direction/driving",
    {
      origin: formatCoordinate(origin),
      destination: formatCoordinate(dest),
      strategy: "0" // 速度优先
    },
    DRIVING_TIMEOUT_MS
  );

  const path = result.route?.paths?.[0];
  if (!path) {
    throw new Error("AMAP_NO_ROUTE_FOUND");
  }

  const distance = Number(path.distance);
  const duration = Number(path.duration);

  if (!Number.isFinite(distance) || !Number.isFinite(duration)) {
    throw new Error("AMAP_INVALID_ROUTE_DATA");
  }

  return {
    distance,
    duration,
    steps: path.steps?.map((step) => ({
      instruction: step.instruction,
      road: step.road,
      distance: Number(step.distance)
    }))
  };
}

// ============================================================================
// 批量 ETA
// ============================================================================

/**
 * 批量 ETA 计算：一个起点对多个终点的驾车时间。
 * 内部限流控制，失败返回降级结果。
 * 文档参考：production-amap-strategy 3.4 Top K 策略
 */
export async function batchEta(
  origin: LatLng,
  destinations: Array<{ driverId: string; coordinate: LatLng }>
): Promise<EtaResult[]> {
  if (destinations.length === 0) return [];

  const results: EtaResult[] = [];

  // 并发调用（由请求队列控制并发数）
  const promises = destinations.map(async (dest) => {
    try {
      const route = await drivingRoute(origin, dest.coordinate);
      const etaMinutes = Math.ceil(route.duration / 60);
      const etaStatus: EtaResult["etaStatus"] =
        etaMinutes >= 120 ? "EXCEEDED" : "NORMAL";

      return {
        driverId: dest.driverId,
        distance: route.distance,
        duration: route.duration,
        etaStatus
      } satisfies EtaResult;
    } catch (err) {
      log.warn("batchEta single failure", {
        driverId: dest.driverId,
        reason: String(err)
      });
      return {
        driverId: dest.driverId,
        distance: 0,
        duration: 0,
        etaStatus: "FAILED"
      } satisfies EtaResult;
    }
  });

  const settled = await Promise.allSettled(promises);

  for (const item of settled) {
    if (item.status === "fulfilled") {
      results.push(item.value);
    } else {
      // 理论上不应到达（每个 promise 内部已 catch）
      log.error("batchEta unexpected rejection", {
        reason: String(item.reason)
      });
    }
  }

  return results;
}

// ============================================================================
// 降级 ETA 估算（当高德不可用时）
// 与 lib/dispatch/eta.ts 中的 fallbackEtaByStatus 保持一致
// ============================================================================

/**
 * 基于司机状态的 ETA 降级估算。
 * 文档参考：production-amap-strategy 3.6 fallback 估算
 */
export function getFallbackEtaMinutes(
  driverStatus: string,
  driverId: string
): number {
  const fallbackByStatus: Record<string, number> = {
    S1: 18,
    S2: 28,
    S3: 42,
    S4: 58
  };

  // 其他状态（OFFLINE, UNAVAILABLE）返回不可达标记
  const base = fallbackByStatus[driverStatus];
  if (base === undefined) return 9999;

  // jitter 由 driverId 字符码稳定计算
  const jitter =
    driverId.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % 9;

  return base + jitter;
}

/**
 * ETA 转换为分钟（四舍五入）。
 */
export function durationToMinutes(seconds: number): number {
  return Math.ceil(seconds / 60);
}

// ============================================================================
// 便捷函数：单次 ETA 计算（供调度引擎使用）
// ============================================================================

/**
 * 单次 ETA 计算（origin → destination）。
 * 失败时返回 fallback 值。
 */
export async function getEtaMinutes(
  origin: LatLng | null,
  destination: LatLng,
  driverStatus: string,
  driverId: string
): Promise<{
  etaMinutes: number;
  distanceMeters: number;
  durationSeconds: number;
  etaStatus: "NORMAL" | "EXCEEDED" | "FALLBACK" | "FAILED";
}> {
  if (!origin) {
    const fallback = getFallbackEtaMinutes(driverStatus, driverId);
    return {
      etaMinutes: fallback,
      distanceMeters: 0,
      durationSeconds: 0,
      etaStatus: "FALLBACK"
    };
  }

  try {
    const route = await drivingRoute(origin, destination);
    const etaMinutes = durationToMinutes(route.duration);
    const etaStatus: "NORMAL" | "EXCEEDED" =
      etaMinutes >= 120 ? "EXCEEDED" : "NORMAL";

    return {
      etaMinutes,
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      etaStatus
    };
  } catch (err) {
    log.warn("dispatch_eta_degraded", {
      driverId,
      reason: String(err)
    });

    const fallback = getFallbackEtaMinutes(driverStatus, driverId);
    return {
      etaMinutes: fallback,
      distanceMeters: 0,
      durationSeconds: 0,
      etaStatus: "FALLBACK"
    };
  }
}

// ============================================================================
// 高德导航 URI 构造
// ============================================================================

/**
 * 构造高德地图导航 URI。
 * 文档参考：production-amap-strategy 4 导航与路径规划
 * 若提供 origin，生成带起点坐标的完整导航链接；否则仅带目标坐标。
 */
export function buildNavigationUri(target: LatLng, origin?: LatLng): string {
  let uri = `amapuri://route/plan/?dlat=${target.lat}&dlon=${target.lng}&dev=0`;
  if (origin) {
    uri += `&slat=${origin.lat}&slon=${origin.lng}`;
  }
  return uri;
}

// ============================================================================
// 启动时环境变量检查
// ============================================================================

const amapKey = process.env.AMAP_SERVER_KEY;
if (!amapKey) {
  log.warn("AMAP_SERVER_KEY not configured — Amap API features will be degraded");
}
