import type { ImportSummary, StoredImportMetadata } from "@/lib/import/types";
import { findImportLogByBatchId } from "@/lib/import/repositories/import-repository";

function isImportMetadata(value: unknown): value is StoredImportMetadata {
  if (!value || typeof value !== "object") {
    return false;
  }

  const metadata = value as Partial<StoredImportMetadata>;

  return (
    typeof metadata.batchId === "string" &&
    typeof metadata.importedAt === "string" &&
    typeof metadata.totalCount === "number" &&
    typeof metadata.successCount === "number" &&
    typeof metadata.failureCount === "number" &&
    typeof metadata.warningCount === "number" &&
    Array.isArray(metadata.failedRows) &&
    Array.isArray(metadata.warningRows)
  );
}

export async function getImportResult(batchId: string): Promise<ImportSummary | null> {
  const log = await findImportLogByBatchId(batchId);

  if (!log || !isImportMetadata(log.metadataJson)) {
    return null;
  }

  const metadata = log.metadataJson;

  return {
    batchId: metadata.batchId,
    importedAt: metadata.importedAt,
    totalCount: metadata.totalCount,
    successCount: metadata.successCount,
    failureCount: metadata.failureCount,
    warningCount: metadata.warningCount,
    failedRows: metadata.failedRows,
    warningRows: metadata.warningRows
  };
}
