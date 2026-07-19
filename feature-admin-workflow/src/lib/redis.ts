/**
 * Tair/Redis 客户端 — 生产级实现
 *
 * 依赖：ioredis（需安装：pnpm add ioredis）
 * 环境变量：REDIS_URL (redis://user:pass@host:port)
 *
 * 基于 docs/production-tair-key-design.md v1.0 的 Key 设计规范。
 * 降级模式：Redis 不可用时所有读操作返回 null，写操作静默失败但 log warn。
 * 熔断器：连续 3 次失败后降级，30s 后探测恢复。
 */

import { createLogger } from "@/lib/logger";
import type { GeoPointV2 } from "@/types/v2";

const log = createLogger("redis");

/**
 * 实时键统一 TTL（秒）。
 * 冻结依据：数据架构 V2 §7.1「Redis 最新位置 TTL：180 秒」。
 * driver:last_location 与 driver:online 统一使用该值；
 * ETA / 地图快照 / 派单锁的 TTL 不属于实时键，各自维持原值。
 */
const REALTIME_TTL_SECONDS = 180;

// ============================================================================
// 类型定义
// ============================================================================

export interface DriverLocation {
  lat: string;
  lng: string;
  accuracy?: string;
  speed?: string;
  direction?: string;
  altitude?: string;
  ts: string;
  server_ts: string;
  /** 采集时间毫秒值（服务端解析 capturedAt 所得），CAS 单调比较专用 */
  ts_ms?: string;
  loc_type?: string;
  status: string;
}

/**
 * setDriverLocationIfNewer 的原子写入结果：
 * - applied：样本更新（严格更新于缓存中的 ts_ms），已写入并刷新 TTL
 * - duplicate：与缓存 ts_ms 相等，未写入
 * - stale：早于缓存 ts_ms（乱序样本），未写入，缓存不倒退
 * - unavailable：Redis 降级/异常，调用方应转数据库重判
 */
export type SetDriverLocationOutcome =
  | "applied"
  | "duplicate"
  | "stale"
  | "unavailable";

export interface EtaData {
  driverId: string;
  orderId: string;
  etaMinutes: number;
  distanceMeters: number;
  durationSeconds: number;
  etaStatus: "NORMAL" | "EXCEEDED" | "FALLBACK" | "FAILED";
  polyline?: string;
  amapReqId?: string;
  cachedAt: number;
}

export interface MapSnapshotOrder {
  orderId: string;
  lat: number;
  lng: number;
  status: string;
  type: string;
}

export interface MapSnapshotDriver {
  driverId: string;
  lat: number;
  lng: number;
  status: string;
  online: boolean;
}

export interface MapSnapshot {
  storeId: string;
  orders: MapSnapshotOrder[];
  drivers: MapSnapshotDriver[];
  generatedAt: number;
}

// ---------------------------------------------------------------------------
// Gate 3 — 资源锁与 ETA 原语类型
// ---------------------------------------------------------------------------

/** Tri-state lock acquisition result (2026-07-19 ruling). */
export type LockAcquireResult = "acquired" | "busy" | "unavailable";

/** ETA cache value keyed by normalized origin/dest hash + mode. */
export interface EtaCacheValueV2 {
  etaMinutes: number;
  distanceMeters: number;
  durationSeconds: number;
  polyline?: string;
  cachedAt: number;
}

/** Default ETA cache TTL (seconds). */
export const DEFAULT_ETA_TTL_SECONDS = 60;

// ============================================================================
// 连接管理
// ============================================================================

interface RedisCommand {
  (...args: unknown[]): unknown;
}

export interface PipelineLike {
  hgetall(key: string): void;
  exists(args: string[]): void;
  exec(): Promise<Array<[Error | null, unknown]>>;
}

