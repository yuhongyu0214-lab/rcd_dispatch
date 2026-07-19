-- Rollback: Remove the INTERNAL guard CHECK from Order.
--
-- This restores the ability to write INTERNAL to Order.sourceSystem
-- (allowed by the enum but prohibited by Gate 3-0 convention).
-- Safe to run on databases where the Order table or the constraint
-- does not yet exist (e.g., shadow DB).

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'Order'
      AND constraint_name = 'Order_sourceSystem_no_internal_check'
  ) THEN
    ALTER TABLE "Order" DROP CONSTRAINT "Order_sourceSystem_no_internal_check";
  END IF;
END $$;

COMMIT;
