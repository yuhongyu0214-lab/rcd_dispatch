import type { DriverStatus, OrderType } from "@prisma/client";

import {
  isStoreOrder,
  STORE_ORDER_PENALTY_MINUTES
} from "./rules";
import type {
  DispatchCandidate,
  EtaResult,
  EtaStatus,
  RankedCandidate
} from "./types";

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

/** Score bonus (reduction) for same-store drivers */
const SAME_STORE_BONUS = -500;
/** Score weight per km of distance (0 = rely on ETA only; distance used for pre-filter + tiebreak) */
const DISTANCE_WEIGHT = 0;

/**
 * Build a human-readable reasons array explaining the ranking.
 */
function buildReasons(input: {
  candidate: DispatchCandidate;
  etaMinutes: number;
  etaStatus: EtaStatus;
  isSameStore: boolean;
  isShortestDistance: boolean;
  isLowestEta: boolean;
  loadPenaltyMinutes: number;
}): string[] {
  const reasons: string[] = [];

  // Distance reason
  if (input.isShortestDistance) {
    reasons.push(`距离最近 ${input.candidate.distanceKm.toFixed(1)}km`);
  }

  // ETA reason
  if (input.isLowestEta && input.etaStatus === "NORMAL") {
    reasons.push(`预计最快到达 ${input.etaMinutes}分钟`);
  }

  // Same store bonus
  if (input.isSameStore) {
    reasons.push("同门店");
  }

  // Driver idle status
  if (input.candidate.driverStatus === "S1" && input.candidate.activeOrders.store === 0 && input.candidate.activeOrders.door === 0) {
    reasons.push("当前空闲");
  }

  // ETA exceeded warning
  if (input.etaStatus === "EXCEEDED") {
    reasons.push("预计到达超过2小时，建议人工判断");
  }

  // ETA fallback warning
  if (input.etaStatus === "FALLBACK") {
    reasons.push("ETA获取失败，建议人工判断");
  }

  // Load penalty
  if (input.loadPenaltyMinutes > 0) {
    reasons.push(`负载惩罚 +${input.loadPenaltyMinutes}分钟`);
  }

  return reasons;
}

export type RankInput = {
  orderType: OrderType;
  orderStoreId: string;
  candidates: DispatchCandidate[];
  etaResults: EtaResult[];
  topNLimit: number;
};

export function rankDispatchCandidates(input: RankInput): RankedCandidate[] {
  const etaByDriverId = new Map<string, EtaResult>();
  for (const result of input.etaResults) {
    etaByDriverId.set(result.driverId, result);
  }

  const shouldBalanceStoreLoad =
    isStoreOrder(input.orderType) &&
    input.candidates.filter((candidate) => candidate.driverStatus === "S1").length >= 2;

  // Find shortest distance and lowest ETA for reason generation
  const distances = input.candidates.map((c) => c.distanceKm).filter((d) => d > 0);
  const shortestDistance = distances.length > 0 ? Math.min(...distances) : 0;
  const etas = input.etaResults.map((r) => r.etaMinutes).filter((e) => e < 9999);
  const lowestEta = etas.length > 0 ? Math.min(...etas) : 9999;

  const ranked: RankedCandidate[] = input.candidates.map((candidate) => {
    const etaResult = etaByDriverId.get(candidate.driverId);
    const etaMinutes = etaResult?.etaMinutes ?? 9999;
    const etaStatus: EtaStatus = etaResult?.etaStatus ?? "FALLBACK";
    const isSameStore = candidate.storeId === input.orderStoreId;

    // Priority rank by driver status
    const priorityRank = isStoreOrder(input.orderType)
      ? storePriority[candidate.driverStatus]
      : doorPriority[candidate.driverStatus];

    // Load penalty for store-order load balancing
    const loadPenaltyMinutes = shouldBalanceStoreLoad
      ? candidate.activeOrders.store * STORE_ORDER_PENALTY_MINUTES
      : 0;

    // Distance contribution to score
    const distancePenalty = Math.round(candidate.distanceKm * DISTANCE_WEIGHT);

    // Same-store bonus
    const storeBonus = isSameStore ? SAME_STORE_BONUS : 0;

    // Final score: lower is better
    const score =
      priorityRank * 10000 +
      etaMinutes +
      distancePenalty +
      loadPenaltyMinutes +
      storeBonus;

    const isShortestDistance =
      candidate.distanceKm > 0 &&
      Math.abs(candidate.distanceKm - shortestDistance) < 0.01;
    const isLowestEta =
      etaMinutes < 9999 && Math.abs(etaMinutes - lowestEta) < 1;

    const reasons = buildReasons({
      candidate,
      etaMinutes,
      etaStatus,
      isSameStore,
      isShortestDistance,
      isLowestEta,
      loadPenaltyMinutes
    });

    return {
      driverId: candidate.driverId,
      driverName: candidate.driverName,
      phone: candidate.phone,
      driverStatus: candidate.driverStatus,
      storeId: candidate.storeId,
      storeName: candidate.storeName,
      etaMinutes,
      etaStatus,
      distanceKm: candidate.distanceKm,
      loadPenaltyMinutes,
      activeStoreOrders: candidate.activeOrders.store,
      activeDoorOrders: candidate.activeOrders.door,
      priorityRank,
      score,
      reasons
    };
  });

  return ranked
    .sort((left, right) => left.score - right.score)
    .slice(0, input.topNLimit);
}
