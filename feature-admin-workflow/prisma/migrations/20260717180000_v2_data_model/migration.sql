-- ============================================================
-- Gate 1: V2 data model (forward migration)
-- Strategy: additive columns -> V1 backfill -> constraints/indexes
-- V1 columns and enums remain available during the compatibility window.
-- ============================================================

BEGIN;

-- 0. Reconcile a V1 migration-history gap before applying V2.
-- Current V1 Prisma code already depends on User.driverId; production was
-- previously aligned outside the checked-in migration chain.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "driverId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_driverId_key" ON "User"("driverId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'User_driverId_fkey'
      AND conrelid = '"User"'::regclass
  ) THEN
    ALTER TABLE "User"
    ADD CONSTRAINT "User_driverId_fkey"
    FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 1. V2 enums
CREATE TYPE "DriverAvailability" AS ENUM ('AVAILABLE', 'UNAVAILABLE');
CREATE TYPE "OrderSourceSystem" AS ENUM ('HALUO', 'PLUGIN', 'API', 'V1_IMPORT');
CREATE TYPE "OrderExecutionStatus" AS ENUM ('UNASSIGNED', 'PLANNED', 'EN_ROUTE', 'IN_SERVICE', 'COMPLETED', 'CANCELLED');
CREATE TYPE "OrderFeasibility" AS ENUM ('UNKNOWN', 'NORMAL', 'AT_RISK', 'INFEASIBLE');
CREATE TYPE "AssignmentLockType" AS ENUM ('NONE', 'AUTO_FROZEN', 'MANUAL_LOCKED');
CREATE TYPE "OrderSourceEventResult" AS ENUM ('SUCCESS', 'SKIPPED', 'FAILED', 'MIGRATED');
CREATE TYPE "DispatchAlertType" AS ENUM ('INFEASIBLE');
CREATE TYPE "DispatchAlertStatus" AS ENUM ('OPEN', 'RESOLVED');
CREATE TYPE "DispatchAlertResolvedBy" AS ENUM ('SYSTEM_RECALC', 'ORDER_MODIFIED', 'ORDER_CANCELLED');

ALTER TYPE "OperationEntityType" ADD VALUE IF NOT EXISTS 'ORDER_SOURCE_EVENT';
ALTER TYPE "OperationEntityType" ADD VALUE IF NOT EXISTS 'DRIVER_SHIFT';
ALTER TYPE "OperationEntityType" ADD VALUE IF NOT EXISTS 'SERVICE_PLAN';
ALTER TYPE "OperationEntityType" ADD VALUE IF NOT EXISTS 'DISPATCH_ALERT';
ALTER TYPE "OperationEntityType" ADD VALUE IF NOT EXISTS 'LOCATION_SAMPLE';

ALTER TYPE "OperationAction" ADD VALUE IF NOT EXISTS 'AUTO_DISPATCH';
ALTER TYPE "OperationAction" ADD VALUE IF NOT EXISTS 'DEPART';
ALTER TYPE "OperationAction" ADD VALUE IF NOT EXISTS 'ARRIVE';
ALTER TYPE "OperationAction" ADD VALUE IF NOT EXISTS 'MODULE_CHANGE';
ALTER TYPE "OperationAction" ADD VALUE IF NOT EXISTS 'ORDER_MODIFY';
ALTER TYPE "OperationAction" ADD VALUE IF NOT EXISTS 'ALERT_RESOLVE';
ALTER TYPE "OperationAction" ADD VALUE IF NOT EXISTS 'SHIFT_START';
ALTER TYPE "OperationAction" ADD VALUE IF NOT EXISTS 'SHIFT_END';
ALTER TYPE "OperationAction" ADD VALUE IF NOT EXISTS 'UNLOCK';
ALTER TYPE "OperationAction" ADD VALUE IF NOT EXISTS 'AVAILABILITY_CHANGE';

-- 2. Driver aggregate root
ALTER TABLE "Driver"
ADD COLUMN "onShift" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "availability" "DriverAvailability" NOT NULL DEFAULT 'AVAILABLE',
ADD COLUMN "planVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "lastAccuracyMeters" DOUBLE PRECISION,
ADD COLUMN "lastLocationCapturedAt" TIMESTAMP(3);

UPDATE "Driver"
SET
  "onShift" = CASE
    WHEN "status" IN ('S1', 'S2', 'S3', 'S4') THEN true
    ELSE false
  END,
  "availability" = CASE
    WHEN "status" = 'UNAVAILABLE' THEN 'UNAVAILABLE'::"DriverAvailability"
    ELSE 'AVAILABLE'::"DriverAvailability"
  END,
  "planVersion" = 1;

ALTER TABLE "Driver"
ADD CONSTRAINT "Driver_planVersion_check" CHECK ("planVersion" >= 1),
ADD CONSTRAINT "Driver_lastAccuracyMeters_check" CHECK ("lastAccuracyMeters" IS NULL OR "lastAccuracyMeters" >= 0);

