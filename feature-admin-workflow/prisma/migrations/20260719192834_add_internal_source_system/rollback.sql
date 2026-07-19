-- Rollback: Remove INTERNAL from OrderSourceSystem.
--
-- Safe to run when zero rows reference 'INTERNAL'. Aborts with a clear error
-- if any INTERNAL data exists — never silently rewrites or deletes data.

BEGIN;

-- 1. Guard: reject rollback if any INTERNAL data exists in either table.
--    The DO block raises an exception to abort the transaction.
DO $$
DECLARE
  internal_order_count INTEGER;
  internal_event_count INTEGER;
BEGIN
  SELECT count(*) INTO internal_order_count
  FROM "Order"
  WHERE "sourceSystem" = 'INTERNAL';

  SELECT count(*) INTO internal_event_count
  FROM "OrderSourceEvent"
  WHERE "sourceSystem" = 'INTERNAL';

  IF internal_order_count > 0 OR internal_event_count > 0 THEN
    RAISE EXCEPTION
      'Rollback blocked: % Order row(s) and % OrderSourceEvent row(s) still reference INTERNAL. '
      'Migrate or delete these rows before rolling back.',
      internal_order_count,
      internal_event_count;
  END IF;
END $$;

-- 2. Temporarily remove the default on Order.sourceSystem so the column
--    can be re-typed without a default-value conflict.
ALTER TABLE "Order" ALTER COLUMN "sourceSystem" DROP DEFAULT;

-- 3. Recreate the enum without INTERNAL.
ALTER TYPE "OrderSourceSystem" RENAME TO "OrderSourceSystem_old";

CREATE TYPE "OrderSourceSystem" AS ENUM ('HALUO', 'PLUGIN', 'API', 'V1_IMPORT');

-- 4. Convert both tables to the new enum.
ALTER TABLE "Order"
  ALTER COLUMN "sourceSystem"
  TYPE "OrderSourceSystem"
  USING "sourceSystem"::text::"OrderSourceSystem";

ALTER TABLE "OrderSourceEvent"
  ALTER COLUMN "sourceSystem"
  TYPE "OrderSourceSystem"
  USING "sourceSystem"::text::"OrderSourceSystem";

-- 5. Drop the old enum.
DROP TYPE "OrderSourceSystem_old";

-- 6. Restore the default.
ALTER TABLE "Order" ALTER COLUMN "sourceSystem" SET DEFAULT 'V1_IMPORT';

COMMIT;
