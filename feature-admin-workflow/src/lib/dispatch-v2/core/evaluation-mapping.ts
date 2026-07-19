import type { DispatchOrderEvaluationV2 } from "@/types/v2";

// ---------------------------------------------------------------------------
// Pure mapping functions — translate DispatchOrderEvaluationV2 into
// feasibility labels and alert-write decisions.
//
// These functions are NOT part of the pure computation core (they reference
// Prisma-adjacent concepts like OrderFeasibilityV2 / DispatchAlert) but they
// are free of Prisma imports so they remain testable in isolation.
// The actual DB write orchestration belongs to the Gate 3/4 integration layer.
// ---------------------------------------------------------------------------

/**
 * Frozen feasibility mapping (2026-07-19 ruling).
 *
 *   PLANNED + bestSlackMinutes >= 10  → NORMAL
 *   PLANNED + bestSlackMinutes <  10  → AT_RISK
 *   INFEASIBLE                        → INFEASIBLE
 *   UNPLANNED / ETA_UNAVAILABLE       → UNKNOWN
 */
export function mapEvaluationToFeasibility(
  evaluation: DispatchOrderEvaluationV2
): "NORMAL" | "AT_RISK" | "INFEASIBLE" | "UNKNOWN" {
  if (evaluation.result === "PLANNED") {
    return evaluation.bestSlackMinutes >= 10 ? "NORMAL" : "AT_RISK";
  }
  if (evaluation.result === "INFEASIBLE") {
    return "INFEASIBLE";
  }
  return "UNKNOWN";
}

/**
 * Only INFEASIBLE evaluations produce DispatchAlert rows.
 *
 * Frozen constraint: slackMinutesAtCreate is Int (non-nullable). Alerts are
 * only created when a real slack value below -30 exists.
 */
export function shouldWriteInfeasibleAlert(
  evaluation: DispatchOrderEvaluationV2
): boolean {
  return evaluation.result === "INFEASIBLE";
}

/**
 * Build the Order.feasibility + slackMinutes update payload for a single
 * evaluation.
 *
 * Returns `slackMinutes: null` for UNPLANNED / ETA_UNAVAILABLE evaluations
 * where no credible slack exists.
 */
export function buildOrderFeasibilityUpdate(
  evaluation: DispatchOrderEvaluationV2
): { feasibility: "NORMAL" | "AT_RISK" | "INFEASIBLE" | "UNKNOWN"; slackMinutes: number | null } {
  return {
    feasibility: mapEvaluationToFeasibility(evaluation),
    slackMinutes: evaluation.bestSlackMinutes,
  };
}

/**
 * Build DispatchAlert create payload.
 *
 * Returns `null` for non-INFEASIBLE evaluations — no "slack-less" alerts.
 * For INFEASIBLE evaluations, `bestSlackMinutes` is always a real number
 * (guaranteed by the discriminated union).
 */
export function buildDispatchAlertCreate(
  orderId: string,
  evaluation: DispatchOrderEvaluationV2
): { orderId: string; type: "INFEASIBLE"; slackMinutesAtCreate: number } | null {
  if (!shouldWriteInfeasibleAlert(evaluation)) return null;
  // The discriminated union guarantees bestSlackMinutes is number when
  // result is "INFEASIBLE", but TypeScript can't narrow through a guard
  // function.  Use inline narrowing instead.
  if (evaluation.result !== "INFEASIBLE") return null;
  return {
    orderId,
    type: "INFEASIBLE" as const,
    slackMinutesAtCreate: evaluation.bestSlackMinutes,
  };
}