CREATE INDEX "Driver_onShift_availability_idx" ON "Driver"("onShift", "availability");

-- 3. Order V2 snapshot fields (keeps all V1 fields)
ALTER TABLE "Order"
ADD COLUMN "sourceSystem" "OrderSourceSystem",
ADD COLUMN "externalOrderId" TEXT,
ADD COLUMN "sourceVersion" TEXT,
ADD COLUMN "executionStatus" "OrderExecutionStatus",
ADD COLUMN "feasibility" "OrderFeasibility",
ADD COLUMN "slackMinutes" INTEGER,
ADD COLUMN "deliveryAddress" TEXT,
ADD COLUMN "deliveryLat" DOUBLE PRECISION,
ADD COLUMN "deliveryLng" DOUBLE PRECISION,
ADD COLUMN "promisedPickupAt" TIMESTAMP(3),
ADD COLUMN "receivedAt" TIMESTAMP(3),
ADD COLUMN "remark" TEXT,
ADD COLUMN "cancelledAt" TIMESTAMP(3);

UPDATE "Order"
SET
  "sourceSystem" = CASE
    WHEN "channel" = 'HALUO' THEN 'HALUO'::"OrderSourceSystem"
    WHEN "channel" = 'BROWSER_PLUGIN' THEN 'PLUGIN'::"OrderSourceSystem"
    ELSE 'V1_IMPORT'::"OrderSourceSystem"
  END,
  "externalOrderId" = "orderNo",
  "sourceVersion" = 'v1-migration',
  "executionStatus" = CASE "status"
    WHEN 'PENDING' THEN 'UNASSIGNED'::"OrderExecutionStatus"
    WHEN 'RECOMMENDING' THEN 'UNASSIGNED'::"OrderExecutionStatus"
    WHEN 'ASSIGNED' THEN 'PLANNED'::"OrderExecutionStatus"
    WHEN 'ACCEPTED' THEN 'PLANNED'::"OrderExecutionStatus"
    WHEN 'IN_PROGRESS' THEN 'IN_SERVICE'::"OrderExecutionStatus"
    WHEN 'COMPLETED' THEN 'COMPLETED'::"OrderExecutionStatus"
    WHEN 'RECYCLED' THEN 'UNASSIGNED'::"OrderExecutionStatus"
    WHEN 'CANCELLED' THEN 'CANCELLED'::"OrderExecutionStatus"
  END,
  "feasibility" = 'UNKNOWN'::"OrderFeasibility",
  "deliveryAddress" = "returnAddress",
  "deliveryLat" = "returnLat",
  "deliveryLng" = "returnLng",
  "promisedPickupAt" = "scheduledAt",
  "receivedAt" = "createdAt";

ALTER TABLE "Order"
ALTER COLUMN "sourceSystem" SET DEFAULT 'V1_IMPORT',
ALTER COLUMN "sourceSystem" SET NOT NULL,
ALTER COLUMN "externalOrderId" SET DEFAULT ''::TEXT,
ALTER COLUMN "externalOrderId" SET NOT NULL,
ALTER COLUMN "sourceVersion" SET DEFAULT 'v1-migration',
ALTER COLUMN "sourceVersion" SET NOT NULL,
ALTER COLUMN "executionStatus" SET DEFAULT 'UNASSIGNED',
ALTER COLUMN "executionStatus" SET NOT NULL,
ALTER COLUMN "feasibility" SET DEFAULT 'UNKNOWN',
ALTER COLUMN "feasibility" SET NOT NULL,
ALTER COLUMN "deliveryAddress" SET DEFAULT ''::TEXT,
ALTER COLUMN "deliveryAddress" SET NOT NULL,
ALTER COLUMN "promisedPickupAt" SET DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "promisedPickupAt" SET NOT NULL,
ALTER COLUMN "receivedAt" SET DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "receivedAt" SET NOT NULL;

CREATE UNIQUE INDEX "Order_sourceSystem_externalOrderId_key"
ON "Order"("sourceSystem", "externalOrderId");
DROP INDEX IF EXISTS "Order_orderNo_key";
CREATE INDEX "Order_orderNo_idx" ON "Order"("orderNo");
CREATE INDEX "Order_executionStatus_promisedPickupAt_idx"
ON "Order"("executionStatus", "promisedPickupAt");
CREATE INDEX "Order_feasibility_executionStatus_idx"
ON "Order"("feasibility", "executionStatus");

-- 4. Assignment plan and execution fields
ALTER TABLE "Assignment"
ADD COLUMN "sequenceNo" INTEGER,
ADD COLUMN "plannedDepartAt" TIMESTAMP(3),
ADD COLUMN "plannedPickupAt" TIMESTAMP(3),
ADD COLUMN "plannedCompleteAt" TIMESTAMP(3),
ADD COLUMN "deadheadEtaMinutes" INTEGER,
ADD COLUMN "serviceEtaMinutes" INTEGER,
ADD COLUMN "etaUnavailableReason" TEXT,
ADD COLUMN "lockType" "AssignmentLockType" NOT NULL DEFAULT 'NONE',
ADD COLUMN "departedAt" TIMESTAMP(3),
ADD COLUMN "arrivedAt" TIMESTAMP(3),
ADD COLUMN "lastEtaCalculatedAt" TIMESTAMP(3);

