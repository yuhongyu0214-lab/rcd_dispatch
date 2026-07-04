-- ============================================================
-- Down Migration (Rollback): 20260704_production_v1
-- ============================================================

-- 1. DROP TABLE "GeocodeCache"
DROP TABLE IF EXISTS "GeocodeCache";

-- 2. ALTER TABLE "Order" — 移除地理编码状态字段
ALTER TABLE "Order"
DROP COLUMN IF EXISTS "geocodePickupStatus",
DROP COLUMN IF EXISTS "geocodeReturnStatus";

-- 3. ALTER TABLE "Driver" — 移除实时定位字段
ALTER TABLE "Driver"
DROP COLUMN IF EXISTS "lastOnlineAt",
DROP COLUMN IF EXISTS "lastLat",
DROP COLUMN IF EXISTS "lastLng";