export interface RedisClientLike {
  hset(key: string, ...args: string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
  set(key: string, value: string, ...args: (string | number)[]): Promise<"OK" | null>;
  get(key: string): Promise<string | null>;
  exists(key: string): Promise<number>;
  del(key: string): Promise<number>;
  ping(): Promise<string>;
  scan(cursor: string | number, options: { match: string; count: number }): Promise<[string, string[]]>;
  evalsha?(sha: string, numkeys: number, ...args: unknown[]): Promise<unknown>;
  eval?(script: string, numkeys: number, ...args: unknown[]): Promise<unknown>;
  pipeline(): PipelineLike;
  on(event: string, handler: (...args: unknown[]) => void): void;
  quit(): Promise<void>;
  status: string;
}

let redisClient: RedisClientLike | null = null;

// ============================================================================
// 熔断器（Circuit Breaker）
// ============================================================================

class RedisCircuitBreaker {
  private degraded = false;
  private failureCount = 0;
  private lastProbeTime = 0;
  private readonly PROBE_INTERVAL_MS = 30_000; // 30s
  private readonly MAX_FAILURES = 3;

  get isDegraded(): boolean {
    return this.degraded;
  }

  recordSuccess(): void {
    this.failureCount = 0;
  }

  recordFailure(): void {
    this.failureCount += 1;
    if (this.failureCount >= this.MAX_FAILURES) {
      this.degraded = true;
      log.warn("Circuit breaker opened — Redis degraded", {
        failureCount: this.failureCount
      });
    }
  }

  async probe(): Promise<void> {
    if (!this.degraded) return;
    if (Date.now() - this.lastProbeTime < this.PROBE_INTERVAL_MS) return;

    this.lastProbeTime = Date.now();
    const client = redisClient;
    if (!client) return;

    try {
      await client.ping();
      this.degraded = false;
      this.failureCount = 0;
      log.info("Circuit breaker reset — Redis recovered");
    } catch {
      // 保持降级，下次探测间隔后再试
    }
  }

  /** 测试专用：复位熔断器状态（生产代码不得调用） */
  resetForTests(): void {
    this.degraded = false;
    this.failureCount = 0;
    this.lastProbeTime = 0;
  }
}

const circuitBreaker = new RedisCircuitBreaker();

// ============================================================================
// 连接管理函数
// ============================================================================

/**
 * 获取 Redis 客户端单例。
 * 使用动态 require 加载 ioredis，避免未安装依赖时启动失败。
 * 未配置 REDIS_URL 时返回 null，系统降级运行。
 */
function getRedisClientInternal(): RedisClientLike | null {
  if (redisClient) return redisClient;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    log.warn("REDIS_URL not configured — Redis features will be degraded");
    return null;
  }

  // ioredis 需通过 pnpm add ioredis 安装
  // 使用 try-catch 包裹动态 require，避免未安装时启动崩溃
  try {
    // eslint-disable-next-line
    const Redis = require("ioredis") as { default?: new (...args: unknown[]) => RedisClientLike } & (new (...args: unknown[]) => RedisClientLike);
    const RedisCtor =
      typeof Redis === "function"
        ? Redis
        : (Redis as { default: new (...args: unknown[]) => RedisClientLike }).default;

    redisClient = new RedisCtor(redisUrl, {
      // 连接池配置
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        if (times > 5) return null; // 停止重试
        return Math.min(times * 200, 2000);
      },
      connectTimeout: 5000,
      commandTimeout: 3000,
      reconnectOnError(err: Error) {
        const targetErrors = ["READONLY", "CONNECTION_BROKEN"];
        return targetErrors.some((e) => err.message.includes(e));
      },
      enableOfflineQueue: false, // 故障时快速失败
      lazyConnect: true
    }) as RedisClientLike;

    redisClient.on("error", (...args: unknown[]) => {
      const err = args[0];
      log.error("Redis connection error", {
        message: err instanceof Error ? err.message : String(err)
      });
    });

    redisClient.on("connect", () => {
      log.info("Redis connected");
    });

    // 异步连接
    setImmediate(() => {
      if (redisClient) {
        redisClient.ping().catch(() => {
          /* 连接失败由熔断器处理 */
        });
      }
    });

    return redisClient;
  } catch {
    log.warn("ioredis not installed — run: pnpm add ioredis. Redis features degraded.");
    return null;
  }
}

/**
 * 获取 Redis 客户端。
 * 熔断器开启时返回 null，避免无效连接尝试。
 */