WITH ranked_assignments AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "driverId"
      ORDER BY "assignedAt", "id"
    )::INTEGER AS "sequenceNo"
  FROM "Assignment"
  WHERE "status" IN ('ACTIVE', 'ACCEPTED')
)
UPDATE "Assignment" AS assignment
SET "sequenceNo" = ranked."sequenceNo"
FROM ranked_assignments AS ranked
WHERE assignment."id" = ranked."id";

UPDATE "Assignment"
SET "lockType" = CASE "type"
  WHEN 'MANUAL_ASSIGN' THEN 'MANUAL_LOCKED'::"AssignmentLockType"
  WHEN 'REASSIGN' THEN 'MANUAL_LOCKED'::"AssignmentLockType"
  ELSE 'NONE'::"AssignmentLockType"
END
WHERE "status" IN ('ACTIVE', 'ACCEPTED');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Order" AS orders
    LEFT JOIN "Assignment" AS assignments
      ON assignments."id" = orders."currentAssignmentId"
    WHERE orders."status" = 'IN_PROGRESS'
      AND assignments."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'V2 migration requires manual review: IN_PROGRESS order has no current Assignment';
  END IF;
END $$;

UPDATE "Assignment" AS assignment
SET
  "arrivedAt" = COALESCE(
    (
      SELECT MAX(log."createdAt")
      FROM "OperationLog" AS log
      WHERE log."action" = 'START'
        AND (
          (log."entityType" = 'ASSIGNMENT' AND log."entityId" = assignment."id")
          OR
          (
            log."entityType" = 'ORDER'
            AND log."entityId" = orders."id"
            AND log."metadataJson" ->> 'assignmentId' = assignment."id"
          )
        )
    ),
    assignment."acceptedAt",
    orders."updatedAt"
  ),
  "lockType" = 'AUTO_FROZEN'::"AssignmentLockType"
FROM "Order" AS orders
WHERE orders."currentAssignmentId" = assignment."id"
  AND orders."status" = 'IN_PROGRESS';

ALTER TABLE "Assignment"
ADD CONSTRAINT "Assignment_sequenceNo_check" CHECK ("sequenceNo" IS NULL OR "sequenceNo" BETWEEN 1 AND 3),
ADD CONSTRAINT "Assignment_deadheadEtaMinutes_check" CHECK ("deadheadEtaMinutes" IS NULL OR "deadheadEtaMinutes" >= 0),
ADD CONSTRAINT "Assignment_serviceEtaMinutes_check" CHECK ("serviceEtaMinutes" IS NULL OR "serviceEtaMinutes" >= 0);

CREATE INDEX "Assignment_driverId_sequenceNo_idx" ON "Assignment"("driverId", "sequenceNo");
CREATE INDEX "Assignment_orderId_lockType_idx" ON "Assignment"("orderId", "lockType");
CREATE UNIQUE INDEX "Assignment_active_driver_sequence_key"
ON "Assignment"("driverId", "sequenceNo")
WHERE "status" IN ('ACTIVE', 'ACCEPTED') AND "sequenceNo" IS NOT NULL;

-- 5. OperationLog trace and direct lookup dimensions
ALTER TABLE "OperationLog"
ADD COLUMN "orderId" TEXT,
ADD COLUMN "driverId" TEXT,
ADD COLUMN "assignmentId" TEXT,
ADD COLUMN "traceId" TEXT;

UPDATE "OperationLog" AS log
SET
  "assignmentId" = assignment."id",
  "orderId" = assignment."orderId",
  "driverId" = assignment."driverId"
FROM "Assignment" AS assignment
WHERE (
    log."entityType" = 'ASSIGNMENT'
    AND log."entityId" = assignment."id"
  )
  OR log."metadataJson" ->> 'assignmentId' = assignment."id";

UPDATE "OperationLog" AS log
SET "orderId" = orders."id"
FROM "Order" AS orders
WHERE log."orderId" IS NULL
  AND (
    (log."entityType" = 'ORDER' AND log."entityId" = orders."id")
    OR log."metadataJson" ->> 'orderId' = orders."id"
  );

UPDATE "OperationLog" AS log
SET "driverId" = driver."id"
FROM "Driver" AS driver
WHERE log."driverId" IS NULL
  AND (
    (log."entityType" = 'DRIVER' AND log."entityId" = driver."id")
    OR log."metadataJson" ->> 'driverId' = driver."id"
  );

UPDATE "OperationLog"
SET "traceId" = "metadataJson" ->> 'traceId'
WHERE "traceId" IS NULL
  AND "metadataJson" ->> 'traceId' IS NOT NULL;

