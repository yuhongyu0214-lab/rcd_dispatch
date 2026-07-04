/**
 * Adapter 注册表 — 集成适配层统一入口
 *
 * 文档参考：production-field-mapping.md 8.4 Adapter 注册表
 * 版本：2.0.0（S3-integration-adapter 生产化升级）
 *
 * 新增适配能力：
 *   - amap: 高德 API 封装（地理编码、路径规划、批量 ETA）
 *   - redis: Tair/Redis 客户端（司机位置、在线状态、ETA 缓存、派单锁、地图快照）
 *
 * 每个 Adapter 必须导出:
 *   - types.ts: 外部平台字段类型定义 + ADAPTER_VERSION
 *   - mapper.ts: 字段映射函数（外部 → 内部 DTO）
 *   - index.ts: 对外暴露的入口函数（fetch / push）+ 重新导出 mapper
 */

// 高德 API 适配器 — 生产级地理编码 / 路径规划 / ETA
export * as amap from "../amap";

// Tair/Redis 适配器 — 生产级缓存 / 锁 / 位置存储
export * as redis from "../redis";

// GPS 车辆位置适配器
export * as gps from "./gps";

// 哈啰订单适配器
export * as haluo from "./haluo";

// 核心 DTO 类型
export type {
  AdapterCoordinate,
  AdapterSource,
  DriverLocationDTO,
  OrderDTO,
  VehicleDTO,
  VehicleLocationDTO
} from "./types";

// 适配器元信息
export const ADAPTER_META = {
  /** 适配层版本号 */
  VERSION: "2.0.0",
  /** 已注册的适配器列表 */
  REGISTERED: ["gps", "haluo", "amap", "redis"] as const,
  /** 阶段 */
  PHASE: "S3-integration-adapter"
} as const;
