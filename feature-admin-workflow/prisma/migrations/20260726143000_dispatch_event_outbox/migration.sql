BEGIN;

CREATE TABLE "DispatchEventOutbox" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "orderId" TEXT,
  "driverId" TEXT,
  "assignmentId" TEXT,
  "occurredAt" TIMESTAMPTZ(6) NOT NULL,
  "traceId" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMPTZ(6),
  "lockToken" TEXT,
  "processedAt" TIMESTAMPTZ(6),
  "lastError" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DispatchEventOutbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DispatchEventOutbox_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "DispatchEventOutbox_type_check" CHECK (
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
  )
);

CREATE UNIQUE INDEX "DispatchEventOutbox_eventId_key"
  ON "DispatchEventOutbox"("eventId");
CREATE INDEX "DispatchEventOutbox_processedAt_availableAt_idx"
  ON "DispatchEventOutbox"("processedAt", "availableAt");
CREATE INDEX "DispatchEventOutbox_lockedAt_idx"
  ON "DispatchEventOutbox"("lockedAt");
CREATE INDEX "DispatchEventOutbox_driverId_type_occurredAt_idx"
  ON "DispatchEventOutbox"("driverId", "type", "occurredAt");

-- Gate 3-0 temporarily stored internal dispatch events in OrderSourceEvent by
-- extending the external source enum with INTERNAL. Copy those rows into the
-- dedicated outbox before removing the enum value.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "OrderSourceEvent"
    WHERE "sourceSystem" = 'INTERNAL'
      AND "sourceStatusRaw" NOT IN (
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
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate INTERNAL OrderSourceEvent rows with an unknown event type';
  END IF;
END $$;

INSERT INTO "DispatchEventOutbox" (
  "id",
  "eventId",
  "type",
  "orderId",
  "driverId",
  "assignmentId",
  "occurredAt",
  "traceId",
  "createdAt",
  "updatedAt"
)
SELECT
  'migrated:' || event."id",
  event."externalOrderId",
  event."sourceStatusRaw",
  event."orderId",
  event."payloadSummary" ->> 'driverId',
  event."payloadSummary" ->> 'assignmentId',
  event."receivedAt" AT TIME ZONE 'UTC',
  COALESCE(event."traceId", 'migration'),
  event."createdAt" AT TIME ZONE 'UTC',
  event."createdAt" AT TIME ZONE 'UTC'
FROM "OrderSourceEvent" AS event
WHERE event."sourceSystem" = 'INTERNAL';

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM "OrderSourceEvent"
    WHERE "sourceSystem" = 'INTERNAL'
  ) <> (
    SELECT count(*)
    FROM "DispatchEventOutbox"
    WHERE "id" LIKE 'migrated:%'
  ) THEN
    RAISE EXCEPTION
      'INTERNAL event migration verification failed; source rows were retained';
  END IF;
END $$;

DELETE FROM "OrderSourceEvent"
WHERE "sourceSystem" = 'INTERNAL';

ALTER TABLE "Order"
  DROP CONSTRAINT IF EXISTS "Order_sourceSystem_no_internal_check";
ALTER TABLE "Order"
  ALTER COLUMN "sourceSystem" DROP DEFAULT;

ALTER TYPE "OrderSourceSystem" RENAME TO "OrderSourceSystem_with_internal";
CREATE TYPE "OrderSourceSystem" AS ENUM (
  'HALUO',
  'PLUGIN',
  'API',
  'V1_IMPORT'
);

ALTER TABLE "Order"
  ALTER COLUMN "sourceSystem"
  TYPE "OrderSourceSystem"
  USING "sourceSystem"::text::"OrderSourceSystem";
ALTER TABLE "OrderSourceEvent"
  ALTER COLUMN "sourceSystem"
  TYPE "OrderSourceSystem"
  USING "sourceSystem"::text::"OrderSourceSystem";

DROP TYPE "OrderSourceSystem_with_internal";

ALTER TABLE "Order"
  ALTER COLUMN "sourceSystem" SET DEFAULT 'V1_IMPORT';

COMMIT;
