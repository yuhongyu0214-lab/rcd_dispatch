-- ============================================================
-- Gate 1: V2 data model rollback
-- Safe window: before V2-only writes are enabled.
-- The script aborts instead of discarding V2-only OperationLog rows.
-- ============================================================

BEGIN;

-- Refuse rollback after V2-only business facts exist. Migration-generated
-- source events are safe because the original V1 Order fields remain intact.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "DriverShift")
    OR EXISTS (SELECT 1 FROM "OrderServicePlan")
    OR EXISTS (SELECT 1 FROM "DispatchAlert")
    OR EXISTS (SELECT 1 FROM "DriverLocationSample")
    OR EXISTS (
      SELECT 1
      FROM "OrderSourceEvent"
      WHERE "result" <> 'MIGRATED'
        OR "sourceVersion" <> 'v1-migration'
    )
  THEN
    RAISE EXCEPTION 'Rollback blocked: V2-only business facts already exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "OperationLog"
    WHERE "entityType"::TEXT IN (
      'ORDER_SOURCE_EVENT', 'DRIVER_SHIFT', 'SERVICE_PLAN', 'DISPATCH_ALERT', 'LOCATION_SAMPLE'
    )
      OR "action"::TEXT IN (
        'AUTO_DISPATCH', 'DEPART', 'ARRIVE', 'MODULE_CHANGE', 'ORDER_MODIFY',
        'ALERT_RESOLVE', 'SHIFT_START', 'SHIFT_END', 'UNLOCK', 'AVAILABILITY_CHANGE'
      )
  ) THEN
    RAISE EXCEPTION 'Rollback blocked: OperationLog contains V2-only enum values';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Order"
    GROUP BY "orderNo"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Rollback blocked: duplicate orderNo values cannot be represented by V1';
  END IF;
END $$;

-- 1. Remove V2-owned tables (V1 tables remain intact)
DROP TRIGGER IF EXISTS "OperationLog_sync_v2_compat_fields" ON "OperationLog";
DROP FUNCTION IF EXISTS "sync_operation_log_v2_compat_fields"();
DROP TRIGGER IF EXISTS "Order_record_v1_source_event" ON "Order";
DROP FUNCTION IF EXISTS "record_v1_order_source_event"();
DROP TRIGGER IF EXISTS "Order_sync_v2_compat_fields" ON "Order";
DROP FUNCTION IF EXISTS "sync_order_v2_compat_fields"();
DROP TRIGGER IF EXISTS "Assignment_increment_v2_plan_version" ON "Assignment";
DROP FUNCTION IF EXISTS "increment_v1_assignment_plan_version"();
DROP FUNCTION IF EXISTS "normalize_driver_assignment_sequences"(TEXT);
DROP TRIGGER IF EXISTS "Assignment_sync_v2_compat_fields" ON "Assignment";
DROP FUNCTION IF EXISTS "sync_assignment_v2_compat_fields"();
DROP TRIGGER IF EXISTS "Driver_sync_v2_compat_fields" ON "Driver";
DROP FUNCTION IF EXISTS "sync_driver_v2_compat_fields"();

DROP TABLE IF EXISTS "DriverLocationSample";
DROP TABLE IF EXISTS "DispatchAlert";
DROP TABLE IF EXISTS "OrderServicePlan";
DROP FUNCTION IF EXISTS "calculate_service_module_minutes"(JSONB);
DROP TABLE IF EXISTS "DriverShift";
DROP TABLE IF EXISTS "OrderSourceEvent";

-- 2. Restore OperationLog to the V1 shape without deleting rows
DROP INDEX IF EXISTS "OperationLog_traceId_idx";
DROP INDEX IF EXISTS "OperationLog_assignmentId_createdAt_idx";
DROP INDEX IF EXISTS "OperationLog_driverId_createdAt_idx";
DROP INDEX IF EXISTS "OperationLog_orderId_createdAt_idx";

ALTER TABLE "OperationLog"
DROP CONSTRAINT IF EXISTS "OperationLog_assignmentId_fkey",
DROP CONSTRAINT IF EXISTS "OperationLog_driverId_fkey",
DROP CONSTRAINT IF EXISTS "OperationLog_orderId_fkey";

ALTER TABLE "OperationLog"
DROP COLUMN IF EXISTS "traceId",
DROP COLUMN IF EXISTS "assignmentId",
DROP COLUMN IF EXISTS "driverId",
DROP COLUMN IF EXISTS "orderId";

-- PostgreSQL cannot remove enum members in place, so rebuild both V1 enums.
ALTER TYPE "OperationEntityType" RENAME TO "OperationEntityType_v2";
CREATE TYPE "OperationEntityType" AS ENUM ('ORDER', 'ASSIGNMENT', 'DRIVER', 'VEHICLE', 'IMPORT_BATCH');
ALTER TABLE "OperationLog"
ALTER COLUMN "entityType" TYPE "OperationEntityType"
USING ("entityType"::TEXT::"OperationEntityType");
DROP TYPE "OperationEntityType_v2";