ALTER TABLE "OperationLog"
ADD CONSTRAINT "OperationLog_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "OperationLog_driverId_fkey"
  FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "OperationLog_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "OperationLog_orderId_createdAt_idx" ON "OperationLog"("orderId", "createdAt");
CREATE INDEX "OperationLog_driverId_createdAt_idx" ON "OperationLog"("driverId", "createdAt");
CREATE INDEX "OperationLog_assignmentId_createdAt_idx" ON "OperationLog"("assignmentId", "createdAt");
CREATE INDEX "OperationLog_traceId_idx" ON "OperationLog"("traceId");

-- 6. V2 source events
CREATE TABLE "OrderSourceEvent" (
  "id" TEXT NOT NULL,
  "orderId" TEXT,
  "sourceSystem" "OrderSourceSystem" NOT NULL,
  "externalOrderId" TEXT NOT NULL,
  "sourceVersion" TEXT NOT NULL,
  "sourceStatusRaw" TEXT NOT NULL,
  "result" "OrderSourceEventResult" NOT NULL,
  "reason" TEXT,
  "payloadSummary" JSONB,
  "traceId" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderSourceEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderSourceEvent_sourceSystem_externalOrderId_sourceVersion_key"
ON "OrderSourceEvent"("sourceSystem", "externalOrderId", "sourceVersion");
CREATE INDEX "OrderSourceEvent_orderId_receivedAt_idx" ON "OrderSourceEvent"("orderId", "receivedAt");
CREATE INDEX "OrderSourceEvent_result_receivedAt_idx" ON "OrderSourceEvent"("result", "receivedAt");
CREATE INDEX "OrderSourceEvent_traceId_idx" ON "OrderSourceEvent"("traceId");

ALTER TABLE "OrderSourceEvent"
ADD CONSTRAINT "OrderSourceEvent_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "OrderSourceEvent" (
  "id",
  "orderId",
  "sourceSystem",
  "externalOrderId",
  "sourceVersion",
  "sourceStatusRaw",
  "result",
  "reason",
  "payloadSummary",
  "receivedAt",
  "processedAt",
  "createdAt"
)
SELECT
  'v1evt_' || md5(orders."id"),
  orders."id",
  orders."sourceSystem",
  orders."externalOrderId",
  'v1-migration',
  orders."status"::TEXT,
  'MIGRATED'::"OrderSourceEventResult",
  NULL,
  jsonb_strip_nulls(jsonb_build_object(
    'migration', 'v1-to-v2',
    'v1Channel', orders."channel",
    'v1Status', orders."status"::TEXT,
    'migrationFallback', CASE
      WHEN orders."status" = 'IN_PROGRESS'
        AND NOT EXISTS (
          SELECT 1
          FROM "OperationLog" AS start_log
          WHERE start_log."action" = 'START'
            AND (
              (
                start_log."entityType" = 'ASSIGNMENT'
                AND start_log."entityId" = current_assignment."id"
              )
              OR
              (
                start_log."entityType" = 'ORDER'
                AND start_log."entityId" = orders."id"
                AND start_log."metadataJson" ->> 'assignmentId' = current_assignment."id"
              )
            )
        )
      THEN CASE
        WHEN current_assignment."acceptedAt" IS NOT NULL THEN 'arrivedAt=acceptedAt'
        ELSE 'arrivedAt=orderUpdatedAt'
      END
      ELSE NULL
    END
  )),
  orders."createdAt",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Order" AS orders
LEFT JOIN "Assignment" AS current_assignment
  ON current_assignment."id" = orders."currentAssignmentId";

-- 7. Driver shifts
CREATE TABLE "DriverShift" (
  "id" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DriverShift_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DriverShift_time_order_check" CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt")
);

CREATE INDEX "DriverShift_driverId_startedAt_idx" ON "DriverShift"("driverId", "startedAt");
CREATE INDEX "DriverShift_endedAt_idx" ON "DriverShift"("endedAt");
CREATE UNIQUE INDEX "DriverShift_one_active_per_driver_key"
ON "DriverShift"("driverId") WHERE "endedAt" IS NULL;

ALTER TABLE "DriverShift"
ADD CONSTRAINT "DriverShift_driverId_fkey"
FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 8. Service module plans
CREATE OR REPLACE FUNCTION "calculate_service_module_minutes"(modules JSONB)
RETURNS INTEGER AS $$
DECLARE
  module_name TEXT;
  seen_modules TEXT[] := ARRAY[]::TEXT[];
  total_minutes INTEGER := 0;
