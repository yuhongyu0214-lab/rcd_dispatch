import type { LocationInvalidReasonV2, LocationFreshnessV2 } from "@/types/v2";

export type ValidationResult =
  | { valid: true }
  | { valid: false; reason: LocationInvalidReasonV2 };

export type FreshnessResult = {
  freshness: LocationFreshnessV2;
  capturedAt: string | null;
};

export type SamplingDecision = {
  shouldSample: boolean;
  reason?: string;
};
