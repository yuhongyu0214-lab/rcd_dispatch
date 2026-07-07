import { AMAP_GEOCODE_TIMEOUT_MS } from "@/lib/import/constants";
import type { GeocodeIngestStatus } from "@/lib/ingest/normalize";

export type GeocodeResult =
  | {
      success: true;
      lat: number;
      lng: number;
      geocodeStatus: GeocodeIngestStatus;
    }
  | {
      success: false;
      code: "AMAP_KEY_MISSING" | "GEOCODE_FAILED" | "CITY_MISMATCH";
      message: string;
      geocodeStatus: GeocodeIngestStatus;
    };

function withTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
    }
  };
}

/**
 * 地理编码：地址 → 坐标。
 * 支持可选的 city 参数用于限定搜索范围（提高短地址命中率）。
 */
export async function geocodeAddress(
  address: string,
  addressLabel: "取车地址" | "还车地址",
  city?: string
): Promise<GeocodeResult> {
  const amapKey = process.env.AMAP_SERVER_KEY;

  if (!amapKey) {
    return {
      success: false,
      code: "AMAP_KEY_MISSING",
      message: "未配置 AMAP_SERVER_KEY，已按待补全继续导入",
      geocodeStatus: "FAILED"
    };
  }

  const { signal, cleanup } = withTimeoutSignal(AMAP_GEOCODE_TIMEOUT_MS);

  try {
    const url = new URL("https://restapi.amap.com/v3/geocode/geo");
    url.searchParams.set("key", amapKey);
    url.searchParams.set("address", address);
    if (city) {
      url.searchParams.set("city", city);
    }

    const response = await fetch(url, {
      method: "GET",
      signal,
      cache: "no-store"
    });

    if (!response.ok) {
      return {
        success: false,
        code: "GEOCODE_FAILED",
        message: `${addressLabel}地理编码失败，已按待补全继续导入`,
        geocodeStatus: "FAILED"
      };
    }

    const payload = (await response.json()) as {
      status?: string;
      geocodes?: Array<{
        location?: string;
        formatted_address?: string;
        city?: string;
      }>;
    };

    if (payload.status !== "1" || !payload.geocodes?.[0]?.location) {
      return {
        success: false,
        code: "GEOCODE_FAILED",
        message: `${addressLabel}地理编码失败，已按待补全继续导入`,
        geocodeStatus: "FAILED"
      };
    }

    const [lngText, latText] = payload.geocodes[0].location.split(",");
    const lng = Number(lngText);
    const lat = Number(latText);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return {
        success: false,
        code: "GEOCODE_FAILED",
        message: `${addressLabel}地理编码失败，已按待补全继续导入`,
        geocodeStatus: "FAILED"
      };
    }

    // 校验高德返回的城市与传入城市是否一致
    if (city) {
      const returnedCity = payload.geocodes[0].city;
      if (returnedCity && !returnedCity.includes(city.replace("市", ""))) {
        return {
          success: false,
          code: "CITY_MISMATCH",
          message: `${addressLabel}返回城市(${returnedCity})与传入城市(${city})不一致，坐标已丢弃`,
          geocodeStatus: "CITY_MISMATCH"
        };
      }
    }

    return {
      success: true,
      lat,
      lng,
      geocodeStatus: "SUCCESS"
    };
  } catch {
    return {
      success: false,
      code: "GEOCODE_FAILED",
      message: `${addressLabel}地理编码超时或失败，已按待补全继续导入`,
      geocodeStatus: "FAILED"
    };
  } finally {
    cleanup();
  }
}
