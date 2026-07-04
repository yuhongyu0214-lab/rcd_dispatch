import { createId } from "@paralleldrive/cuid2";

export function createImportBatchId() {
  return `IMP_${createId().slice(0, 12)}`;
}