function getRedisClient(): RedisClientLike | null {
  if (circuitBreaker.isDegraded) {
    // 触发探测
    circuitBreaker.probe().catch(() => {
      /* 探测失败无影响 */
    });
    return null;
  }
  return getRedisClientInternal();
}

/**
 * 检查 Redis 是否可用（轻量级，不做 ping）。
 * 返回 false 表示 Redis 不可用，调用方应降级处理。
 */
export function isRedisAvailable(): boolean {
  return !circuitBreaker.isDegraded && getRedisClientInternal() !== null;
}

/**
 * Redis 健康检查。
 * 返回 true 表示 Redis 可用。
 */
export async function redisHealthCheck(): Promise<boolean> {
  const client = getRedisClientInternal();
  if (!client) return false;

  try {
    await client.ping();
    circuitBreaker.recordSuccess();
    return true;
  } catch {
    circuitBreaker.recordFailure();
    return false;
  }
}

/**
 * 优雅关闭 Redis 连接。
 */
export async function closeRedis(): Promise<void> {
  if (!redisClient) return;

  try {
    await redisClient.quit();
    log.info("Redis connection closed");
  } catch (err) {
    log.warn("Redis close error", { message: String(err) });
  } finally {
    redisClient = null;
  }
}

/**
 * 测试专用：注入伪客户端并复位熔断器。
 * 传 null 可回到「无客户端（降级）」状态。生产代码不得调用。
 */
export function __setRedisClientForTests(client: RedisClientLike | null): void {
  redisClient = client;
  circuitBreaker.resetForTests();
}

// ============================================================================
// 写操作保护（降级模式下静默失败）
// ============================================================================

/**
 * 执行 Redis 写操作。
 * 降级模式下静默失败，记录 warn 日志。
 */
async function safeWrite(
  operation: string,
  keyPattern: string,
  fn: (client: RedisClientLike) => Promise<unknown>
): Promise<void> {
  const client = getRedisClient();
  if (!client) {
    log.warn(`Redis write degraded: ${operation}`, { keyPattern });
    return;
  }

  try {
    await fn(client);
    circuitBreaker.recordSuccess();
  } catch (err) {
    circuitBreaker.recordFailure();
    log.warn(`Redis write failed: ${operation}`, {
      keyPattern,
      error: String(err)
    });
  }
}

/**
 * 执行 Redis 读操作。
 * 降级模式或读取失败时返回 null。
 */
async function safeRead<T>(
  operation: string,
  keyPattern: string,
  fn: (client: RedisClientLike) => Promise<T | null>
): Promise<T | null> {
  const client = getRedisClient();
  if (!client) return null;

  try {
    const result = await fn(client);
    circuitBreaker.recordSuccess();
    return result;
  } catch (err) {
    circuitBreaker.recordFailure();
    log.warn(`Redis read failed: ${operation}`, {
      keyPattern,
      error: String(err)
    });
    return null;
  }
}

// ============================================================================
// Key 操作函数 — 司机位置 (driver:last_location:{driverId})
// 文档参考：tair-key-design 4.1 节
// ============================================================================

/**
 * 将 DriverLocation 编组为 HSET 的扁平 field/value 序列。
 * setDriverLocation 与 setDriverLocationIfNewer 共用，保证字段口径一致。
 */
function buildLocationFields(data: DriverLocation): string[] {
  const fields: string[] = [];
  if (data.lat) fields.push("lat", data.lat);
  if (data.lng) fields.push("lng", data.lng);
  if (data.accuracy) fields.push("accuracy", data.accuracy);
  if (data.speed) fields.push("speed", data.speed);
  if (data.direction) fields.push("direction", data.direction);
  if (data.altitude) fields.push("altitude", data.altitude);
  if (data.ts) fields.push("ts", data.ts);
  if (data.server_ts) fields.push("server_ts", data.server_ts);
  if (data.ts_ms) fields.push("ts_ms", data.ts_ms);
  if (data.loc_type) fields.push("loc_type", data.loc_type);
  if (data.status) fields.push("status", data.status);
  return fields;
}

