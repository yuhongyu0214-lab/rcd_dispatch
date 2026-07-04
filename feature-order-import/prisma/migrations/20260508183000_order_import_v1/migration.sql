-- AlterEnum
ALTER TYPE "OperationEntityType" ADD VALUE IF NOT EXISTS 'IMPORT_BATCH';

-- AlterEnum
ALTER TYPE "OperationAction" ADD VALUE IF NOT EXISTS 'IMPORT';

-- AlterEnum
BEGIN;

ALTER TABLE "Order" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
CREATE TYPE "OrderStatus" AS ENUM (
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

COMMIT;

-- AlterTable
ALTER TABLE "Order"
ADD COLUMN "channel" TEXT,
ADD COLUMN "driverNameSnapshot" TEXT,
ADD COLUMN "importBatchId" TEXT,
ADD COLUMN "pickupLat" DOUBLE PRECISION,
ADD COLUMN "pickupLng" DOUBLE PRECISION,
ADD COLUMN "returnLat" DOUBLE PRECISION,
ADD COLUMN "returnLng" DOUBLE PRECISION,
ADD COLUMN "vehicleTypeSnapshot" TEXT;

-- CreateIndex
CREATE INDEX "Order_importBatchId_idx" ON "Order"("importBatchId");
