import type { DriverStatus, OrderType } from "@prisma/client";

import {
  isStoreOrder,
  STORE_ORDER_PENALTY_MINUTES
} from "./rules";
import type { DispatchCandidate, EtaResult, RankedCandidate } from "./types";

const storePriority: Record<DriverStatus, number> = {
  S1: 1,
  S2: 2,
  S3: 3,
  S4: 4,
  OFFLINE: 99,
  UNAVAILABLE: 99
};

const doorPriority: Record<DriverStatus, number> = {
  S1: 1,
  S2: 1,
  S3: 2,
  S4: 3,
  OFFLINE: 99,
  UNAVAILABLE: 99
};

function buildReason(candidate: RankedCandidate, orderType: OrderType) {
  const driverStatusText: Record<DriverStatus, string> = {
    S1: "门店空闲",
    S2: "返程空闲",
    S3: "门店忙碌",
    S4: "订单忙碌",
    OFFLINE: "离线",
    UNAVAILABLE: "暂不可用"
  };
  const loadText =
    candidate.loadPenaltyMinutes > 0
      ? `，负载惩罚 +${candidate.loadPenaltyMinutes} 分钟`
      : "";

  return `${driverStatusText[candidate.driverStatus]}，预计到达 ${candidate.etaMinutes} 分钟${loadText}`;
}

export function rankDispatchCandidates(input: {
  orderType: OrderType;
  candidates: DispatchCandidate[];
  etaResults: EtaResult[];
  topNLimit: number;
}): RankedCandidate[] {
  const etaByDriverId = new Map(
    input.etaResults.map((result) => [result.driverId, result.etaMinutes])
  );
  const shouldBalanceStoreLoad =
    isStoreOrder(input.orderType) &&
    input.candidates.filter((candidate) => candidate.driverStatus === "S1").length >= 2;

  return input.candidates
    .map((candidate) => {
      const priorityRank = isStoreOrder(input.orderType)
        ? storePriority[candidate.driverStatus]
        : doorPriority[candidate.driverStatus];
      const etaMinutes = etaByDriverId.get(candidate.driverId) ?? 9999;
      const loadPenaltyMinutes = shouldBalanceStoreLoad
        ? candidate.activeOrders.store * STORE_ORDER_PENALTY_MINUTES
        : 0;
      const score = priorityRank * 10000 + etaMinutes + loadPenaltyMinutes;
      const rankedCandidate: RankedCandidate = {
        driverId: candidate.driverId,
        driverName: candidate.driverName,
        driverStatus: candidate.driverStatus,
        storeId: candidate.storeId,
        storeName: candidate.storeName,
        etaMinutes,
        loadPenaltyMinutes,
        activeStoreOrders: candidate.activeOrders.store,
        activeDoorOrders: candidate.activeOrders.door,
        priorityRank,
        score,
        reason: ""
      };

      return {
        ...rankedCandidate,
        reason: buildReason(rankedCandidate, input.orderType)
      };
    })
    .sort((left, right) => left.score - right.score)
    .slice(0, input.topNLimit);
}
