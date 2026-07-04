BEGIN;

DROP INDEX IF EXISTS "Order_importBatchId_idx";

ALTER TABLE "Order"
DROP COLUMN IF EXISTS "channel",
DROP COLUMN IF EXISTS "driverNameSnapshot",
DROP COLUMN IF EXISTS "importBatchId",
DROP COLUMN IF EXISTS "pickupLat",
DROP COLUMN IF EXISTS "pickupLng",
DROP COLUMN IF EXISTS "returnLat",
DROP COLUMN IF EXISTS "returnLng",
DROP COLUMN IF EXISTS "vehicleTypeSnapshot";

DELETE FROM "OperationLog"
WHERE "entityType" = 'IMPORT_BATCH' OR "action" = 'IMPORT';

ALTER TABLE "Order" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
CREATE TYPE "OrderStatus" AS ENUM (
  'UNIMPORTED',
  'PENDING',
  'RECOMMENDING',
  'ASSIGNED',
  'ACCEPTED',
  'IN_PROGRESS',
  'COMPLETED',
  'RECYCLED',
  'CANCELLED'
);
ALTER TABLE "Order"
  ALTER COLUMN "status" TYPE "OrderStatus"
  USING ("status"::text::"OrderStatus");
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'PENDING';
DROP TYPE "OrderStatus_old";

ALTER TYPE "OperationAction" RENAME TO "OperationAction_old";
CREATE TYPE "OperationAction" AS ENUM (
  'ASSIGN',
  'REASSIGN',
  'WITHDRAW',
  'RECYCLE',
  'CANCEL',
  'ACCEPT',
  'START',
  'COMPLETE'
);
ALTER TABLE "OperationLog"
  ALTER COLUMN "action" TYPE "OperationAction"
  USING ("action"::text::"OperationAction");
DROP TYPE "OperationAction_old";

ALTER TYPE "OperationEntityType" RENAME TO "OperationEntityType_old";
CREATE TYPE "OperationEntityType" AS ENUM (
  'ORDER',
  'ASSIGNMENT',
  'DRIVER',
  'VEHICLE'
);
ALTER TABLE "OperationLog"
  ALTER COLUMN "entityType" TYPE "OperationEntityType"
  USING ("entityType"::text::"OperationEntityType");
DROP TYPE "OperationEntityType_old";

COMMIT;
