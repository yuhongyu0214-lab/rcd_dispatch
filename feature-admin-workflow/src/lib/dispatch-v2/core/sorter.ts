import type { DispatchOrderInputV2 } from "@/types/v2";

/**
 * Sort orders by dispatch priority.
 *
 * Primary sort: promisedPickupAt (ascending — earlier pickup first)
 * Tiebreaker:   orderId (ascending — deterministic tiebreaker)
 *
 * Pure function — does not mutate the input array.
 *
 * @param orders - Orders from the dispatch input
 * @returns A new array sorted by priority
 */
export function sortOrdersByPriority(
  orders: readonly DispatchOrderInputV2[]
): DispatchOrderInputV2[] {
  return [...orders].sort((a, b) => {
    const timeDiff =
      new Date(a.promisedPickupAt).getTime() -
      new Date(b.promisedPickupAt).getTime();
    if (timeDiff !== 0) {
      return timeDiff;
    }
    // Tiebreaker: deterministic by orderId
    return a.orderId.localeCompare(b.orderId);
  });
}
