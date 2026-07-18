import { NextResponse } from "next/server";

import { okV2, failV2 } from "@/lib/contracts/v2";
import { createApiErrorV2 } from "@/lib/contracts/v2/errors";
import { createLogger } from "@/lib/logger";

import { processIngestEnvelope } from "@/lib/adapters/order-source";
import {
  MAX_BATCH_RECORDS,
  MAX_BODY_BYTES
} from "@/lib/adapters/order-source/types";

import type {
  IngestEnvelopeV2,
  OnlineOrderSourceSystemV2
} from "@/types/v2";
import { ORDER_SOURCE_SYSTEMS_V2 } from "@/types/v2";

export const dynamic = "force-dynamic";

const log = createLogger("order-source-api");

const ONLINE_SOURCE_SYSTEMS: readonly string[] =
  ORDER_SOURCE_SYSTEMS_V2.filter((s) => s !== "V1_IMPORT");

function isOnlineSourceSystem(value: string): value is OnlineOrderSourceSystemV2 {
  return (ONLINE_SOURCE_SYSTEMS as readonly string[]).includes(value);
}

/**
 * P1-2: Ingest Key 绑定解析结果。
 * 契约要求每个凭证必须绑定唯一 sourceSystem：
 * - bound   → key 合法且已绑定来源
 * - unbound → key 合法但未绑定来源（拒绝 403，不再回退为 ANY）
 * - invalid → key 不合法（拒绝 401）
 */
type KeyBindingResolution =
  | { kind: "bound"; sourceSystem: OnlineOrderSourceSystemV2 }
  | { kind: "unbound" }
  | { kind: "invalid" };

/** 解析 ingest key 绑定的来源系统 */
function resolveKeyBinding(presentedKey: string): KeyBindingResolution {
  if (!presentedKey) return { kind: "invalid" };

  // 1) JSON 绑定表：INGEST_KEY_BINDINGS = {"key1":"HALUO","key2":"PLUGIN"}
  const bindingsRaw = process.env.INGEST_KEY_BINDINGS;
  if (bindingsRaw) {
    try {
      const bindings = JSON.parse(bindingsRaw) as Record<string, unknown>;
      const bound = bindings[presentedKey];
      if (typeof bound === "string") {
        const upper = bound.toUpperCase();
        if (isOnlineSourceSystem(upper)) {
          return { kind: "bound", sourceSystem: upper };
        }
        // key 在绑定表中但绑定值不合法 → 视为未绑定
        return { kind: "unbound" };
      }
    } catch {
      log.warn("INGEST_KEY_BINDINGS 不是合法 JSON，忽略该绑定表");
    }
  }

  // 2) 来源专用 key：INGEST_API_KEY_<SOURCE> / INGEST_KEY_<SOURCE>
  const systems: OnlineOrderSourceSystemV2[] = ["HALUO", "PLUGIN", "API"];
  for (const system of systems) {
    const envKey =
      process.env[`INGEST_API_KEY_${system}`] ??
      process.env[`INGEST_KEY_${system}`];
    if (envKey && envKey === presentedKey) {
      return { kind: "bound", sourceSystem: system };
    }
  }

  // 3) 通用 key 必须通过 INGEST_API_KEY_SOURCE 显式绑定唯一来源
  const genericKey = process.env.INGEST_API_KEY ?? process.env.INGEST_KEY;
  if (genericKey && genericKey === presentedKey) {
    const boundSource = (
      process.env.INGEST_API_KEY_SOURCE ??
      process.env.INGEST_KEY_SOURCE ??
      ""
    ).toUpperCase();
    if (isOnlineSourceSystem(boundSource)) {
      return { kind: "bound", sourceSystem: boundSource };
    }
    // P1-2: 未绑定来源的通用 key 一律拒绝，不再返回 ANY
    return { kind: "unbound" };
  }

  return { kind: "invalid" };
}

