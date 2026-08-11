import { describe, expect, it } from "vitest";

import { drivingRoute } from "./amap";

const describeLive =
  process.env.GATE3_AMAP_INTEGRATION === "1" ? describe : describe.skip;

describeLive("Gate 3 live Amap verification", () => {
  it(
    "returns a positive distance and duration with the configured server key",
    async () => {
      const route = await drivingRoute(
        { lat: 31.1979, lng: 121.3363 },
        { lat: 31.2304, lng: 121.4737 }
      );

      expect(route.distance).toBeGreaterThan(0);
      expect(route.duration).toBeGreaterThan(0);
    },
    30_000
  );

  it(
    "returns no route for a destination outside the driving service area",
    async () => {
      await expect(
        drivingRoute(
          { lat: 31.2304, lng: 121.4737 },
          { lat: 0, lng: 0 }
        )
      ).rejects.toThrow("AMAP_NO_ROUTE_FOUND");
    },
    30_000
  );
});