/**
 * 写入司机位置（HSET + EXPIRE）。
 * 文档参考：tair-key-design 4.1.3 写入命令
 *
 * 注意：本函数为无条件覆盖写，不维护 ts_ms、不做单调保护，仅供 V1 遗留
 * 路径使用；V2 位置上报必须使用 setDriverLocationIfNewer（原子单调）。
 */
export async function setDriverLocation(
  driverId: string,
  data: DriverLocation
): Promise<void> {
  await safeWrite("setDriverLocation", `driver:last_location:{${driverId}}`, async (client) => {
    const fields = buildLocationFields(data);

    // 先 HMSET（新版 ioredis 也支持 hset 多参数）
    await client.hset(`driver:last_location:${driverId}`, ...fields);
    await client.expire(`driver:last_location:${driverId}`, REALTIME_TTL_SECONDS);
  });
}

// Lua：原子「读 ts_ms → 比较 → 写入 + EXPIRE」。
// KEYS[1] = driver:last_location:{driverId}
// ARGV[1] = 新样本 capturedAt 毫秒值；ARGV[2] = TTL 秒；ARGV[3..] = field/value 对
// 返回：1 = applied；0 = duplicate（相等）；-1 = stale（更旧）
// 旧 hash 无 ts_ms（V1 遗留写入）按可覆盖处理，随 TTL 自然收敛。
export const SET_LOCATION_IF_NEWER_SCRIPT = `
  local existing = tonumber(redis.call('HGET', KEYS[1], 'ts_ms'))
  local incoming = tonumber(ARGV[1])
  if existing then
    if incoming < existing then return -1 end
    if incoming == existing then return 0 end
  end
  redis.call('HSET', KEYS[1], unpack(ARGV, 3))
  redis.call('EXPIRE', KEYS[1], ARGV[2])
  return 1
`;

/**
 * 原子单调写入司机位置（Lua CAS）。
 *
 * 契约依据：数据架构 V2 §7「司机最新位置：Redis 主存」——并发/乱序样本
 * 不得让缓存位置倒退；§7.1 冻结 TTL 180 秒。比较、写入与 EXPIRE 在同一
 * Lua 脚本内完成，不存在「读旧值→判断→HSET」的竞态窗口。
 *
 * @param tsMs 服务端解析 capturedAt 所得毫秒值（比较键）
 * 降级/异常返回 "unavailable"，不抛错；调用方转数据库高水位重判。
 */
export async function setDriverLocationIfNewer(
  driverId: string,
  data: DriverLocation,
  tsMs: number
): Promise<SetDriverLocationOutcome> {
  const client = getRedisClient();
  if (!client || typeof client.eval !== "function") {
    // 无 eval 能力时不做非原子退化写入——那会静默重引入倒退窗口
    return "unavailable";
  }

  const key = `driver:last_location:${driverId}`;
  const fields = buildLocationFields({ ...data, ts_ms: String(tsMs) });

  try {
    const result = await client.eval(
      SET_LOCATION_IF_NEWER_SCRIPT,
      1,
      key,
      String(tsMs),
      String(REALTIME_TTL_SECONDS),
      ...fields
    );
    circuitBreaker.recordSuccess();

    if (result === 1) return "applied";
    if (result === 0) return "duplicate";
    if (result === -1) return "stale";

    log.warn("setDriverLocationIfNewer unexpected script result", {
      driverId,
      result: String(result)
    });
    return "unavailable";
  } catch (err) {
    circuitBreaker.recordFailure();
    log.warn("setDriverLocationIfNewer failed", {
      keyPattern: `driver:last_location:{${driverId}}`,
      error: String(err)
    });
    return "unavailable";
  }
}

/**
 * 读取司机位置（HGETALL）。
 * 文档参考：tair-key-design 4.1.4 读取命令
 */
export async function getDriverLocation(
  driverId: string
): Promise<DriverLocation | null> {
  return safeRead("getDriverLocation", `driver:last_location:{${driverId}}`, async (client) => {
    const data = await client.hgetall(`driver:last_location:${driverId}`);
    if (!data || Object.keys(data).length === 0) return null;
    return data as unknown as DriverLocation;
  });
}

