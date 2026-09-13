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

export async function POST(request: Request) {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();
  if (!isPublicAdminRegistrationEnabled()) {
    return fail("公开注册已关闭", { status: 403, traceId });
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
