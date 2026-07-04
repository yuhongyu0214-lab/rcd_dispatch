-- ============================================================
-- Up Migration: 20260704_production_v1
-- Description: Add GeocodeCache table,
--              extend Driver with lastOnlineAt/lastLat/lastLng (实时定位),
--              extend Order with geocodePickupStatus/geocodeReturnStatus
-- ============================================================

-- -------------------------------------------------------
-- 1. ALTER TABLE "Driver" — 实时定位字段（不记录历史轨迹）
-- -------------------------------------------------------
ALTER TABLE "Driver"
ADD COLUMN "lastOnlineAt" TIMESTAMPTZ,
ADD COLUMN "lastLat"      DOUBLE PRECISION,
ADD COLUMN "lastLng"      DOUBLE PRECISION;

-- -------------------------------------------------------
-- 2. ALTER TABLE "Order" — 地理编码状态
-- -------------------------------------------------------
ALTER TABLE "Order"
ADD COLUMN "geocodePickupStatus" TEXT,
ADD COLUMN "geocodeReturnStatus" TEXT;

-- -------------------------------------------------------
-- 3. CREATE TABLE "GeocodeCache" — 地址地理编码缓存
-- -------------------------------------------------------
CREATE TABLE "GeocodeCache" (
    "id"                TEXT             NOT NULL PRIMARY KEY,
    "normalizedAddress" TEXT             NOT NULL,
    "formattedAddress"  TEXT,
    "lat"               DOUBLE PRECISION,
    "lng"               DOUBLE PRECISION,
    "confidence"        DOUBLE PRECISION,
    "geocodeStatus"     TEXT             NOT NULL,
    "failReason"        TEXT,
    "amapRequestId"     TEXT,
    "expiresAt"         TIMESTAMPTZ,
    "hitCount"          INTEGER          NOT NULL DEFAULT 0,
    "createdAt"         TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    "updatedAt"         TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

-- Unique index on normalizedAddress
CREATE UNIQUE INDEX "GeocodeCache_normalizedAddress_key"
    ON "GeocodeCache"("normalizedAddress");