ALTER TYPE "OperationAction" RENAME TO "OperationAction_v2";
CREATE TYPE "OperationAction" AS ENUM (
  'ASSIGN', 'REASSIGN', 'WITHDRAW', 'RECYCLE', 'CANCEL',
  'ACCEPT', 'START', 'COMPLETE', 'IMPORT'
);
ALTER TABLE "OperationLog"
ALTER COLUMN "action" TYPE "OperationAction"
USING ("action"::TEXT::"OperationAction");
DROP TYPE "OperationAction_v2";

-- 3. Remove Assignment V2 fields
DROP INDEX IF EXISTS "Assignment_active_driver_sequence_key";
DROP INDEX IF EXISTS "Assignment_orderId_lockType_idx";
DROP INDEX IF EXISTS "Assignment_driverId_sequenceNo_idx";

ALTER TABLE "Assignment"
DROP CONSTRAINT IF EXISTS "Assignment_serviceEtaMinutes_check",
DROP CONSTRAINT IF EXISTS "Assignment_deadheadEtaMinutes_check",
DROP CONSTRAINT IF EXISTS "Assignment_sequenceNo_check",
DROP COLUMN IF EXISTS "lastEtaCalculatedAt",
DROP COLUMN IF EXISTS "arrivedAt",
DROP COLUMN IF EXISTS "departedAt",
DROP COLUMN IF EXISTS "lockType",
DROP COLUMN IF EXISTS "etaUnavailableReason",
DROP COLUMN IF EXISTS "serviceEtaMinutes",
DROP COLUMN IF EXISTS "deadheadEtaMinutes",
DROP COLUMN IF EXISTS "plannedCompleteAt",
DROP COLUMN IF EXISTS "plannedPickupAt",
DROP COLUMN IF EXISTS "plannedDepartAt",
DROP COLUMN IF EXISTS "sequenceNo";

-- 4. Remove Order V2 fields; all original V1 fields are untouched
DROP INDEX IF EXISTS "Order_feasibility_executionStatus_idx";
DROP INDEX IF EXISTS "Order_executionStatus_promisedPickupAt_idx";
DROP INDEX IF EXISTS "Order_sourceSystem_externalOrderId_key";
DROP INDEX IF EXISTS "Order_orderNo_idx";
CREATE UNIQUE INDEX "Order_orderNo_key" ON "Order"("orderNo");

ALTER TABLE "Order"
DROP COLUMN IF EXISTS "cancelledAt",
DROP COLUMN IF EXISTS "remark",
DROP COLUMN IF EXISTS "receivedAt",
DROP COLUMN IF EXISTS "promisedPickupAt",
DROP COLUMN IF EXISTS "deliveryLng",
DROP COLUMN IF EXISTS "deliveryLat",
DROP COLUMN IF EXISTS "deliveryAddress",
DROP COLUMN IF EXISTS "slackMinutes",
DROP COLUMN IF EXISTS "feasibility",
DROP COLUMN IF EXISTS "executionStatus",
DROP COLUMN IF EXISTS "sourceVersion",
DROP COLUMN IF EXISTS "externalOrderId",
DROP COLUMN IF EXISTS "sourceSystem";

-- 5. Remove Driver V2 aggregate fields
DROP INDEX IF EXISTS "Driver_onShift_availability_idx";

ALTER TABLE "Driver"
DROP CONSTRAINT IF EXISTS "Driver_lastAccuracyMeters_check",
DROP CONSTRAINT IF EXISTS "Driver_planVersion_check",
DROP COLUMN IF EXISTS "lastLocationCapturedAt",
DROP COLUMN IF EXISTS "lastAccuracyMeters",
DROP COLUMN IF EXISTS "planVersion",
DROP COLUMN IF EXISTS "availability",
DROP COLUMN IF EXISTS "onShift";

-- 6. Remove V2 enums after all dependent objects are gone
DROP TYPE IF EXISTS "DispatchAlertResolvedBy";
DROP TYPE IF EXISTS "DispatchAlertStatus";
DROP TYPE IF EXISTS "DispatchAlertType";
DROP TYPE IF EXISTS "OrderSourceEventResult";
DROP TYPE IF EXISTS "AssignmentLockType";
DROP TYPE IF EXISTS "OrderFeasibility";
DROP TYPE IF EXISTS "OrderExecutionStatus";
DROP TYPE IF EXISTS "OrderSourceSystem";
DROP TYPE IF EXISTS "DriverAvailability";

COMMIT;