BEGIN
  IF jsonb_typeof(modules) <> 'array' THEN
    RETURN NULL;
  END IF;

  FOR module_name IN SELECT jsonb_array_elements_text(modules)
  LOOP
    IF module_name = ANY(seen_modules) THEN
      RETURN NULL;
    END IF;

    seen_modules := array_append(seen_modules, module_name);
    total_minutes := total_minutes + CASE module_name
      WHEN 'CHARGING' THEN 30
      WHEN 'REFUELING' THEN 5
      WHEN 'WASHING' THEN 10
      WHEN 'HANDOVER_FORMALITIES' THEN 10
      WHEN 'RETURN_FORMALITIES' THEN 5
      ELSE NULL
    END;

    IF total_minutes IS NULL THEN
      RETURN NULL;
    END IF;
  END LOOP;

  RETURN total_minutes;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

CREATE TABLE "OrderServicePlan" (
  "id" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "modulesJson" JSONB NOT NULL DEFAULT '[]'::JSONB,
  "totalModuleMinutes" INTEGER NOT NULL DEFAULT 0,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderServicePlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderServicePlan_modules_check" CHECK (
    "calculate_service_module_minutes"("modulesJson") IS NOT NULL
    AND "totalModuleMinutes" = "calculate_service_module_minutes"("modulesJson")
  ),
  CONSTRAINT "OrderServicePlan_revision_check" CHECK ("revision" >= 1)
);

CREATE UNIQUE INDEX "OrderServicePlan_assignmentId_key" ON "OrderServicePlan"("assignmentId");
CREATE INDEX "OrderServicePlan_updatedByUserId_updatedAt_idx"
ON "OrderServicePlan"("updatedByUserId", "updatedAt");

ALTER TABLE "OrderServicePlan"
ADD CONSTRAINT "OrderServicePlan_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "OrderServicePlan_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 9. Persistent dispatch alerts
CREATE TABLE "DispatchAlert" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "type" "DispatchAlertType" NOT NULL DEFAULT 'INFEASIBLE',
  "status" "DispatchAlertStatus" NOT NULL DEFAULT 'OPEN',
  "slackMinutesAtCreate" INTEGER NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  "resolvedBy" "DispatchAlertResolvedBy",
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DispatchAlert_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DispatchAlert_slackMinutesAtCreate_check" CHECK ("slackMinutesAtCreate" < -30),
  CONSTRAINT "DispatchAlert_resolution_check" CHECK (
    ("status" = 'OPEN' AND "resolvedAt" IS NULL AND "resolvedBy" IS NULL)
    OR
    ("status" = 'RESOLVED' AND "resolvedAt" IS NOT NULL AND "resolvedBy" IS NOT NULL)
  )
);

CREATE INDEX "DispatchAlert_orderId_status_idx" ON "DispatchAlert"("orderId", "status");
CREATE INDEX "DispatchAlert_status_createdAt_idx" ON "DispatchAlert"("status", "createdAt");
CREATE UNIQUE INDEX "DispatchAlert_one_open_per_order_type_key"
ON "DispatchAlert"("orderId", "type") WHERE "status" = 'OPEN';

ALTER TABLE "DispatchAlert"
ADD CONSTRAINT "DispatchAlert_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 10. Sampled location history
CREATE TABLE "DriverLocationSample" (
  "id" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "lat" DOUBLE PRECISION NOT NULL,
  "lng" DOUBLE PRECISION NOT NULL,
  "accuracyMeters" DOUBLE PRECISION NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DriverLocationSample_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DriverLocationSample_lat_check" CHECK ("lat" BETWEEN -90 AND 90),
  CONSTRAINT "DriverLocationSample_lng_check" CHECK ("lng" BETWEEN -180 AND 180),
  CONSTRAINT "DriverLocationSample_accuracyMeters_check" CHECK ("accuracyMeters" >= 0)
);

CREATE UNIQUE INDEX "DriverLocationSample_driverId_capturedAt_key"
ON "DriverLocationSample"("driverId", "capturedAt");
CREATE INDEX "DriverLocationSample_capturedAt_idx" ON "DriverLocationSample"("capturedAt");

ALTER TABLE "DriverLocationSample"
ADD CONSTRAINT "DriverLocationSample_driverId_fkey"
FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 11. Temporary V1 -> V2 compatibility bridge.
-- It mirrors only renamed/split data fields; no dispatch behavior lives here.
CREATE OR REPLACE FUNCTION "sync_driver_v2_compat_fields"()
RETURNS TRIGGER AS $$
DECLARE
  derived_on_shift BOOLEAN;
  derived_availability "DriverAvailability";
BEGIN
  derived_on_shift := NEW."status" IN ('S1', 'S2', 'S3', 'S4');
  derived_availability := CASE
    WHEN NEW."status" = 'UNAVAILABLE' THEN 'UNAVAILABLE'::"DriverAvailability"
    ELSE 'AVAILABLE'::"DriverAvailability"
  END;

  IF TG_OP = 'UPDATE'
    AND (
      OLD."onShift" IS DISTINCT FROM derived_on_shift
      OR OLD."availability" IS DISTINCT FROM derived_availability
    )
  THEN
    NEW."planVersion" := OLD."planVersion" + 1;
  END IF;

  NEW."onShift" := derived_on_shift;
  NEW."availability" := derived_availability;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Driver_sync_v2_compat_fields"
