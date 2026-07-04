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

const log = createLogger("redis");

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
  loc_type?: string;
  status: string;
}

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

// ============================================================================
// 连接管理
// ============================================================================

interface RedisCommand {
  (...args: unknown[]): unknown;
}

interface PipelineLike {
  hgetall(key: string): void;
  exists(args: string[]): void;
  exec(): Promise<Array<[Error | null, unknown]>>;
}

interface RedisClientLike {
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
 * 写入司机位置（HSET + EXPIRE）。
 * 文档参考：tair-key-design 4.1.3 写入命令
 */
export async function setDriverLocation(
  driverId: string,
  data: DriverLocation
): Promise<void> {
  await safeWrite("setDriverLocation", `driver:last_location:{${driverId}}`, async (client) => {
    const fields: string[] = [];
    if (data.lat) fields.push("lat", data.lat);
    if (data.lng) fields.push("lng", data.lng);
    if (data.accuracy) fields.push("accuracy", data.accuracy);
    if (data.speed) fields.push("speed", data.speed);
    if (data.direction) fields.push("direction", data.direction);
    if (data.altitude) fields.push("altitude", data.altitude);
    if (data.ts) fields.push("ts", data.ts);
    if (data.server_ts) fields.push("server_ts", data.server_ts);
    if (data.loc_type) fields.push("loc_type", data.loc_type);
    if (data.status) fields.push("status", data.status);

    // 先 HMSET（新版 ioredis 也支持 hset 多参数）
    await client.hset(`driver:last_location:${driverId}`, ...fields);
    await client.expire(`driver:last_location:${driverId}`, 300);
  });
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

/**
 * 批量读取司机位置（Pipeline HGETALL）。
 * 文档参考：tair-key-design 9.2 Pipeline 使用规范
 */
export async function getDriverLocations(
  driverIds: string[]
): Promise<Map<string, DriverLocation | null>> {
  const result = new Map<string, DriverLocation | null>();

  if (driverIds.length === 0) return result;

  const client = getRedisClient();
  if (!client) {
    // 降级：全部返回 null
    driverIds.forEach((id) => result.set(id, null));
    return result;
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
        batch.forEach((id) => result.set(id, null));
        continue;
      }

      batch.forEach((driverId, index) => {
        const [err, data] = results[index] ?? [null, null];
        if (!err && data && typeof data === "object" && Object.keys(data as Record<string, unknown>).length > 0) {
          result.set(driverId, data as unknown as DriverLocation);
        } else {
          result.set(driverId, null);
        }
      });
    }

    circuitBreaker.recordSuccess();
  } catch (err) {
    circuitBreaker.recordFailure();
    log.warn("Batch getDriverLocations failed", { error: String(err) });
    driverIds.forEach((id) => result.set(id, null));
  }

  return result;
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
    await client.set(`driver:online:${driverId}`, ts, "EX", 300);
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
