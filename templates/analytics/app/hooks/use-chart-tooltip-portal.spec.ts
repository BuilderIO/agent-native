import { describe, expect, it } from "vitest";

import { getChartTooltipPortalPosition } from "./use-chart-tooltip-portal";

describe("getChartTooltipPortalPosition", () => {
  const chartRect = { left: 100, right: 300, top: 100, bottom: 300 };

  it("lets the tooltip extend beyond the chart beside the cursor", () => {
    expect(
      getChartTooltipPortalPosition({
        chartRect,
        coordinate: { x: 180, y: 180 },
        tooltipSize: { width: 120, height: 60 },
        viewport: { width: 800, height: 600 },
      }),
    ).toEqual({ left: 294, top: 250 });
  });

  it("flips to the other side when the viewport or sidebar leaves no room", () => {
    expect(
      getChartTooltipPortalPosition({
        chartRect,
        coordinate: { x: 180, y: 40 },
        tooltipSize: { width: 180, height: 60 },
        viewport: { width: 800, height: 600, right: 360 },
      }),
    ).toEqual({ left: 86, top: 110 });
  });

  it("uses the viewport edges instead of the chart edges vertically", () => {
    expect(
      getChartTooltipPortalPosition({
        chartRect,
        coordinate: { x: 80, y: 190 },
        tooltipSize: { width: 120, height: 80 },
        viewport: { width: 800, height: 600 },
      }).top,
    ).toBe(250);
  });
});
