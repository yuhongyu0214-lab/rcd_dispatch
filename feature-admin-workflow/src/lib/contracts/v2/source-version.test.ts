import { describe, expect, it } from "vitest";

import {
  compareSourceVersions,
  isLegalOnlineSourceVersion,
  V1_MIGRATION_SOURCE_VERSION
} from "./source-version";

describe("compareSourceVersions", () => {
  it.each([
    "2026-07-18T08:00:00.000Z",
    "0000000001"
  ])("treats v1-migration as older than legal online version %s", (onlineVersion) => {
    expect(compareSourceVersions(V1_MIGRATION_SOURCE_VERSION, onlineVersion)).toBe(-1);
    expect(compareSourceVersions(onlineVersion, V1_MIGRATION_SOURCE_VERSION)).toBe(1);
  });

  it("treats two v1-migration baselines as equal", () => {
    expect(
      compareSourceVersions(V1_MIGRATION_SOURCE_VERSION, V1_MIGRATION_SOURCE_VERSION)
    ).toBe(0);
  });

  it("compares fixed-millisecond UTC timestamps lexicographically", () => {
    expect(
      compareSourceVersions("2026-07-18T08:00:00.000Z", "2026-07-18T08:00:00.001Z")
    ).toBe(-1);
  });

  it("compares equal-length zero-padded sequences lexicographically", () => {
    expect(compareSourceVersions("0000000009", "0000000010")).toBe(-1);
    expect(compareSourceVersions("0000000010", "0000000010")).toBe(0);
  });

  it.each([
    "v1-migration-2",
    "2026-07-18T08:00:00Z",
    "2026-02-30T08:00:00.000Z",
    "2026-07-18T16:00:00.000+08:00",
    "12A3"
  ])("rejects illegal online version %s", (version) => {
    expect(isLegalOnlineSourceVersion(version)).toBe(false);
    expect(() => compareSourceVersions(V1_MIGRATION_SOURCE_VERSION, version)).toThrow(
      RangeError
    );
  });

  it("rejects mixed online version formats", () => {
    expect(() =>
      compareSourceVersions("2026-07-18T08:00:00.000Z", "0000000001")
    ).toThrow("不能比较两种不同格式的在线来源版本");
  });

  it("rejects sequence versions with different lengths", () => {
    expect(() => compareSourceVersions("0001", "00002")).toThrow(
      "不能比较长度不同的在线来源序号"
    );
  });
});
