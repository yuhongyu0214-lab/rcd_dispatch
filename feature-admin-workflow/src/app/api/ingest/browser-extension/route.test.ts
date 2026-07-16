import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";

import { OPTIONS, POST } from "./route";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: {
      findUnique: vi.fn(),
      create: vi.fn()
    },
    store: {
      findFirst: vi.fn(),
      findUnique: vi.fn()
    }
  }
}));

vi.mock("@/lib/import/services/geocode", () => ({
  geocodeAddress: vi.fn().mockResolvedValue({
    success: true,
    lat: 30.27415,
    lng: 120.15515,
    geocodeStatus: "SUCCESS"
  })
}));

const INGEST_KEY = "test-ingest-key";
const ALLOWED_ORIGIN = "chrome-extension://allowed-extension-id";

function buildRecord(orderNo: string) {
  return {
    orderNo,
    orderStatusRaw: "待取车",
    orderTypeRaw: "到店取车",
    city: "杭州市",
    storeName: "杭州西湖店",
    pickupAddress: "杭州西湖店取车区",
    returnAddress: "杭州市西湖区文三路 90 号"
  };
}

function buildRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/ingest/browser-extension", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Ingest-Key": INGEST_KEY,
      ...headers
    },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

function mockStoreResolution() {
  vi.mocked(prisma.store.findFirst).mockResolvedValue({
    code: "STORE_HZ_XH",
    id: "store-hz",
    name: "杭州西湖店",
    isActive: true
  } as never);
  vi.mocked(prisma.store.findUnique).mockResolvedValue({
    code: "STORE_HZ_XH",
    id: "store-hz",
    name: "杭州西湖店",
    isActive: true
  } as never);
}

function mockOrderCreate() {
  vi.mocked(prisma.order.create).mockImplementation(async (args: { data: { orderNo: string } }) =>
    ({
      id: `id-${args.data.orderNo}`,
      orderNo: args.data.orderNo,
      status: "PENDING"
    }) as never
  );
}

