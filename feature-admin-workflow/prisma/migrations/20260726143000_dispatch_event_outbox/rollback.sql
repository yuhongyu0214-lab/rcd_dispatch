BEGIN;

-- Data-safe rollback. Outbox rows may represent business facts that no longer
-- exist in OrderSourceEvent, so this script refuses to discard them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "DispatchEventOutbox" LIMIT 1) THEN
    RAISE EXCEPTION
      'Rollback blocked: DispatchEventOutbox contains events. Drain or archive them before rollback.';
  END IF;
END $$;

-- The event whitelist, including BASELINE_RECALCULATION, is a CHECK owned by
-- this table. Dropping the verified-empty table removes that constraint
-- without leaving an enum or other schema residue.
DROP TABLE "DispatchEventOutbox";

ALTER TABLE "Order"
  ALTER COLUMN "sourceSystem" DROP DEFAULT;

ALTER TYPE "OrderSourceSystem" RENAME TO "OrderSourceSystem_without_internal";
CREATE TYPE "OrderSourceSystem" AS ENUM (
  'HALUO',
  'PLUGIN',
  'API',
  'V1_IMPORT',
  'INTERNAL'
);

ALTER TABLE "Order"
  ALTER COLUMN "sourceSystem"
  TYPE "OrderSourceSystem"
  USING "sourceSystem"::text::"OrderSourceSystem";
ALTER TABLE "OrderSourceEvent"
  ALTER COLUMN "sourceSystem"
  TYPE "OrderSourceSystem"
  USING "sourceSystem"::text::"OrderSourceSystem";

DROP TYPE "OrderSourceSystem_without_internal";

ALTER TABLE "Order"
  ALTER COLUMN "sourceSystem" SET DEFAULT 'V1_IMPORT';

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_sourceSystem_no_internal_check"
  CHECK ("sourceSystem" <> 'INTERNAL');

COMMIT;
