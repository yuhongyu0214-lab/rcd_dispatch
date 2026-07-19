-- Rollback: Remove INTERNAL from OrderSourceSystem.
--
-- Safe to run when zero rows reference 'INTERNAL'. Aborts with a clear error
-- if any INTERNAL data exists — never silently rewrites or deletes data.
-- Also safe to run on databases where the Order / OrderSourceEvent tables
-- do not yet exist (e.g., shadow DB used for schema diffing).

BEGIN;

-- 1. Guard: reject rollback if any INTERNAL data exists.
--    Checks only tables that actually exist — no-op on empty databases.
DO $$
DECLARE
  internal_order_count INTEGER := 0;
  internal_event_count INTEGER := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Order' AND column_name = 'sourceSystem'
  ) THEN
    EXECUTE 'SELECT count(*) FROM "Order" WHERE "sourceSystem" = ''INTERNAL'''
    INTO internal_order_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'OrderSourceEvent' AND column_name = 'sourceSystem'
  ) THEN
    EXECUTE 'SELECT count(*) FROM "OrderSourceEvent" WHERE "sourceSystem" = ''INTERNAL'''
    INTO internal_event_count;
  END IF;

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
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Order' AND column_name = 'sourceSystem'
  ) THEN
    ALTER TABLE "Order" ALTER COLUMN "sourceSystem" DROP DEFAULT;
  END IF;
END $$;

-- 3. Recreate the enum without INTERNAL.
ALTER TYPE "OrderSourceSystem" RENAME TO "OrderSourceSystem_old";

CREATE TYPE "OrderSourceSystem" AS ENUM ('HALUO', 'PLUGIN', 'API', 'V1_IMPORT');

-- 4. Convert both tables to the new enum (skip if the table / column does
--    not exist — e.g. on a shadow DB).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Order' AND column_name = 'sourceSystem'
  ) THEN
    ALTER TABLE "Order"
      ALTER COLUMN "sourceSystem"
      TYPE "OrderSourceSystem"
      USING "sourceSystem"::text::"OrderSourceSystem";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'OrderSourceEvent' AND column_name = 'sourceSystem'
  ) THEN
    ALTER TABLE "OrderSourceEvent"
      ALTER COLUMN "sourceSystem"
      TYPE "OrderSourceSystem"
      USING "sourceSystem"::text::"OrderSourceSystem";
  END IF;
END $$;

-- 5. Drop the old enum.
DROP TYPE "OrderSourceSystem_old";

-- 6. Restore the default.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Order' AND column_name = 'sourceSystem'
  ) THEN
    ALTER TABLE "Order" ALTER COLUMN "sourceSystem" SET DEFAULT 'V1_IMPORT';
  END IF;
END $$;

COMMIT;