describe("browser-extension ingest route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INGEST_API_KEY = INGEST_KEY;
    process.env.INGEST_ALLOWED_ORIGINS = ALLOWED_ORIGIN;
    mockStoreResolution();
    mockOrderCreate();
    vi.mocked(prisma.order.findUnique).mockResolvedValue(null);
  });

  afterEach(() => {
    delete process.env.INGEST_API_KEY;
    delete process.env.INGEST_ALLOWED_ORIGINS;
  });

  describe("batch limits", () => {
    it("rejects batches above 200 records with 413", async () => {
      const records = Array.from({ length: 201 }, (_, i) => buildRecord(`RC-LIMIT-${i}`));
      const response = await POST(buildRequest(records));
      const body = await response.json();

      expect(response.status).toBe(413);
      expect(body.success).toBe(false);
      expect(body.error).toContain("200");
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it("rejects bodies above 1 MiB actual size with 413 regardless of Content-Length", async () => {
      // 构造一个 > 1 MiB 的合法 JSON，同时伪造小 Content-Length
      const oversized = JSON.stringify([
        { ...buildRecord("RC-BIG-1"), pickupAddress: "杭".repeat(400_000) }
      ]);
      expect(new TextEncoder().encode(oversized).byteLength).toBeGreaterThan(1024 * 1024);

      const response = await POST(
        buildRequest(oversized, { "Content-Length": "10" })
      );
      const body = await response.json();

      expect(response.status).toBe(413);
      expect(body.error).toContain("请求体过大");
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it("stops reading a streaming body as soon as the limit is exceeded", async () => {
      // 8 个 256 KiB 分片（共 2 MiB）：读到第 5 片（1.25 MiB）即超限，应取消而不是读完
      const chunk = new TextEncoder().encode("a".repeat(256 * 1024));
      const totalChunks = 8;
      let chunksPulled = 0;
      let cancelled = false;

      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (chunksPulled >= totalChunks) {
            controller.close();
            return;
          }
          chunksPulled += 1;
          controller.enqueue(chunk);
        },
        cancel() {
          cancelled = true;
        }
      });

      const response = await POST(
        new Request("http://localhost/api/ingest/browser-extension", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Ingest-Key": INGEST_KEY },
          body: stream,
          // @ts-expect-error Node fetch 需要 duplex 才能使用流式 body
          duplex: "half"
        })
      );

      expect(response.status).toBe(413);
      expect(cancelled).toBe(true);
      expect(chunksPulled).toBeLessThan(totalChunks);
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it("rejects an empty batch with 400", async () => {
      const response = await POST(buildRequest([]));
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain("请求体为空");
    });
  });

  describe("CORS whitelist", () => {
    it("rejects POST from an origin outside the whitelist with 403", async () => {
      const response = await POST(
        buildRequest([buildRecord("RC-CORS-1")], { Origin: "https://evil.example.com" })
      );

      expect(response.status).toBe(403);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it("echoes back a whitelisted origin instead of *", async () => {
      const response = await POST(
        buildRequest([buildRecord("RC-CORS-2")], { Origin: ALLOWED_ORIGIN })
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
      expect(response.headers.get("Vary")).toContain("Origin");
    });

    it("allows requests without an Origin header (curl / server-side)", async () => {
      const response = await POST(buildRequest([buildRecord("RC-CORS-3")]));

      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("rejects OPTIONS preflight from a non-whitelisted origin with 403", async () => {
      const response = await OPTIONS(
        new Request("http://localhost/api/ingest/browser-extension", {
          method: "OPTIONS",
          headers: { Origin: "https://evil.example.com" }
        })
      );

      expect(response.status).toBe(403);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("rejects requests carrying an Origin when no whitelist is configured", async () => {
      delete process.env.INGEST_ALLOWED_ORIGINS;

      const response = await POST(
        buildRequest([buildRecord("RC-CORS-4")], { Origin: ALLOWED_ORIGIN })
      );

      expect(response.status).toBe(403);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it("answers OPTIONS preflight from a whitelisted origin with 204", async () => {
      const response = await OPTIONS(
        new Request("http://localhost/api/ingest/browser-extension", {
          method: "OPTIONS",
          headers: { Origin: ALLOWED_ORIGIN }
        })
      );

      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
    });
  });

  describe("duplicate handling", () => {
    it("counts an already-existing order as skipped, not failed", async () => {
      vi.mocked(prisma.order.findUnique).mockResolvedValue({
        id: "existing-id",
        orderNo: "RC-DUP-1"
      } as never);

      const response = await POST(buildRequest([buildRecord("RC-DUP-1")]));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.total).toBe(1);
      expect(body.data.success).toBe(0);
      expect(body.data.skipped).toBe(1);
      expect(body.data.failed).toBe(0);
      expect(body.data.results[0].skipped).toBe(true);
    });

    it("skips repeated order numbers within the same batch", async () => {
      const response = await POST(
        buildRequest([buildRecord("RC-DUP-2"), buildRecord("RC-DUP-2")])
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.total).toBe(2);
      expect(body.data.success).toBe(1);
      expect(body.data.skipped).toBe(1);
      expect(body.data.failed).toBe(0);
      expect(prisma.order.create).toHaveBeenCalledTimes(1);
    });

    it("counts a concurrent P2002 unique violation as skipped, not failed", async () => {
      // findUnique 未命中，但 create 时另一并发请求已写入同一订单号
      vi.mocked(prisma.order.create).mockRejectedValue(
        Object.assign(new Error("Unique constraint failed on the fields: (`orderNo`)"), {
          code: "P2002"
        })
      );

      const response = await POST(buildRequest([buildRecord("RC-RACE-1")]));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.success).toBe(0);
      expect(body.data.skipped).toBe(1);
      expect(body.data.failed).toBe(0);
      expect(body.data.results[0].skipped).toBe(true);
      expect(body.data.results[0].reason).toContain("并发写入");
    });
  });

  describe("mixed batch", () => {
    it("classifies success / skipped / failed independently", async () => {
      // RC-MIX-DUP 已存在于数据库 → skipped
      vi.mocked(prisma.order.findUnique).mockImplementation(async (args: { where: { orderNo: string } }) =>
        (args.where.orderNo === "RC-MIX-DUP"
          ? ({ id: "existing", orderNo: "RC-MIX-DUP" } as never)
          : null)
      );

      const records = [
        buildRecord("RC-MIX-OK"),
        buildRecord("RC-MIX-DUP"),
        { ...buildRecord("RC-MIX-BAD"), pickupAddress: "", pickup_address: "", pickup_store: "" }
      ];
      const response = await POST(buildRequest(records));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.total).toBe(3);
      expect(body.data.success).toBe(1);
      expect(body.data.skipped).toBe(1);
      expect(body.data.failed).toBe(1);

      const byOrderNo = Object.fromEntries(
        body.data.results.map((r: { orderNo: string }) => [r.orderNo, r])
      );
      expect(byOrderNo["RC-MIX-OK"].success).toBe(true);
      expect(byOrderNo["RC-MIX-DUP"].skipped).toBe(true);
      expect(byOrderNo["RC-MIX-BAD"].success).toBe(false);
      expect(byOrderNo["RC-MIX-BAD"].skipped).toBeUndefined();
    });
  });

  describe("auth", () => {
    it("rejects a wrong ingest key with 401", async () => {
      const response = await POST(
        buildRequest([buildRecord("RC-AUTH-1")], { "X-Ingest-Key": "wrong-key" })
      );

      expect(response.status).toBe(401);
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it("rejects a request with no ingest key at all with 401", async () => {
      const response = await POST(
        new Request("http://localhost/api/ingest/browser-extension", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify([buildRecord("RC-AUTH-2")])
        })
      );

      expect(response.status).toBe(401);
      expect(prisma.order.create).not.toHaveBeenCalled();
    });
  });

  describe("compatibility and tracing", () => {
    it("accepts a single object body (non-array) for backward compatibility", async () => {
      const response = await POST(buildRequest(buildRecord("RC-SINGLE-1")));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.total).toBe(1);
      expect(body.data.success).toBe(1);
      expect(body.data.results[0].orderNo).toBe("RC-SINGLE-1");
    });

    it("uses the incoming X-Trace-Id consistently in body and response header", async () => {
      const traceId = "trace-consistency-check-001";
      const response = await POST(
        buildRequest([buildRecord("RC-TRACE-1")], { "X-Trace-Id": traceId })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.traceId).toBe(traceId);
      expect(response.headers.get("X-Trace-Id")).toBe(traceId);
    });
  });
});
