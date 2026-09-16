import { createHmac, timingSafeEqual } from "node:crypto";

import { fail, ok } from "@/lib/api-response";
import { hashPassword } from "@/lib/auth/password";
import { isPublicAdminRegistrationEnabled } from "@/lib/auth/public-registration";
import {
  createWorkspaceAccount,
  isAccountWriteConflict,
  WorkspaceAccountError
} from "@/lib/auth/workspace-account";
import { createLogger } from "@/lib/logger";

const logger = createLogger("workspace-registration");

const INVITATION_VERSION = "v1";
const INVITATION_SECRET_MIN_LENGTH = 32;

type RegistrationInvitation = {
  version: 1;
  phone: string;
  expiresAt: number;
  nonce: string;
};

function invitationSecret() {
  const secret = process.env.WORKSPACE_REGISTRATION_INVITE_SECRET?.trim();
  return secret && secret.length >= INVITATION_SECRET_MIN_LENGTH
    ? secret
    : null;
}

function hasSameOrigin(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const originUrl = URL.parse(origin);
  const host = request.headers.get("host") ?? new URL(request.url).host;
  return Boolean(
    originUrl &&
      ["https:", "http:"].includes(originUrl.protocol) &&
      originUrl.host === host
  );
}

function isValidInvitation(
  inviteCode: unknown,
  phone: string,
  nowMs = Date.now()
) {
  const secret = invitationSecret();
  if (!secret || typeof inviteCode !== "string" || inviteCode.length > 1024) {
    return false;
  }
  const parts = inviteCode.split(".");
  if (parts.length !== 3 || parts[0] !== INVITATION_VERSION) return false;
  const [version, payloadPart, signaturePart] = parts;
  const signedValue = `${version}.${payloadPart}`;
  const expectedSignature = createHmac("sha256", secret)
    .update(signedValue)
    .digest();
  let providedSignature: Buffer;
  try {
    providedSignature = Buffer.from(signaturePart, "base64url");
  } catch {
    return false;
  }
  if (
    providedSignature.length !== expectedSignature.length ||
    providedSignature.toString("base64url") !== signaturePart ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    return false;
  }

  let invitation: RegistrationInvitation;
  try {
    const payloadBuffer = Buffer.from(payloadPart, "base64url");
    if (payloadBuffer.toString("base64url") !== payloadPart) return false;
    invitation = JSON.parse(
      payloadBuffer.toString("utf8")
    ) as RegistrationInvitation;
  } catch {
    return false;
  }
  if (
    !invitation ||
    invitation.version !== 1 ||
    invitation.phone !== phone ||
    !Number.isSafeInteger(invitation.expiresAt) ||
    invitation.expiresAt <= Math.floor(nowMs / 1000) ||
    typeof invitation.nonce !== "string" ||
    invitation.nonce.length < 16 ||
    invitation.nonce.length > 128
  ) {
    return false;
  }
  return true;
}

export async function POST(request: Request) {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();
  const inviteRegistrationEnabled = Boolean(invitationSecret());
  if (!inviteRegistrationEnabled && !isPublicAdminRegistrationEnabled()) {
    return fail("公开注册已关闭", { status: 403, traceId });
  }
  if (!hasSameOrigin(request)) {
    return fail("注册请求来源无效", { status: 403, traceId });
  }
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail("注册参数格式错误", { status: 400, traceId });
  }
  const input = body as Record<string, unknown>;
  const phone =
    typeof input.account === "string" ? input.account.replace(/\s+/g, "") : "";
  const password = typeof input.password === "string" ? input.password : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const storeId = typeof input.storeId === "string" ? input.storeId.trim() : "";
  if (!/^1\d{10}$/.test(phone) || !password || !name || !storeId) {
    return fail("请填写有效手机号、姓名、密码，并选择所属门店", {
      status: 400,
      traceId
    });
  }
  if (
    inviteRegistrationEnabled &&
    !isValidInvitation(input.inviteCode, phone)
  ) {
    return fail("邀请码无效、已过期或与手机号不匹配", {
      status: 403,
      traceId
    });
  }

  try {
    // 不接受客户端的 role / alsoDriver；每个新账号固定具备双端能力。
    const user = await createWorkspaceAccount({
      phone,
      name,
      storeId,
      passwordHash: await hashPassword(password)
    });
    logger.info("workspace_account_created", {
      traceId,
      userId: user.id,
      driverId: user.driverId
    });
    return ok(user, { status: 201, traceId });
  } catch (error) {
    if (error instanceof WorkspaceAccountError) {
      return fail(error.message, { status: error.status, traceId });
    }
    if (isAccountWriteConflict(error)) {
      return fail("账号或司机档案已发生变化，请刷新后重试", {
        status: 409,
        traceId
      });
    }
    logger.error("workspace_account_create_failed", { traceId });
    return fail("注册失败，请联系管理员并提供 traceId", {
      status: 500,
      traceId
    });
  }
}
