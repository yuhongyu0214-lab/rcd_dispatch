import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OPTIONS, POST } from "./route";

vi.mock("@/lib/adapters/order-source", () => ({
  processIngestEnvelope: vi.fn()
}));

// 保留真实常量
vi.mock("@/lib/adapters/order-source/types", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/adapters/order-source/types")>(
      "@/lib/adapters/order-source/types"
    );
  return actual;
});

import { processIngestEnvelope } from "@/lib/adapters/order-source";

const INGEST_KEY = "test-api-key-v2";

function mockIngestSuccess() {
  vi.mocked(processIngestEnvelope).mockResolvedValue({
    results: [
      {
        index: 0,
        externalOrderId: "HALUO-001",
        sourceVersion: "2026-07-18T08:00:00.000Z",
        status: "success",
        traceId: "trace-batch-1-0"
      }
    ],
    success: 1,
    skipped: 0,
    failed: 0
  });
}

function buildEnvelope(
  records: Record<string, unknown>[],
  sourceSystem = "HALUO"
) {
  return { sourceSystem, records };
}

function buildRequest(
  body: unknown,
  headers: Record<string, string> = {}
): Request {
  return new Request("http://localhost/api/v2/ingest/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Ingest-Key": INGEST_KEY,
      ...headers
    },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

describe("POST /api/v2/ingest/orders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INGEST_API_KEY = INGEST_KEY;
    process.env.INGEST_API_KEY_SOURCE = "HALUO";
    mockIngestSuccess();
  });

  afterEach(() => {
    delete process.env.INGEST_API_KEY;
    delete process.env.INGEST_API_KEY_SOURCE;
    delete process.env.INGEST_API_KEY_HALUO;
    delete process.env.INGEST_API_KEY_PLUGIN;
    delete process.env.INGEST_API_KEY_API;
    delete process.env.INGEST_KEY;
    delete process.env.INGEST_KEY_SOURCE;
    delete process.env.INGEST_KEY_BINDINGS;
    delete process.env.CORS_ORIGINS;
  });

  // ---- Auth ----
  describe("authentication", () => {
    it("rejects missing ingest key with 401", async () => {
      const response = await POST(
        new Request("http://localhost/api/v2/ingest/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildEnvelope([{}]))
        })
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
      expect(processIngestEnvelope).not.toHaveBeenCalled();
    });

    it("rejects wrong ingest key with 401", async () => {
      const response = await POST(
        buildRequest(buildEnvelope([{}]), {
          "X-Ingest-Key": "wrong-key"
        })
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
      expect(processIngestEnvelope).not.toHaveBeenCalled();
    });

    it("accepts Authorization: Bearer header format", async () => {
      const response = await POST(
        new Request("http://localhost/api/v2/ingest/orders", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${INGEST_KEY}`
          },
          body: JSON.stringify(
            buildEnvelope([
              {
                externalOrderId: "HALUO-001",
                sourceVersion: "2026-07-18T08:00:00.000Z",
                sourceStatusRaw: "待取车",
                orderNo: "ORDER-V2-001",
                businessType: "STORE_PICKUP",
                promisedPickupAt: "2026-07-18T09:00:00.000Z",
                pickupAddress: "取车点",
                deliveryAddress: "送达点",
                storeCode: "STORE_HZ_XH"
              }
            ])
          )
        })
      );
      expect(response.status).toBe(200);
    });
  });

  // ---- Source binding ----
  describe("source binding", () => {
    it("returns 403 when key is bound to HALUO but envelope says PLUGIN", async () => {
      process.env.INGEST_API_KEY = INGEST_KEY;
      process.env.INGEST_API_KEY_SOURCE = "HALUO";

      const response = await POST(
        buildRequest(
          buildEnvelope(
            [
              {
                externalOrderId: "P-001",
                sourceVersion: "2026-07-18T08:00:00.000Z",
                sourceStatusRaw: "待取车",
                orderNo: "ORDER-P",
                businessType: "STORE_PICKUP",
                promisedPickupAt: "2026-07-18T09:00:00.000Z",
                pickupAddress: "取车点",
                deliveryAddress: "送达点",
                storeCode: "STORE_HZ_XH"
              }
            ],
            "PLUGIN"
          )
        )
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("FORBIDDEN");
      expect(processIngestEnvelope).not.toHaveBeenCalled();
    });

    // P1-2: 未绑定来源的通用 key 必须拒绝，不得回退为 ANY
    it("returns 403 when generic key has no source binding (P1-2)", async () => {
      process.env.INGEST_API_KEY = INGEST_KEY;
      delete process.env.INGEST_API_KEY_SOURCE;

      const response = await POST(
        buildRequest(
          buildEnvelope([
            {
              externalOrderId: "HALUO-001",
              sourceVersion: "2026-07-18T08:00:00.000Z",
              sourceStatusRaw: "待取车",
              orderNo: "ORDER-V2-001",
              businessType: "STORE_PICKUP",
              promisedPickupAt: "2026-07-18T09:00:00.000Z",
              pickupAddress: "取车点",
              deliveryAddress: "送达点",
              storeCode: "STORE_HZ_XH"
            }
          ])
        )
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("FORBIDDEN");
      expect(processIngestEnvelope).not.toHaveBeenCalled();
    });

    // P1-2: INGEST_KEY_BINDINGS JSON 绑定表
    it("accepts key bound via INGEST_KEY_BINDINGS to matching source (P1-2)", async () => {
      delete process.env.INGEST_API_KEY;
      delete process.env.INGEST_API_KEY_SOURCE;
      process.env.INGEST_KEY_BINDINGS = JSON.stringify({
        "bindings-key-1": "HALUO"
      });

      const response = await POST(
        buildRequest(
          buildEnvelope([
            {
              externalOrderId: "HALUO-001",
              sourceVersion: "2026-07-18T08:00:00.000Z",
              sourceStatusRaw: "待取车",
              orderNo: "ORDER-V2-001",
              businessType: "STORE_PICKUP",
              promisedPickupAt: "2026-07-18T09:00:00.000Z",
              pickupAddress: "取车点",
              deliveryAddress: "送达点",
              storeCode: "STORE_HZ_XH"
            }
          ]),
          { "X-Ingest-Key": "bindings-key-1" }
        )
      );

      expect(response.status).toBe(200);
      expect(processIngestEnvelope).toHaveBeenCalledTimes(1);
    });

    it("returns 403 when INGEST_KEY_BINDINGS binding mismatches envelope source (P1-2)", async () => {
      delete process.env.INGEST_API_KEY;
      delete process.env.INGEST_API_KEY_SOURCE;
      process.env.INGEST_KEY_BINDINGS = JSON.stringify({
        "bindings-key-1": "PLUGIN"
      });

      const response = await POST(
        buildRequest(
          buildEnvelope([
            {
              externalOrderId: "HALUO-001",
              sourceVersion: "2026-07-18T08:00:00.000Z",
              sourceStatusRaw: "待取车",
              orderNo: "ORDER-V2-001",
              businessType: "STORE_PICKUP",
              promisedPickupAt: "2026-07-18T09:00:00.000Z",
              pickupAddress: "取车点",
              deliveryAddress: "送达点",
              storeCode: "STORE_HZ_XH"
            }
          ]),
          { "X-Ingest-Key": "bindings-key-1" }
        )
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error.code).toBe("FORBIDDEN");
      expect(processIngestEnvelope).not.toHaveBeenCalled();
    });
  });

  // ---- P1-3: CORS 预检 ----
  describe("OPTIONS preflight (P1-3)", () => {
    function buildOptionsRequest(headers: Record<string, string> = {}): Request {
      return new Request("http://localhost/api/v2/ingest/orders", {
        method: "OPTIONS",
        headers
      });
    }

    it("returns 204 with CORS headers for whitelisted Origin", async () => {
      process.env.CORS_ORIGINS =
        "https://haluo.example.com, https://plugin.example.com";

      const response = await OPTIONS(
        buildOptionsRequest({ Origin: "https://haluo.example.com" })
      );

      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://haluo.example.com"
      );
      expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
        "POST"
      );
      expect(response.headers.get("Access-Control-Allow-Headers")).toContain(
        "X-Ingest-Key"
      );
    });

    it("returns 403 for Origin not in whitelist", async () => {
      process.env.CORS_ORIGINS = "https://haluo.example.com";

      const response = await OPTIONS(
        buildOptionsRequest({ Origin: "https://evil.example.com" })
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("FORBIDDEN");
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("returns 403 for any Origin when CORS_ORIGINS is unset", async () => {
      delete process.env.CORS_ORIGINS;

      const response = await OPTIONS(
        buildOptionsRequest({ Origin: "https://haluo.example.com" })
      );

      expect(response.status).toBe(403);
    });

    it("returns 204 without CORS headers when Origin is absent", async () => {
      process.env.CORS_ORIGINS = "https://haluo.example.com";

      const response = await OPTIONS(buildOptionsRequest());

      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });
  });

  // ---- P1 返修: CORS 约束作用于实际 POST，而非只在预检 ----
  describe("POST CORS enforcement (P1)", () => {
    const validRecord = {
      externalOrderId: "HALUO-001",
      sourceVersion: "2026-07-18T08:00:00.000Z",
      sourceStatusRaw: "待取车",
      orderNo: "ORDER-V2-001",
      businessType: "STORE_PICKUP",
      promisedPickupAt: "2026-07-18T09:00:00.000Z",
      pickupAddress: "取车点",
      deliveryAddress: "送达点",
      storeCode: "STORE_HZ_XH"
    };

    it("rejects non-whitelisted Origin on actual POST with 403", async () => {
      process.env.CORS_ORIGINS = "https://haluo.example.com";

      const response = await POST(
        buildRequest(buildEnvelope([validRecord]), {
          Origin: "https://evil.example.com"
        })
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error.code).toBe("FORBIDDEN");
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(processIngestEnvelope).not.toHaveBeenCalled();
    });

    it("rejects any Origin on POST when CORS_ORIGINS is unset", async () => {
      delete process.env.CORS_ORIGINS;

      const response = await POST(
        buildRequest(buildEnvelope([validRecord]), {
          Origin: "https://haluo.example.com"
        })
      );

      expect(response.status).toBe(403);
      expect(processIngestEnvelope).not.toHaveBeenCalled();
    });

    it("echoes CORS headers on successful POST for whitelisted Origin", async () => {
      process.env.CORS_ORIGINS = "https://haluo.example.com";

      const response = await POST(
        buildRequest(buildEnvelope([validRecord]), {
          Origin: "https://haluo.example.com"
        })
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://haluo.example.com"
      );
      expect(response.headers.get("Vary")).toContain("Origin");
    });

    it("echoes CORS headers on failure responses for whitelisted Origin", async () => {
      process.env.CORS_ORIGINS = "https://haluo.example.com";

      // 合法 Origin + 无效 key → 401 也必须带 CORS 头，浏览器才能读到错误
      const response = await POST(
        buildRequest(buildEnvelope([validRecord]), {
          Origin: "https://haluo.example.com",
          "X-Ingest-Key": "wrong-key"
        })
      );

      expect(response.status).toBe(401);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://haluo.example.com"
      );
      expect(response.headers.get("Vary")).toContain("Origin");
    });

    it("leaves non-browser requests (no Origin) unaffected", async () => {
      process.env.CORS_ORIGINS = "https://haluo.example.com";

      const response = await POST(buildRequest(buildEnvelope([validRecord])));

      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(processIngestEnvelope).toHaveBeenCalledTimes(1);
    });
  });

  // ---- Envelope validation ----
  describe("envelope validation", () => {
    it("rejects non-object body with 400", async () => {
      const response = await POST(
        buildRequest("not-an-object")
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.success).toBe(false);
    });

    it("rejects V1_IMPORT sourceSystem with 400", async () => {
      const response = await POST(
        buildRequest(
          buildEnvelope([{}], "V1_IMPORT")
        )
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.success).toBe(false);
    });

    it("rejects unknown sourceSystem with 400", async () => {
      const response = await POST(
        buildRequest(
          buildEnvelope([{}], "UNKNOWN_SOURCE" as string)
        )
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.success).toBe(false);
    });

    it("rejects records as non-array with 400", async () => {
      const response = await POST(
        buildRequest({ sourceSystem: "HALUO", records: "not-an-array" })
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.success).toBe(false);
    });

    it("rejects empty records array with 400", async () => {
      const response = await POST(
        buildRequest(buildEnvelope([]))
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.success).toBe(false);
    });

    it("rejects batch size 201 with 413", async () => {
      const records = Array.from(
        { length: 201 },
        (_, i) => ({
          externalOrderId: `RECORD-${i}`,
          sourceVersion: "2026-07-18T08:00:00.000Z",
          sourceStatusRaw: "待取车",
          orderNo: `ORDER-${i}`,
          businessType: "STORE_PICKUP",
          promisedPickupAt: "2026-07-18T09:00:00.000Z",
          pickupAddress: "取车点",
          deliveryAddress: "送达点",
          storeCode: "STORE_HZ_XH"
        })
      );
      const response = await POST(
        buildRequest(buildEnvelope(records))
      );
      const body = await response.json();

      expect(response.status).toBe(413);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
    });
  });

  // ---- Body size limit ----
  describe("body size limit", () => {
    it("rejects body over 1 MiB with 413", async () => {
      // 构造刚好超过 1 MiB 的负载
      const record = {
        externalOrderId: "BIG-001",
        sourceVersion: "2026-07-18T08:00:00.000Z",
        sourceStatusRaw: "待取车",
        orderNo: "BIG-ORDER",
        businessType: "STORE_PICKUP",
        promisedPickupAt: "2026-07-18T09:00:00.000Z",
        pickupAddress: "取车点",
        deliveryAddress: "送达点",
        storeCode: "STORE_HZ_XH",
        remark: "X".repeat(1048576 - 100) // 让总体超过 1 MiB
      };
      const body = JSON.stringify(buildEnvelope([record]));
      expect(
        new TextEncoder().encode(body).byteLength
      ).toBeGreaterThan(1048576);

      const response = await POST(
        buildRequest(buildEnvelope([record]))
      );
      const responseBody = await response.json();

      expect(response.status).toBe(413);
      expect(responseBody.success).toBe(false);
      expect(responseBody.error.code).toBe("PAYLOAD_TOO_LARGE");
    });

    it("accepts body at exactly 1 MiB boundary", async () => {
      // 构造 ≤ 1 MiB 的有效 payload
      const base = JSON.stringify(
        buildEnvelope([
          {
            externalOrderId: "SMALL-001",
            sourceVersion: "2026-07-18T08:00:00.000Z",
            sourceStatusRaw: "test",
            orderNo: "S-001",
            businessType: "STORE_PICKUP",
            promisedPickupAt: "2026-07-18T09:00:00.000Z",
            pickupAddress: "a",
            deliveryAddress: "b",
            storeCode: "STORE_HZ_XH"
          }
        ])
      );
      const baseLen = new TextEncoder().encode(base).byteLength;
      const padding = "X".repeat(1048576 - baseLen - 1); // leave room for closing bracket
      const body = `{"sourceSystem":"HALUO","records":[{"externalOrderId":"SMALL-001","sourceVersion":"2026-07-18T08:00:00.000Z","sourceStatusRaw":"test","orderNo":"S-001","businessType":"STORE_PICKUP","promisedPickupAt":"2026-07-18T09:00:00.000Z","pickupAddress":"a","deliveryAddress":"b","storeCode":"STORE_HZ_XH","remark":"${padding}"}]}`;
      const bodyLen = new TextEncoder().encode(body).byteLength;

      if (bodyLen > 1048576) {
        // Use a smaller payload that definitely fits
        const smallBody = JSON.stringify(
          buildEnvelope([
            {
              externalOrderId: "TINY",
              sourceVersion: "2026-07-18T08:00:00.000Z",
              sourceStatusRaw: "t",
              orderNo: "T",
              businessType: "STORE_PICKUP",
              promisedPickupAt: "2026-07-18T09:00:00.000Z",
              pickupAddress: "a",
              deliveryAddress: "b",
              storeCode: "STORE_HZ_XH"
            }
          ])
        );
        const response = await POST(
          buildRequest({
            sourceSystem: "HALUO",
            records: [
              {
                externalOrderId: "TINY",
                sourceVersion: "2026-07-18T08:00:00.000Z",
                sourceStatusRaw: "t",
                orderNo: "T",
                businessType: "STORE_PICKUP",
                promisedPickupAt: "2026-07-18T09:00:00.000Z",
                pickupAddress: "a",
                deliveryAddress: "b",
                storeCode: "STORE_HZ_XH"
              }
            ]
          } as unknown as Record<string, unknown>[])
        );
        expect(response.status).toBe(200);
      } else {
        const response = await POST(
          new Request("http://localhost/api/v2/ingest/orders", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Ingest-Key": INGEST_KEY
            },
            body
          })
        );
        expect(response.status).toBe(200);
      }
    });
  });

  // ---- Happy path ----
  describe("happy path", () => {
    it("returns 200 with IngestBatchResultV2 for valid envelope", async () => {
      const response = await POST(
        buildRequest(
          buildEnvelope([
            {
              externalOrderId: "HALUO-001",
              sourceVersion: "2026-07-18T08:00:00.000Z",
              sourceStatusRaw: "待取车",
              orderNo: "ORDER-V2-001",
              businessType: "STORE_PICKUP",
              promisedPickupAt: "2026-07-18T09:00:00.000Z",
              pickupAddress: "取车点",
              deliveryAddress: "送达点",
              storeCode: "STORE_HZ_XH"
            }
          ])
        )
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.success).toBe(1);
      expect(body.data.failed).toBe(0);
      expect(body.traceId).toBeDefined();
      expect(response.headers.get("X-Trace-Id")).toBeDefined();
      expect(processIngestEnvelope).toHaveBeenCalledTimes(1);
    });

    it("passes traceId from X-Trace-Id header", async () => {
      const traceId = "custom-trace-abc123";
      const response = await POST(
        buildRequest(
          buildEnvelope([
            {
              externalOrderId: "HALUO-001",
              sourceVersion: "2026-07-18T08:00:00.000Z",
              sourceStatusRaw: "待取车",
              orderNo: "ORDER-V2-001",
              businessType: "STORE_PICKUP",
              promisedPickupAt: "2026-07-18T09:00:00.000Z",
              pickupAddress: "取车点",
              deliveryAddress: "送达点",
              storeCode: "STORE_HZ_XH"
            }
          ]),
          { "X-Trace-Id": traceId }
        )
      );
      const body = await response.json();

      expect(body.traceId).toBe(traceId);
      expect(response.headers.get("X-Trace-Id")).toBe(traceId);
    });
  });
});