/** getDriverLocationsWithStatus 的返回结构：整体可用性 + 逐司机位置 */
export interface DriverLocationsBatch {
  /**
   * false = Redis 整体不可用（降级、无客户端或管道整体失败），
   * 此时 locations 全部为 null，调用方应整体回退数据库；
   * true = Redis 正常，Map 中 null 表示该司机确实没有位置键（个体缺失）。
   */
  redisAvailable: boolean;
  locations: Map<string, DriverLocation | null>;
}

/**
 * 批量读取司机位置（Pipeline HGETALL），并区分两种缺失：
 * 「Redis 正常但某司机无位置」与「Redis 整体不可用」。
 * 文档参考：tair-key-design 9.2 Pipeline 使用规范
 */
export async function getDriverLocationsWithStatus(
  driverIds: string[]
): Promise<DriverLocationsBatch> {
  const locations = new Map<string, DriverLocation | null>();

  if (driverIds.length === 0) {
    return { redisAvailable: isRedisAvailable(), locations };
  }

  const client = getRedisClient();
  if (!client) {
    // 降级：整体不可用
    driverIds.forEach((id) => locations.set(id, null));
    return { redisAvailable: false, locations };
  }

  try {
    // 分批处理，每批不超过 200 条命令
    const BATCH_SIZE = 200;
    for (let i = 0; i < driverIds.length; i += BATCH_SIZE) {
      const batch = driverIds.slice(i, i + BATCH_SIZE);
      const pipeline = client.pipeline();

      for (const driverId of batch) {
        pipeline.hgetall(`driver:last_location:${driverId}`);
      }

      const results = await pipeline.exec();
      if (!results) {
        batch.forEach((id) => locations.set(id, null));
        continue;
      }

      batch.forEach((driverId, index) => {
        const [err, data] = results[index] ?? [null, null];
        if (!err && data && typeof data === "object" && Object.keys(data as Record<string, unknown>).length > 0) {
          locations.set(driverId, data as unknown as DriverLocation);
        } else {
          // 单命令错误按个体缺失处理，不影响整体可用性判定
          locations.set(driverId, null);
        }
      });
    }

    circuitBreaker.recordSuccess();
    return { redisAvailable: true, locations };
  } catch (err) {
    circuitBreaker.recordFailure();
    log.warn("Batch getDriverLocationsWithStatus failed", { error: String(err) });
    driverIds.forEach((id) => locations.set(id, null));
    return { redisAvailable: false, locations };
  }
}

/**
 * 批量读取司机位置（兼容入口）。
 * 不区分「个体缺失」与「整体不可用」，两者均为 null；
 * 需要区分时请使用 getDriverLocationsWithStatus。
 */
export async function getDriverLocations(
  driverIds: string[]
): Promise<Map<string, DriverLocation | null>> {
  const { locations } = await getDriverLocationsWithStatus(driverIds);
  return locations;
}

// ============================================================================
// Key 操作函数 — 司机在线状态 (driver:online:{driverId})
// 文档参考：tair-key-design 4.2 节
// ============================================================================

/**
 * 设置司机在线状态（SET + EXPIRE）。
 * 文档参考：tair-key-design 4.2.3 写入命令
 */
export async function setDriverOnline(driverId: string): Promise<void> {
  const ts = String(Date.now());
  await safeWrite("setDriverOnline", `driver:online:{${driverId}}`, async (client) => {
    await client.set(`driver:online:${driverId}`, ts, "EX", REALTIME_TTL_SECONDS);
  });
}

/**
 * 检查司机是否在线（EXISTS）。
 * 文档参考：tair-key-design 4.2.4 读取命令
 */
export async function isDriverOnline(driverId: string): Promise<boolean> {
  const result = await safeRead("isDriverOnline", `driver:online:{${driverId}}`, async (client) => {
    const count = await client.exists(`driver:online:${driverId}`);
    return count === 1;
  });
  return result ?? false;
}

/**
 * 获取所有在线司机 ID 列表（SCAN）。
 * 文档参考：tair-key-design 4.2.4 批量检查
 */