BEFORE INSERT OR UPDATE OF "status" ON "Driver"
FOR EACH ROW EXECUTE FUNCTION "sync_driver_v2_compat_fields"();

CREATE OR REPLACE FUNCTION "sync_assignment_v2_compat_fields"()
RETURNS TRIGGER AS $$
DECLARE
  next_sequence INTEGER;
BEGIN
  IF NEW."status" IN ('ACTIVE', 'ACCEPTED') THEN
    IF TG_OP = 'UPDATE' AND NEW."driverId" IS DISTINCT FROM OLD."driverId" THEN
      PERFORM 1
      FROM "Driver"
      WHERE "id" IN (OLD."driverId", NEW."driverId")
      ORDER BY "id"
      FOR UPDATE;
    ELSE
      PERFORM 1
      FROM "Driver"
      WHERE "id" = NEW."driverId"
      FOR UPDATE;
    END IF;

    IF NEW."sequenceNo" IS NULL
      OR (TG_OP = 'UPDATE' AND NEW."driverId" IS DISTINCT FROM OLD."driverId")
    THEN
      SELECT slot."sequenceNo"
      INTO next_sequence
      FROM generate_series(1, 3) AS slot("sequenceNo")
      WHERE NOT EXISTS (
        SELECT 1
        FROM "Assignment" AS assignment
        WHERE assignment."driverId" = NEW."driverId"
          AND assignment."status" IN ('ACTIVE', 'ACCEPTED')
          AND assignment."id" <> NEW."id"
          AND assignment."sequenceNo" = slot."sequenceNo"
      )
      ORDER BY slot."sequenceNo"
      LIMIT 1;

      IF next_sequence IS NULL THEN
        RAISE EXCEPTION 'V1 compatibility write exceeds A/B/C capacity for driver %', NEW."driverId";
      END IF;

      NEW."sequenceNo" := next_sequence;
    END IF;

    IF NEW."type" IN ('MANUAL_ASSIGN', 'REASSIGN')
      AND NEW."lockType" = 'NONE'
    THEN
      NEW."lockType" := 'MANUAL_LOCKED'::"AssignmentLockType";
    END IF;
  ELSE
    NEW."sequenceNo" := NULL;
    NEW."lockType" := 'NONE'::"AssignmentLockType";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Assignment_sync_v2_compat_fields"
BEFORE INSERT OR UPDATE OF "status", "type", "driverId" ON "Assignment"
FOR EACH ROW EXECUTE FUNCTION "sync_assignment_v2_compat_fields"();

CREATE OR REPLACE FUNCTION "normalize_driver_assignment_sequences"(target_driver_id TEXT)
RETURNS VOID AS $$
DECLARE
  assignment_record RECORD;
  next_sequence INTEGER := 1;
BEGIN
  PERFORM 1
  FROM "Driver"
  WHERE "id" = target_driver_id
  FOR UPDATE;

  FOR assignment_record IN
    SELECT assignment."id", assignment."sequenceNo"
    FROM "Assignment" AS assignment
    WHERE assignment."driverId" = target_driver_id
      AND assignment."status" IN ('ACTIVE', 'ACCEPTED')
    ORDER BY assignment."sequenceNo" NULLS LAST, assignment."assignedAt", assignment."id"
  LOOP
    IF assignment_record."sequenceNo" IS DISTINCT FROM next_sequence THEN
      UPDATE "Assignment"
      SET "sequenceNo" = next_sequence
      WHERE "id" = assignment_record."id";
    END IF;
    next_sequence := next_sequence + 1;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "increment_v1_assignment_plan_version"()
RETURNS TRIGGER AS $$
DECLARE
  old_is_active BOOLEAN := false;
  new_is_active BOOLEAN;
BEGIN
  new_is_active := NEW."status" IN ('ACTIVE', 'ACCEPTED');

  IF TG_OP = 'INSERT' THEN
    IF new_is_active THEN
      UPDATE "Driver"
      SET "planVersion" = "planVersion" + 1
      WHERE "id" = NEW."driverId";
    END IF;
    RETURN NEW;
  END IF;

  old_is_active := OLD."status" IN ('ACTIVE', 'ACCEPTED');

  IF OLD."driverId" IS DISTINCT FROM NEW."driverId" THEN
    IF old_is_active THEN
      PERFORM "normalize_driver_assignment_sequences"(OLD."driverId");
      UPDATE "Driver"
      SET "planVersion" = "planVersion" + 1
      WHERE "id" = OLD."driverId";
    END IF;
    IF new_is_active THEN
      UPDATE "Driver"
      SET "planVersion" = "planVersion" + 1
      WHERE "id" = NEW."driverId";
    END IF;
  ELSIF old_is_active IS DISTINCT FROM new_is_active
    OR (new_is_active AND OLD."type" IS DISTINCT FROM NEW."type")
  THEN
    IF old_is_active AND NOT new_is_active THEN
      PERFORM "normalize_driver_assignment_sequences"(NEW."driverId");
    END IF;
    UPDATE "Driver"
    SET "planVersion" = "planVersion" + 1
    WHERE "id" = NEW."driverId";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Assignment_increment_v2_plan_version"
