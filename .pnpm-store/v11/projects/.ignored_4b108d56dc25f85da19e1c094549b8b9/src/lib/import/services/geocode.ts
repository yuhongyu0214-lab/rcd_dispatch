import { AMAP_GEOCODE_TIMEOUT_MS } from "@/lib/import/constants";

export type GeocodeResult =
  | {
      success: true;
      lat: number;
      lng: number;
    }
  | {
      success: false;
      code: "AMAP_KEY_MISSING" | "GEOCODE_FAILED";
      message: string;
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

export async function geocodeAddress(
  address: string,
  addressLabel: "取车地址" | "还车地址"
): Promise<GeocodeResult> {
  const amapKey = process.env.AMAP_SERVER_KEY;

  if (!amapKey) {
    return {
      success: false,
      code: "AMAP_KEY_MISSING",
      message: "未配置 AMAP_SERVER_KEY，已按待补全继续导入"
    };
  }

  const { signal, cleanup } = withTimeoutSignal(AMAP_GEOCODE_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://restapi.amap.com/v3/geocode/geo?key=${encodeURIComponent(amapKey)}&address=${encodeURIComponent(address)}`,
      {
        method: "GET",
        signal,
        cache: "no-store"
      }
    );

    if (!response.ok) {
      return {
        success: false,
        code: "GEOCODE_FAILED",
        message: `${addressLabel}地理编码失败，已按待补全继续导入`
      };
    }

    const payload = (await response.json()) as {
      status?: string;
      geocodes?: Array<{ location?: string }>;
    };

    if (payload.status !== "1" || !payload.geocodes?.[0]?.location) {
      return {
        success: false,
        code: "GEOCODE_FAILED",
        message: `${addressLabel}地理编码失败，已按待补全继续导入`
      };
    }

    const [lngText, latText] = payload.geocodes[0].location.split(",");
    const lng = Number(lngText);
    const lat = Number(latText);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return {
        success: false,
        code: "GEOCODE_FAILED",
        message: `${addressLabel}地理编码失败，已按待补全继续导入`
      };
    }

    return {
      success: true,
      lat,
      lng
    };
  } catch {
    return {
      success: false,
      code: "GEOCODE_FAILED",
      message: `${addressLabel}地理编码超时或失败，已按待补全继续导入`
    };
  } finally {
    cleanup();
  }
}
