BEGIN;

DROP TABLE IF EXISTS "OperationLog";

-- Break the circular Order <-> Assignment reference before dropping either table.
ALTER TABLE IF EXISTS "Order"
DROP CONSTRAINT IF EXISTS "Order_currentAssignmentId_fkey";

DROP TABLE IF EXISTS "Assignment";
DROP TABLE IF EXISTS "Order";
DROP TABLE IF EXISTS "Vehicle";
DROP TABLE IF EXISTS "Driver";
DROP TABLE IF EXISTS "Store";

DROP TYPE IF EXISTS "OperationAction";
DROP TYPE IF EXISTS "OperationEntityType";
DROP TYPE IF EXISTS "AssignmentStatus";
DROP TYPE IF EXISTS "AssignmentType";
DROP TYPE IF EXISTS "OrderStatus";
DROP TYPE IF EXISTS "OrderType";
DROP TYPE IF EXISTS "VehicleStatus";
DROP TYPE IF EXISTS "DriverStatus";

COMMIT;