export async function getOnlineDriverIds(): Promise<string[]> {
  const client = getRedisClient();
  if (!client) return [];

  const driverIds: string[] = [];
  let cursor = "0";

  try {
    do {
      const [nextCursor, keys] = await client.scan(cursor, {
        match: "driver:online:*",
        count: 200
      });
      cursor = nextCursor;

      for (const key of keys) {
        const prefix = "driver:online:";
        const driverId = (key as string).replace(prefix, "");
        if (driverId) {
          driverIds.push(driverId);
        }
      }
    } while (cursor !== "0");

    circuitBreaker.recordSuccess();
    return driverIds;
  } catch (err) {
    circuitBreaker.recordFailure();
    log.warn("getOnlineDriverIds SCAN failed", { error: String(err) });
    return [];
  }
}

// ============================================================================
// Key 操作函数 — ETA 缓存 (eta:{orderId}:{driverId}:driving)
// 文档参考：tair-key-design 4.3 节
// ============================================================================

/**
 * 缓存 ETA 数据（SET JSON + EXPIRE）。
 * 文档参考：tair-key-design 4.3.3 写入命令
 */
export async function cacheEta(
  orderId: string,
  driverId: string,
  etaData: EtaData
): Promise<void> {
  await safeWrite("cacheEta", `eta:{${orderId}}:{${driverId}}:driving`, async (client) => {
    const json = JSON.stringify(etaData);
    await client.set(`eta:${orderId}:${driverId}:driving`, json, "EX", 60);
  });
}

/**
 * 读取缓存的 ETA 数据（GET + JSON.parse）。
 * 文档参考：tair-key-design 4.3.5 读取策略
 */
export async function getCachedEta(
  orderId: string,
  driverId: string
): Promise<EtaData | null> {
  return safeRead("getCachedEta", `eta:{${orderId}}:{${driverId}}:driving`, async (client) => {
    const raw = await client.get(`eta:${orderId}:${driverId}:driving`);
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as EtaData;
      // 检查缓存时效性（不超过 50 秒）
      const age = Date.now() - parsed.cachedAt;
      if (age > 50_000) return null;
      if (parsed.etaStatus === "FAILED") return null;
      return parsed;
    } catch {
      return null;
    }
  });
}

// ============================================================================
// Gate 3 — ETA 原语（基于规范化起终点哈希，替换 orderId:driverId 键）
// ============================================================================

/**
 * Normalize a GeoPointV2 into a stable hash for ETA cache keys.
 *
 * Rounds to 6 decimal places (~0.1 m precision) so cache keys are stable
 * across minor coordinate representation differences while preserving
 * practical equality.
 */
export function normalizePointHash(point: GeoPointV2): string {
  const lat = point.lat.toFixed(6);
  const lng = point.lng.toFixed(6);
  return `${lat},${lng}`;
}

/**
 * Cache ETA value keyed by normalized origin/dest hash + mode.
 *
 * Key format: `eta:{originHash}:{destHash}:{mode}`
 *
 * Frozen constraint (2026-07-19 ruling): uses normalized origin/dest hash
 * and travel mode; default TTL 60s.
 */
export async function cacheEtaV2(
  originHash: string,
  destinationHash: string,
  mode: string,
  value: EtaCacheValueV2,
  ttlSeconds: number = DEFAULT_ETA_TTL_SECONDS
): Promise<void> {
  const key = `eta:${originHash}:${destinationHash}:${mode}`;
  await safeWrite("cacheEtaV2", key, async (client) => {
    const json = JSON.stringify(value);
    await client.set(key, json, "EX", ttlSeconds);
  });
}

/**
 * Read cached ETA value by normalized origin/dest hash + mode.
 *
 * Frozen constraint (2026-07-19 ruling): Redis unavailable → return null
 * (no fake ETA). Entries older than 50 seconds or with FAILED status are
 * treated as stale.
 */
