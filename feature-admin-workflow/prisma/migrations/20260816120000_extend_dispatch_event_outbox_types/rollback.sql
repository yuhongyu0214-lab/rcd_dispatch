BEGIN;

-- These event rows are business facts. Refuse to narrow the CHECK while either
-- newly allowed type is present instead of deleting or rewriting the rows.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "DispatchEventOutbox"
    WHERE "type" IN (
      'DRIVER_AVAILABILITY_CHANGED',
      'ASSIGNMENT_UNLOCKED'
    )
  ) THEN
    RAISE EXCEPTION
      'Rollback blocked: DispatchEventOutbox contains DRIVER_AVAILABILITY_CHANGED or ASSIGNMENT_UNLOCKED events.';
  END IF;
END $$;

ALTER TABLE "DispatchEventOutbox"
  DROP CONSTRAINT "DispatchEventOutbox_type_check";

ALTER TABLE "DispatchEventOutbox"
  ADD CONSTRAINT "DispatchEventOutbox_type_check" CHECK (
    "type" IN (
      'ORDER_CREATED',
      'ORDER_UPDATED',
      'ORDER_CANCELLED',
      'DRIVER_LOCATION_UPDATED',
      'DRIVER_SHIFT_STARTED',
      'DRIVER_SHIFT_ENDED',
      'ASSIGNMENT_ASSIGNED',
      'ASSIGNMENT_REASSIGNED',
      'ASSIGNMENT_WITHDRAWN',
      'ASSIGNMENT_CANCELLED',
      'BASELINE_RECALCULATION',
      'DEPART',
      'ARRIVE',
      'COMPLETE',
      'MODULE_CHANGE_APPLIED'
    )
  );

COMMIT;
