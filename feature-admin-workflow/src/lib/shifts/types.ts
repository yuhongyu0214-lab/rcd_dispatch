import type { DriverShift } from "@prisma/client";
import type { ApiErrorV2 } from "@/types/v2";

export type ShiftResult =
  | { success: true; shift: DriverShift }
  | { success: false; error: ApiErrorV2 };