/** P1-3: CORS Origin 白名单（逗号分隔的 CORS_ORIGINS 环境变量） */
function getAllowedOrigins(): string[] {
  return (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

const CORS_ALLOW_METHODS = "POST, OPTIONS";
const CORS_ALLOW_HEADERS =
  "Content-Type, Authorization, X-Ingest-Key, X-Trace-Id";

/**
 * P1-3: CORS 预检处理。
 * - Origin 不在白名单 → 403 FORBIDDEN
 * - Origin 在白名单 → 204 + CORS 头
 * - 无 Origin（非浏览器请求）→ 204，不带 CORS 头
 */
export async function OPTIONS(request: Request) {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();
  const origin = request.headers.get("Origin");

  if (!origin) {
    return new NextResponse(null, { status: 204 });
  }

  const allowedOrigins = getAllowedOrigins();
  if (!allowedOrigins.includes(origin)) {
    log.warn("CORS 预检被拒绝：Origin 不在白名单", { traceId, origin });
    return failV2(createApiErrorV2("FORBIDDEN", "Origin 不在允许列表中"), {
      traceId
    });
  }

  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": CORS_ALLOW_METHODS,
      "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
      "Access-Control-Max-Age": "86400",
      Vary: "Origin"
    }
  });
}

/** 流式读取请求体并限制大小 */
async function readBodyWithLimit(
  request: Request,
  maxBytes: number
): Promise<{ ok: true; text: string } | { ok: false; bytesRead: number }> {
  const body = request.body;
  if (!body) return { ok: true, text: "" };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel();
        return { ok: false, bytesRead };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(merged) };
}

/** 将 JSON body 解析为 IngestEnvelopeV2，失败返回 null */
function parseEnvelope(body: unknown): IngestEnvelopeV2 | null {
  if (typeof body !== "object" || body === null) return null;

  const raw = body as Record<string, unknown>;
  const sourceSystem = raw["sourceSystem"];
  if (typeof sourceSystem !== "string") return null;

  const records = raw["records"];
  if (!Array.isArray(records)) return null;

  return {
    sourceSystem: sourceSystem as IngestEnvelopeV2["sourceSystem"],
    records: records as IngestEnvelopeV2["records"]
  };
}

export async function POST(request: Request) {
  const traceId =
    request.headers.get("X-Trace-Id") ?? crypto.randomUUID();

  // ── P1-3 返修: CORS 约束作用于实际请求，而非只在预检 ──
  // 带 Origin 且不在白名单 → 拒绝（与 OPTIONS 同口径，响应不带 CORS 头）
  const origin = request.headers.get("Origin");
  if (origin && !getAllowedOrigins().includes(origin)) {
    log.warn("入单被拒绝：Origin 不在白名单", { traceId, origin });
    return failV2(createApiErrorV2("FORBIDDEN", "Origin 不在允许列表中"), {
      traceId
    });
  }

  const response = await handleIngestPost(request, traceId);

  // 合法浏览器 Origin：所有实际响应（成功/失败）统一回显 CORS 头，
  // 否则预检通过后浏览器仍读不到 POST 响应；无 Origin（服务端调用）不加头。
  if (origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.append("Vary", "Origin");
  }
  return response;
}

