import { afterAll, describe, expect, it } from "vitest";

import {
  acquireResourceLock,
  closeRedis,
  redisHealthCheck,
  releaseResourceLock
} from "./redis";

const scenario = process.env.GATE3_REDIS_INTEGRATION;
const describeAvailable = scenario === "available" ? describe : describe.skip;
const describeUnavailable =
  scenario === "unavailable" ? describe : describe.skip;

afterAll(async () => {
  await closeRedis();
});

describeAvailable("Gate 3 live Redis lock verification", () => {
  it(
    "enforces lock ownership and reports contention as busy",
    async () => {
      await expect(redisHealthCheck()).resolves.toBe(true);

      const resourceKey =
        `dispatch:lock:gate3-verification:${process.pid}:${Date.now()}`;
      const firstToken = `first-${process.pid}`;
      const secondToken = `second-${process.pid}`;

      await expect(
        acquireResourceLock(resourceKey, firstToken, 5)
      ).resolves.toBe("acquired");
      await expect(
        acquireResourceLock(resourceKey, secondToken, 5)
      ).resolves.toBe("busy");

      await releaseResourceLock(resourceKey, secondToken);
      await expect(
        acquireResourceLock(resourceKey, secondToken, 5)
      ).resolves.toBe("busy");

      await releaseResourceLock(resourceKey, firstToken);
      await expect(
        acquireResourceLock(resourceKey, secondToken, 5)
      ).resolves.toBe("acquired");
      await releaseResourceLock(resourceKey, secondToken);
    },
    15_000
  );
});

describeUnavailable("Gate 3 Redis outage verification", () => {
  it(
    "returns unavailable so callers can fall back to database locking",
    async () => {
      await expect(redisHealthCheck()).resolves.toBe(false);
      await expect(
        acquireResourceLock(
          `dispatch:lock:gate3-unavailable:${process.pid}`,
          `token-${process.pid}`,
          2
        )
      ).resolves.toBe("unavailable");
    },
    15_000
  );
});
