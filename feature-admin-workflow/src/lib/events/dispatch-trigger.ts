import type { InternalEvent } from "./types";

/**
 * Process an internal event and determine if it warrants a dispatch run.
 *
 * Gate 3: This is a stub — it recognizes application entry points for
 * the whitelisted trigger types but does NOT call runDispatchV2 yet.
 * The transaction integration layer (Gate 3) will wire this to the
 * dispatch engine as business operations are implemented.
 *
 * Frozen rules:
 *   - replay / duplicate / old version / no state change / FOLLOW_UP_REQUIRED
 *     → no re-dispatch trigger
 *   - This function contains NO dispatch queries, plan calculations, or
 *     transaction commit logic (thin obligation)
 */
export async function handleInternalEvent(
  _event: InternalEvent
): Promise<{ shouldTriggerDispatch: boolean; reason?: string }> {
  // Gate 3 stub — dispatch integration deferred to business operation integration
  return {
    shouldTriggerDispatch: false,
    reason: "Gate 3 stub — dispatch integration deferred to business operation integration",
  };
}