export async function getCachedEtaV2(
  originHash: string,
  destinationHash: string,
  mode: string
): Promise<EtaCacheValueV2 | null> {
  const key = `eta:${originHash}:${destinationHash}:${mode}`;
  return safeRead("getCachedEtaV2", key, async (client) => {
    const raw = await client.get(key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as EtaCacheValueV2;
      const age = Date.now() - parsed.cachedAt;
      if (age > 50_000) return null;
      return parsed;
    } catch {
      return null;
    }
  });
}

// ============================================================================
// Key 操作函数 — 派单调 (dispatch:lock:{orderId})
// 文档参考：tair-key-design 4.4 节
// ============================================================================

// Lua 脚本 SHA 缓存
let releaseLockSha: string | null = null;

const RELEASE_LOCK_SCRIPT = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
  else
    return 0
  end
`;

/**
 * 获取派单调（SET NX EX）。
 *
 * @deprecated Use {@link acquireResourceLock} instead. The new primitive takes a
 *             caller-generated token and returns a tri-state result
 *             ("acquired" | "busy" | "unavailable"). This wrapper uses
 *             globalThis.__traceId and returns boolean for backward
 *             compatibility.
 *
 * 文档参考：tair-key-design 4.4.3 写入命令
 * 返回 true 表示获取锁成功。
 */
export async function acquireDispatchLock(
  orderId: string,
  ttlSec = 10
): Promise<boolean> {
  const client = getRedisClient();
  if (!client) {
    // 降级：跳过 Redis 锁，依赖 Prisma 乐观锁
    return true;
  }

  const traceId = (globalThis as { __traceId?: string }).__traceId ?? "unknown";

  try {
    const result = await client.set(
      `dispatch:lock:${orderId}`,
      traceId,
      "NX",
      "EX",
      ttlSec
    );
    circuitBreaker.recordSuccess();
    return result === "OK";
  } catch (err) {
    circuitBreaker.recordFailure();
    log.warn("acquireDispatchLock failed, falling back to DB optimistic lock", {
      orderId,
      error: String(err)
    });
    // 降级：Redis 不可用时返回 true，依赖 Prisma 乐观锁
    return true;
  }
}

/**
 * 释放派单调（Lua 脚本安全释放）。
 *
 * @deprecated Use {@link releaseResourceLock} instead. The new primitive takes a
 *             caller-generated token and NEVER falls back to bare DEL — when
 *             token comparison is impossible, it lets TTL expire naturally.
 *
 * 文档参考：tair-key-design 4.4.4 释放命令
 */
export async function releaseDispatchLock(orderId: string): Promise<void> {
  const client = getRedisClient();
  if (!client) return;

  const traceId = (globalThis as { __traceId?: string }).__traceId ?? "unknown";

  try {
    // 使用 Lua 脚本确保只释放自己持有的锁
    if (typeof client.eval === "function") {
      await client.eval(RELEASE_LOCK_SCRIPT, 1, `dispatch:lock:${orderId}`, traceId);
    } else {
      // 降级：直接 DEL（风险较低，因为 TTL 只有 10s）
      await client.del(`dispatch:lock:${orderId}`);
    }
    circuitBreaker.recordSuccess();
  } catch (err) {
    // 释放失败可接受，TTL 10s 后自动过期
    log.warn("releaseDispatchLock failed (will expire automatically)", {
      orderId,
      error: String(err)
    });
  }
}

// ============================================================================
// Gate 3 — 资源锁原语（替换 acquireDispatchLock / releaseDispatchLock）
// ============================================================================

const RESOURCE_LOCK_RELEASE_SCRIPT = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
  else
    return 0
  end
`;

/**
 * Acquire a named resource lock with a caller-generated token.
 *
 * Frozen constraints (2026-07-19 ruling):
 *  1. Token is generated by the CALLER — no globalThis.__traceId.
 *  2. Returns tri-state: "acquired" | "busy" | "unavailable".
 *     "unavailable" means Redis is down — the caller MUST degrade to DB
 *     optimistic locking, never pretend the lock was acquired.
 *
 * @param resourceKey - Unique key for the resource (e.g. `dispatch:lock:${orderId}`)
 * @param token - Opaque token generated by the caller (e.g. `crypto.randomUUID()`)
 * @param ttlSeconds - Lock TTL in seconds (default 10)
 */