AFTER INSERT OR UPDATE OF "status", "type", "driverId" ON "Assignment"
FOR EACH ROW EXECUTE FUNCTION "increment_v1_assignment_plan_version"();

CREATE OR REPLACE FUNCTION "sync_order_v2_compat_fields"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."externalOrderId" IS NULL OR NEW."externalOrderId" = '' THEN
      NEW."externalOrderId" := NEW."orderNo";
    END IF;

    IF NEW."sourceVersion" IS NULL OR NEW."sourceVersion" = '' THEN
      NEW."sourceVersion" := 'v1-migration';
    END IF;

    IF NEW."sourceVersion" = 'v1-migration' THEN
      NEW."sourceSystem" := CASE
        WHEN NEW."channel" = 'HALUO' THEN 'HALUO'::"OrderSourceSystem"
        WHEN NEW."channel" = 'BROWSER_PLUGIN' THEN 'PLUGIN'::"OrderSourceSystem"
        ELSE 'V1_IMPORT'::"OrderSourceSystem"
      END;
      NEW."deliveryAddress" := NEW."returnAddress";
      NEW."deliveryLat" := NEW."returnLat";
      NEW."deliveryLng" := NEW."returnLng";
      NEW."promisedPickupAt" := NEW."scheduledAt";
      NEW."receivedAt" := COALESCE(NEW."receivedAt", NEW."createdAt", CURRENT_TIMESTAMP);
      NEW."executionStatus" := CASE NEW."status"
        WHEN 'PENDING' THEN 'UNASSIGNED'::"OrderExecutionStatus"
        WHEN 'RECOMMENDING' THEN 'UNASSIGNED'::"OrderExecutionStatus"
        WHEN 'ASSIGNED' THEN 'PLANNED'::"OrderExecutionStatus"
        WHEN 'ACCEPTED' THEN 'PLANNED'::"OrderExecutionStatus"
        WHEN 'IN_PROGRESS' THEN 'IN_SERVICE'::"OrderExecutionStatus"
        WHEN 'COMPLETED' THEN 'COMPLETED'::"OrderExecutionStatus"
        WHEN 'RECYCLED' THEN 'UNASSIGNED'::"OrderExecutionStatus"
        WHEN 'CANCELLED' THEN 'CANCELLED'::"OrderExecutionStatus"
      END;
      NEW."feasibility" := COALESCE(NEW."feasibility", 'UNKNOWN'::"OrderFeasibility");
    END IF;
  ELSE
    IF NEW."status" IS DISTINCT FROM OLD."status" THEN
      NEW."executionStatus" := CASE NEW."status"
        WHEN 'PENDING' THEN 'UNASSIGNED'::"OrderExecutionStatus"
        WHEN 'RECOMMENDING' THEN 'UNASSIGNED'::"OrderExecutionStatus"
        WHEN 'ASSIGNED' THEN 'PLANNED'::"OrderExecutionStatus"
        WHEN 'ACCEPTED' THEN 'PLANNED'::"OrderExecutionStatus"
        WHEN 'IN_PROGRESS' THEN 'IN_SERVICE'::"OrderExecutionStatus"
        WHEN 'COMPLETED' THEN 'COMPLETED'::"OrderExecutionStatus"
        WHEN 'RECYCLED' THEN 'UNASSIGNED'::"OrderExecutionStatus"
        WHEN 'CANCELLED' THEN 'CANCELLED'::"OrderExecutionStatus"
      END;

      IF NEW."status" = 'IN_PROGRESS' THEN
        IF NEW."currentAssignmentId" IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM "Assignment"
            WHERE "id" = NEW."currentAssignmentId"
          )
        THEN
          RAISE EXCEPTION 'V1 compatibility write requires current Assignment before IN_PROGRESS';
        END IF;

        UPDATE "Assignment" AS assignment
        SET
          "arrivedAt" = COALESCE(
            (
              SELECT MAX(log."createdAt")
              FROM "OperationLog" AS log
              WHERE log."action" = 'START'
                AND (
                  (log."entityType" = 'ASSIGNMENT' AND log."entityId" = assignment."id")
                  OR
                  (
                    log."entityType" = 'ORDER'
                    AND log."entityId" = NEW."id"
                    AND log."metadataJson" ->> 'assignmentId' = assignment."id"
                  )
                )
            ),
            assignment."acceptedAt",
            NEW."updatedAt"
          ),
          "lockType" = 'AUTO_FROZEN'::"AssignmentLockType"
        WHERE assignment."id" = NEW."currentAssignmentId";

        UPDATE "Driver"
        SET "planVersion" = "planVersion" + 1
        WHERE "id" = (
          SELECT "driverId"
          FROM "Assignment"
          WHERE "id" = NEW."currentAssignmentId"
        );
      END IF;
    END IF;

    IF NEW."scheduledAt" IS DISTINCT FROM OLD."scheduledAt" THEN
      NEW."promisedPickupAt" := NEW."scheduledAt";
    END IF;

    IF NEW."returnAddress" IS DISTINCT FROM OLD."returnAddress" THEN
      NEW."deliveryAddress" := NEW."returnAddress";
    END IF;

    IF NEW."returnLat" IS DISTINCT FROM OLD."returnLat" THEN
      NEW."deliveryLat" := NEW."returnLat";
    END IF;

    IF NEW."returnLng" IS DISTINCT FROM OLD."returnLng" THEN
      NEW."deliveryLng" := NEW."returnLng";
    END IF;

    IF NEW."sourceVersion" = 'v1-migration'
      AND NEW."channel" IS DISTINCT FROM OLD."channel"
    THEN
      NEW."sourceSystem" := CASE
        WHEN NEW."channel" = 'HALUO' THEN 'HALUO'::"OrderSourceSystem"
        WHEN NEW."channel" = 'BROWSER_PLUGIN' THEN 'PLUGIN'::"OrderSourceSystem"
        ELSE 'V1_IMPORT'::"OrderSourceSystem"
      END;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Order_sync_v2_compat_fields"
