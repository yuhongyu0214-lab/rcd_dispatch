import { describe, expect, it } from "vitest";
import {
  buildDispatchAlertCreate,
  buildOrderFeasibilityUpdate,
  mapEvaluationToFeasibility,
  shouldWriteInfeasibleAlert,
} from "./evaluation-mapping";
import type { DispatchOrderEvaluationV2 } from "@/types/v2";

function makeEval(overrides: Partial<DispatchOrderEvaluationV2> & { orderId: string }): DispatchOrderEvaluationV2 {
  if (overrides.result === "PLANNED" || overrides.result === "INFEASIBLE") {
    return {
      orderId: overrides.orderId,
      result: overrides.result,
      bestSlackMinutes: overrides.bestSlackMinutes ?? 0,
      reason: overrides.reason ?? "PLANNED",
    } as DispatchOrderEvaluationV2;
  }
  return {
    orderId: overrides.orderId,
    result: (overrides.result ?? "UNPLANNED") as "UNPLANNED" | "ETA_UNAVAILABLE",
    bestSlackMinutes: null,
    reason: (overrides.reason ?? "NO_AVAILABLE_SLOT") as "NO_ELIGIBLE_DRIVER" | "NO_AVAILABLE_SLOT" | "ETA_UNAVAILABLE",
  } as DispatchOrderEvaluationV2;
}

// =========================================================================
// mapEvaluationToFeasibility
// =========================================================================

describe("mapEvaluationToFeasibility", () => {
  it("PLANNED with slack >= 10 → NORMAL", () => {
    expect(mapEvaluationToFeasibility(makeEval({ orderId: "o1", result: "PLANNED", bestSlackMinutes: 10 }))).toBe("NORMAL");
    expect(mapEvaluationToFeasibility(makeEval({ orderId: "o1", result: "PLANNED", bestSlackMinutes: 30 }))).toBe("NORMAL");
  });

  it("PLANNED with slack < 10 → AT_RISK", () => {
    expect(mapEvaluationToFeasibility(makeEval({ orderId: "o1", result: "PLANNED", bestSlackMinutes: 9 }))).toBe("AT_RISK");
    expect(mapEvaluationToFeasibility(makeEval({ orderId: "o1", result: "PLANNED", bestSlackMinutes: -30 }))).toBe("AT_RISK");
  });

  it("INFEASIBLE → INFEASIBLE", () => {
    expect(mapEvaluationToFeasibility(makeEval({ orderId: "o1", result: "INFEASIBLE", bestSlackMinutes: -31 }))).toBe("INFEASIBLE");
  });

  it("UNPLANNED → UNKNOWN", () => {
    expect(mapEvaluationToFeasibility(makeEval({ orderId: "o1", result: "UNPLANNED" }))).toBe("UNKNOWN");
  });

  it("ETA_UNAVAILABLE → UNKNOWN", () => {
    expect(mapEvaluationToFeasibility(makeEval({ orderId: "o1", result: "ETA_UNAVAILABLE" }))).toBe("UNKNOWN");
  });
});

// =========================================================================
// shouldWriteInfeasibleAlert
// =========================================================================

describe("shouldWriteInfeasibleAlert", () => {
  it("true only for INFEASIBLE", () => {
    expect(shouldWriteInfeasibleAlert(makeEval({ orderId: "o1", result: "INFEASIBLE", bestSlackMinutes: -31 }))).toBe(true);
  });

  it("false for PLANNED", () => {
    expect(shouldWriteInfeasibleAlert(makeEval({ orderId: "o1", result: "PLANNED", bestSlackMinutes: 10 }))).toBe(false);
  });

  it("false for UNPLANNED", () => {
    expect(shouldWriteInfeasibleAlert(makeEval({ orderId: "o1", result: "UNPLANNED" }))).toBe(false);
  });

  it("false for ETA_UNAVAILABLE", () => {
    expect(shouldWriteInfeasibleAlert(makeEval({ orderId: "o1", result: "ETA_UNAVAILABLE" }))).toBe(false);
  });
});

// =========================================================================
// buildOrderFeasibilityUpdate
// =========================================================================

describe("buildOrderFeasibilityUpdate", () => {
  it("PLANNED NORMAL returns feasibility NORMAL with real slack", () => {
    const update = buildOrderFeasibilityUpdate(makeEval({ orderId: "o1", result: "PLANNED", bestSlackMinutes: 15 }));
    expect(update.feasibility).toBe("NORMAL");
    expect(update.slackMinutes).toBe(15);
  });

  it("UNPLANNED returns feasibility UNKNOWN with null slack", () => {
    const update = buildOrderFeasibilityUpdate(makeEval({ orderId: "o1", result: "UNPLANNED" }));
    expect(update.feasibility).toBe("UNKNOWN");
    expect(update.slackMinutes).toBeNull();
  });

  it("ETA_UNAVAILABLE returns feasibility UNKNOWN with null slack", () => {
    const update = buildOrderFeasibilityUpdate(makeEval({ orderId: "o1", result: "ETA_UNAVAILABLE" }));
    expect(update.feasibility).toBe("UNKNOWN");
    expect(update.slackMinutes).toBeNull();
  });
});

// =========================================================================
// buildDispatchAlertCreate
// =========================================================================

describe("buildDispatchAlertCreate", () => {
  it("INFEASIBLE creates alert with real slack value", () => {
    const alert = buildDispatchAlertCreate("order-1", makeEval({ orderId: "order-1", result: "INFEASIBLE", bestSlackMinutes: -45 }));
    expect(alert).not.toBeNull();
    expect(alert!.orderId).toBe("order-1");
    expect(alert!.type).toBe("INFEASIBLE");
    expect(alert!.slackMinutesAtCreate).toBe(-45);
  });

  it("PLANNED does NOT create alert", () => {
    expect(buildDispatchAlertCreate("order-1", makeEval({ orderId: "order-1", result: "PLANNED", bestSlackMinutes: 5 }))).toBeNull();
  });

  it("UNPLANNED does NOT create alert (no slack-less alerts)", () => {
    expect(buildDispatchAlertCreate("order-1", makeEval({ orderId: "order-1", result: "UNPLANNED" }))).toBeNull();
  });

  it("ETA_UNAVAILABLE does NOT create alert (no slack-less alerts)", () => {
    expect(buildDispatchAlertCreate("order-1", makeEval({ orderId: "order-1", result: "ETA_UNAVAILABLE" }))).toBeNull();
  });
});
