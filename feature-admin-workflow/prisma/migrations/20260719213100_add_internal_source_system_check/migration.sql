-- Gate 3-0: Prevent INTERNAL from being written to Order.sourceSystem.
--
-- INTERNAL is a storage namespace reserved for OrderSourceEvent only.
-- This CHECK backs the type-system exclusion (ORDER_SOURCE_SYSTEMS_V2
-- already omits INTERNAL) with a database-level guard.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Order' AND column_name = 'sourceSystem'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'Order'
      AND constraint_name = 'Order_sourceSystem_no_internal_check'
  ) THEN
    ALTER TABLE "Order" ADD CONSTRAINT "Order_sourceSystem_no_internal_check"
      CHECK ("sourceSystem" <> 'INTERNAL');
  END IF;
END $$;

COMMIT;