BEFORE INSERT OR UPDATE ON "Order"
FOR EACH ROW EXECUTE FUNCTION "sync_order_v2_compat_fields"();

CREATE OR REPLACE FUNCTION "record_v1_order_source_event"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."sourceVersion" = 'v1-migration' THEN
    INSERT INTO "OrderSourceEvent" (
      "id", "orderId", "sourceSystem", "externalOrderId", "sourceVersion",
      "sourceStatusRaw", "result", "payloadSummary", "receivedAt", "processedAt", "createdAt"
    ) VALUES (
      'v1evt_' || md5(NEW."id"),
      NEW."id",
      NEW."sourceSystem",
      NEW."externalOrderId",
      NEW."sourceVersion",
      NEW."status"::TEXT,
      'MIGRATED'::"OrderSourceEventResult",
      jsonb_strip_nulls(jsonb_build_object(
        'migration', 'v1-compat-write',
        'v1Channel', NEW."channel",
        'v1Status', NEW."status"::TEXT
      )),
      NEW."receivedAt",
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("sourceSystem", "externalOrderId", "sourceVersion") DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Order_record_v1_source_event"
AFTER INSERT ON "Order"
FOR EACH ROW EXECUTE FUNCTION "record_v1_order_source_event"();

CREATE OR REPLACE FUNCTION "sync_operation_log_v2_compat_fields"()
RETURNS TRIGGER AS $$
DECLARE
  resolved_assignment_id TEXT;
BEGIN
  NEW."traceId" := COALESCE(NEW."traceId", NEW."metadataJson" ->> 'traceId');

  IF NEW."entityType" = 'ORDER' THEN
    NEW."orderId" := COALESCE(NEW."orderId", NEW."entityId");
  ELSIF NEW."entityType" = 'DRIVER' THEN
    NEW."driverId" := COALESCE(NEW."driverId", NEW."entityId");
  ELSIF NEW."entityType" = 'ASSIGNMENT' THEN
    resolved_assignment_id := NEW."entityId";
  END IF;

  resolved_assignment_id := COALESCE(
    NEW."assignmentId",
    resolved_assignment_id,
    NEW."metadataJson" ->> 'assignmentId'
  );

  IF resolved_assignment_id IS NOT NULL THEN
    SELECT assignment."id", assignment."orderId", assignment."driverId"
    INTO NEW."assignmentId", NEW."orderId", NEW."driverId"
    FROM "Assignment" AS assignment
    WHERE assignment."id" = resolved_assignment_id;
  ELSE
    NEW."orderId" := COALESCE(NEW."orderId", NEW."metadataJson" ->> 'orderId');
    NEW."driverId" := COALESCE(NEW."driverId", NEW."metadataJson" ->> 'driverId');
  END IF;

  IF NEW."action" = 'START' AND NEW."assignmentId" IS NOT NULL THEN
    UPDATE "Assignment" AS assignment
    SET
      "arrivedAt" = NEW."createdAt",
      "lockType" = 'AUTO_FROZEN'::"AssignmentLockType"
    FROM "Order" AS orders
    WHERE assignment."id" = NEW."assignmentId"
      AND orders."id" = assignment."orderId"
      AND orders."currentAssignmentId" = assignment."id"
      AND orders."status" = 'IN_PROGRESS';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OperationLog_sync_v2_compat_fields"
BEFORE INSERT ON "OperationLog"
FOR EACH ROW EXECUTE FUNCTION "sync_operation_log_v2_compat_fields"();

COMMIT;
