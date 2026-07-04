import { ETA_EXCEEDED_MINUTES } from "./rules";
import type { DispatchResult, RankedCandidate } from "./types";

export function buildNoDriverResult(input: {
  orderId: string;
  orderNo: string;
  orderType: DispatchResult["orderType"];
}): DispatchResult {
  return {
    orderId: input.orderId,
    orderNo: input.orderNo,
    orderType: input.orderType,
    outcome: "PENDING",
    reason: "NO_DRIVER",
    topN: []
  };
}

export function applyDispatchConstraints(input: {
  orderId: string;
  orderNo: string;
  orderType: DispatchResult["orderType"];
  topN: RankedCandidate[];
}): DispatchResult {
  if (input.topN.length === 0) {
    return buildNoDriverResult(input);
  }

  if (input.topN[0].etaMinutes >= ETA_EXCEEDED_MINUTES) {
    return {
      orderId: input.orderId,
      orderNo: input.orderNo,
      orderType: input.orderType,
      outcome: "MANUAL",
      reason: "ETA_EXCEEDED",
      topN: input.topN
    };
  }

  return {
    orderId: input.orderId,
    orderNo: input.orderNo,
    orderType: input.orderType,
    outcome: "DISPATCHED",
    reason: null,
    topN: input.topN
  };
}