export async function acquireResourceLock(
  resourceKey: string,
  token: string,
  ttlSeconds = 10
): Promise<LockAcquireResult> {
  const client = getRedisClient();
  if (!client) return "unavailable";

  try {
    const result = await client.set(resourceKey, token, "NX", "EX", ttlSeconds);
    circuitBreaker.recordSuccess();
    return result === "OK" ? "acquired" : "busy";
  } catch (err) {
    circuitBreaker.recordFailure();
    log.warn("acquireResourceLock failed", { resourceKey, error: String(err) });
    return "unavailable";
  }
}

/**
 * Release a named resource lock.
 *
 * NEVER calls DEL without token comparison. When token comparison is
 * impossible (no eval), lets TTL expire naturally — bare DEL could
 * release someone else's lock.
 *
 * @param resourceKey - The resource key used during acquire
 * @param token - The same token used during acquire
 */
export async function releaseResourceLock(
  resourceKey: string,
  token: string
): Promise<void> {
  const client = getRedisClient();
  if (!client) return;

  if (typeof client.eval !== "function") {
    // Cannot safely compare tokens without eval — do NOT fall back to bare DEL.
    // TTL will expire the lock naturally.
    log.warn("releaseResourceLock: no eval capability, deferring to TTL expiry", { resourceKey });
    return;
  }

  try {
    await client.eval(RESOURCE_LOCK_RELEASE_SCRIPT, 1, resourceKey, token);
    circuitBreaker.recordSuccess();
  } catch (err) {
    // Release failure is acceptable — TTL will expire the lock.
    log.warn("releaseResourceLock failed (will expire via TTL)", {
      resourceKey,
      error: String(err),
    });
  }
}

/**
 * Acquire multiple resource locks with deadlock prevention.
 *
 * Resources are sorted lexicographically for acquire and released in reverse
 * order on partial failure. This prevents circular-wait deadlocks.
 *
 * @returns Map of resourceKey → "acquired" | "busy" | "unavailable"
 */
export async function acquireResourceLocks(
  resources: Array<{ resourceKey: string; token: string; ttlSeconds?: number }>
): Promise<Map<string, LockAcquireResult>> {
  const results = new Map<string, LockAcquireResult>();
  // Sort for deadlock prevention (canonical ordering)
  const sorted = [...resources].sort((a, b) =>
    a.resourceKey.localeCompare(b.resourceKey)
  );

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const result = await acquireResourceLock(r.resourceKey, r.token, r.ttlSeconds ?? 10);
    results.set(r.resourceKey, result);
    if (result !== "acquired") {
      // Release any locks we already acquired (reverse order)
      for (let j = i - 1; j >= 0; j--) {
        await releaseResourceLock(sorted[j].resourceKey, sorted[j].token);
      }
      break;
    }
  }
  return results;
}

// ============================================================================
// Key 操作函数 — 地图快照 (map:snapshot:{storeId})
// 文档参考：tair-key-design 4.5 节
// ============================================================================

/**
 * 缓存地图快照（SET JSON + EXPIRE）。
 * 文档参考：tair-key-design 4.5.3 写入命令
 */
export async function cacheMapSnapshot(
  storeId: string,
  data: MapSnapshot
): Promise<void> {
  await safeWrite("cacheMapSnapshot", `map:snapshot:{${storeId}}`, async (client) => {
    const json = JSON.stringify(data);
    await client.set(`map:snapshot:${storeId}`, json, "EX", 10);
  });
}

/**
 * 读取缓存的地图快照（GET + JSON.parse）。
 * 文档参考：tair-key-design 4.5.4 生成策略
 */
export async function getCachedMapSnapshot(
  storeId: string
): Promise<MapSnapshot | null> {
  return safeRead("getCachedMapSnapshot", `map:snapshot:{${storeId}}`, async (client) => {
    const raw = await client.get(`map:snapshot:${storeId}`);
    if (!raw) return null;

    try {
      return JSON.parse(raw) as MapSnapshot;
    } catch {
      return null;
    }
  });
}
