import { getCurrentUser } from "@/lib/auth/current-user";
import { isAdminRole } from "@/lib/auth/roles";
import {
  completeWorkspaceDriver,
  isAccountWriteConflict,
  WorkspaceAccountError
} from "@/lib/auth/workspace-account";
import { createApiErrorV2, failV2, okV2 } from "@/lib/contracts/v2";
import { createLogger } from "@/lib/logger";

const logger = createLogger("workspace-driver-profile");

export async function POST(request: Request) {
  const traceId = request.headers.get("X-Trace-Id") ?? crypto.randomUUID();
  const user = await getCurrentUser();
  if (!user)
    return failV2(createApiErrorV2("UNAUTHORIZED", "请先登录"), { traceId });
  if (!isAdminRole(user.role)) {
    return failV2(createApiErrorV2("FORBIDDEN", "该账号不可使用工作台"), {
      traceId
    });
  }
  // 使用 session Cookie 的写接口不接受跨站请求；不依赖客户端传入身份。
  const origin = request.headers.get("origin");
  const originUrl = origin ? URL.parse(origin) : null;
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (
    request.headers.get("sec-fetch-site") === "cross-site" ||
    (origin !== null &&
      (!originUrl ||
        !["https:", "http:"].includes(originUrl.protocol) ||
        originUrl.host !== host))
  ) {
    return failV2(createApiErrorV2("FORBIDDEN", "请从本站提交"), { traceId });
  }
  const body: unknown =
    request.headers.get("content-type")?.split(";")[0].trim() ===
    "application/json"
      ? await request.json().catch(() => null)
      : null;
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => key !== "storeId") ||
    ("storeId" in body && typeof body.storeId !== "string")
  ) {
    return failV2(
      createApiErrorV2("VALIDATION_FAILED", "仅允许提交所属门店", {
        fields: { storeId: ["参数格式错误"] }
      }),
      { traceId }
    );
  }
  const storeId =
    "storeId" in body ? (body.storeId as string).trim() : undefined;
  try {
    const result = await completeWorkspaceDriver(user.id, storeId || undefined);
    logger.info("workspace_driver_profile_completed", {
      traceId,
      userId: user.id,
      driverId: result.driverId
    });
    return okV2(result, { traceId });
  } catch (error) {
    if (error instanceof WorkspaceAccountError) {
      if (error.status === 400) {
        return failV2(
          createApiErrorV2("VALIDATION_FAILED", error.message, {
            fields: { storeId: [error.message] }
          }),
          { traceId }
        );
      }
      return failV2(
        createApiErrorV2(
          error.status === 403 ? "FORBIDDEN" : "DUPLICATE_OPERATION",
          error.message
        ),
        { traceId }
      );
    }
    if (isAccountWriteConflict(error)) {
      return failV2(
        createApiErrorV2("DUPLICATE_OPERATION", "档案已发生变化，请刷新后重试"),
        { traceId }
      );
    }
    logger.error("workspace_driver_profile_failed", {
      traceId,
      userId: user.id
    });
    return failV2(
      createApiErrorV2(
        "INTERNAL_ERROR",
        "司机档案未能保存，请联系管理员并提供 traceId"
      ),
      { traceId }
    );
  }
}
