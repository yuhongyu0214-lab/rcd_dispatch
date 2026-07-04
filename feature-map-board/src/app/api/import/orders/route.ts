import { fail, ok } from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  MAX_IMPORT_FILE_SIZE_BYTES
} from "@/lib/import/constants";
import { runOrderImport } from "@/lib/import/orchestrators/run-order-import";
import { logger } from "@/lib/logger";
import { getTraceId } from "@/lib/middleware/trace";

function isXlsxFile(file: File) {
  const isExpectedMime =
    file.type ===
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const hasXlsxExtension = file.name.toLowerCase().endsWith(".xlsx");

  return isExpectedMime || hasXlsxExtension;
}

export async function POST(request: Request) {
  const traceId = getTraceId(request);
  const contentType = request.headers.get("content-type") ?? "";
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return fail("未登录，请先登录后再导入", { status: 401, traceId });
  }

  if (currentUser.role !== "admin") {
    return fail("当前账号无权限执行导入操作", { status: 403, traceId });
  }

  if (!contentType.includes("multipart/form-data")) {
    return fail("请求必须使用 multipart/form-data 上传文件", {
      status: 400,
      traceId
    });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return fail("未检测到上传文件", { status: 400, traceId });
    }

    if (!isXlsxFile(file)) {
      return fail("仅支持上传 .xlsx 文件", { status: 400, traceId });
    }

    if (file.size === 0) {
      return fail("上传文件为空，请使用导入模板重新上传", {
        status: 400,
        traceId
      });
    }

    if (file.size > MAX_IMPORT_FILE_SIZE_BYTES) {
      return fail("上传文件过大，请控制在 10MB 以内", {
        status: 400,
        traceId
      });
    }

    logger.info({ traceId, fileName: file.name, fileSize: file.size }, "import_started");

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await runOrderImport({
      fileName: file.name,
      fileBuffer: buffer,
      operatorUserId: currentUser.id
    });

    if (!result.batchId) {
      const firstIssue = result.failedRows[0]?.issues[0]?.message ?? "导入文件无效";
      logger.warn({ traceId, reason: firstIssue }, "import_failed_validation");
      return fail(firstIssue, {
        status: 400,
        traceId
      });
    }

    logger.info({
      traceId,
      batchId: result.batchId,
      successCount: result.successCount,
      failureCount: result.failureCount
    }, "import_finished");

    return ok(result, { traceId });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "订单导入失败，请稍后重试";

    logger.error({ traceId, error: message }, "import_failed");

    return fail(message, {
      status: 500,
      traceId
    });
  }
}
