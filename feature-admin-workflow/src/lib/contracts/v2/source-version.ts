export const V1_MIGRATION_SOURCE_VERSION = "v1-migration" as const;

export type SourceVersionComparison = -1 | 0 | 1;

type OnlineSourceVersionKind = "ISO_TIMESTAMP" | "SEQUENCE";

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SEQUENCE_PATTERN = /^\d+$/;

function getOnlineSourceVersionKind(version: string): OnlineSourceVersionKind {
  if (ISO_TIMESTAMP_PATTERN.test(version)) {
    const timestamp = Date.parse(version);

    if (
      Number.isFinite(timestamp) &&
      new Date(timestamp).toISOString() === version
    ) {
      return "ISO_TIMESTAMP";
    }
  }

  if (SEQUENCE_PATTERN.test(version)) {
    return "SEQUENCE";
  }

  throw new RangeError(`非法在线来源版本: ${version}`);
}

export function isLegalOnlineSourceVersion(version: string): boolean {
  try {
    getOnlineSourceVersionKind(version);
    return true;
  } catch {
    return false;
  }
}

/**
 * 返回负数表示 leftVersion 更旧，0 表示相同，正数表示更新。
 */
export function compareSourceVersions(
  leftVersion: string,
  rightVersion: string
): SourceVersionComparison {
  if (
    leftVersion === V1_MIGRATION_SOURCE_VERSION &&
    rightVersion === V1_MIGRATION_SOURCE_VERSION
  ) {
    return 0;
  }

  if (leftVersion === V1_MIGRATION_SOURCE_VERSION) {
    getOnlineSourceVersionKind(rightVersion);
    return -1;
  }

  if (rightVersion === V1_MIGRATION_SOURCE_VERSION) {
    getOnlineSourceVersionKind(leftVersion);
    return 1;
  }

  const leftKind = getOnlineSourceVersionKind(leftVersion);
  const rightKind = getOnlineSourceVersionKind(rightVersion);

  if (leftKind !== rightKind) {
    throw new RangeError("不能比较两种不同格式的在线来源版本");
  }

  if (leftKind === "SEQUENCE" && leftVersion.length !== rightVersion.length) {
    throw new RangeError("不能比较长度不同的在线来源序号");
  }

  if (leftVersion === rightVersion) {
    return 0;
  }

  return leftVersion < rightVersion ? -1 : 1;
}