async function handleIngestPost(request: Request, traceId: string) {
  // ── 鉴权 ──
  const ingestKey =
    request.headers.get("X-Ingest-Key") ??
    request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ??
    "";

  const keyBinding = resolveKeyBinding(ingestKey);
  if (keyBinding.kind === "invalid") {
    log.warn("入单鉴权失败：无效 Ingest Key", { traceId });
    return failV2(createApiErrorV2("UNAUTHORIZED", "无效的 Ingest Key"), {
      traceId
    });
  }

  // P1-2: key 合法但未绑定来源系统 → 拒绝（每个凭证必须绑定唯一 sourceSystem）
  if (keyBinding.kind === "unbound") {
    log.warn("入单被拒绝：Ingest Key 未绑定来源系统", { traceId });
    return failV2(
      createApiErrorV2(
        "FORBIDDEN",
        "Ingest Key 未绑定来源系统，请配置 INGEST_KEY_BINDINGS 或 INGEST_API_KEY_SOURCE"
      ),
      { traceId }
    );
  }

  // ── 请求体大小限制（流式，先于 JSON.parse）──
  const bodyRead = await readBodyWithLimit(request, MAX_BODY_BYTES);
  if (!bodyRead.ok) {
    log.warn("入单被拒绝：请求体超限", {
      traceId,
      bytesRead: bodyRead.bytesRead,
      limit: MAX_BODY_BYTES
    });
    return failV2(
      createApiErrorV2("PAYLOAD_TOO_LARGE", "请求体过大", {
        limit: MAX_BODY_BYTES,
        observedBytes: bodyRead.bytesRead
      }),
      { traceId }
    );
  }

  // ── JSON 解析 ──
  let body: unknown;
  try {
    body = JSON.parse(bodyRead.text);
  } catch {
    log.warn("入单被拒绝：JSON 解析失败", { traceId });
    return failV2(
      createApiErrorV2("VALIDATION_FAILED", "请求体不是合法 JSON", {
        fields: { body: ["JSON 解析失败"] }
      }),
      { traceId }
    );
  }

  // ── 信封结构校验 ──
  const envelope = parseEnvelope(body);
  if (!envelope) {
    return failV2(
      createApiErrorV2(
        "VALIDATION_FAILED",
        "请求体必须包含 sourceSystem (string) 和 records (array)",
        { fields: { envelope: ["sourceSystem 和 records 是必填字段"] } }
      ),
      { traceId }
    );
  }

  // 拒绝 V1_IMPORT（运行时字符串比较，不依赖类型窄化）
  if ((envelope.sourceSystem as string) === "V1_IMPORT") {
    return failV2(
      createApiErrorV2(
        "VALIDATION_FAILED",
        "sourceSystem 不能为 V1_IMPORT，请使用 HALUO / PLUGIN / API",
        { fields: { sourceSystem: ["不能为 V1_IMPORT"] } }
      ),
      { traceId }
    );
  }

  // 拒绝未知来源
  if (!isOnlineSourceSystem(envelope.sourceSystem)) {
    return failV2(
      createApiErrorV2(
        "VALIDATION_FAILED",
        `sourceSystem 不合法: ${envelope.sourceSystem}，允许的值: ${ONLINE_SOURCE_SYSTEMS.join(", ")}`,
        { fields: { sourceSystem: ["sourceSystem 值不合法"] } }
      ),
      { traceId }
    );
  }

  // 批次大小校验
  if (envelope.records.length === 0) {
    return failV2(
      createApiErrorV2("VALIDATION_FAILED", "records 数组不能为空", { fields: { records: ["records 数组不能为空"] } }),
      { traceId }
    );
  }

  if (envelope.records.length > MAX_BATCH_RECORDS) {
    return failV2(
      createApiErrorV2("PAYLOAD_TOO_LARGE", "批次记录数超限", {
        limit: MAX_BATCH_RECORDS,
        actualRecords: envelope.records.length
      }),
      { traceId }
    );
  }

  // ── 来源绑定校验 ──
  if (keyBinding.sourceSystem !== envelope.sourceSystem) {
    log.warn("入单被拒绝：来源系统不匹配", {
      traceId,
      keyBoundTo: keyBinding.sourceSystem,
      envelopeSource: envelope.sourceSystem
    });
    return failV2(
      createApiErrorV2(
        "FORBIDDEN",
        `Ingest Key 绑定的来源 (${keyBinding.sourceSystem}) 与信封声明的来源 (${envelope.sourceSystem}) 不匹配`
      ),
      { traceId }
    );
  }

  // ── 处理批次 ──
  try {
    const result = await processIngestEnvelope(envelope, traceId);

    log.info("批次入单完成", {
      traceId,
      sourceSystem: envelope.sourceSystem,
      total: envelope.records.length,
      success: result.success,
      skipped: result.skipped,
      failed: result.failed
    });

    return okV2(result, { traceId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "入单处理失败";
    log.error("批次入单异常", {
      traceId,
      error: message
    });
    return failV2(createApiErrorV2("INTERNAL_ERROR", "入单处理异常"), {
      traceId
    });
  }
}
