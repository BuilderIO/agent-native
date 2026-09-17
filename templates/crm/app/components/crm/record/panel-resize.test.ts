import { describe, expect, it } from "vitest";

import {
  clampPanelPercent,
  DEFAULT_RECORD_PANEL_PERCENT,
} from "./panel-resize";

describe("clampPanelPercent", () => {
  it("passes a comfortable width straight through", () => {
    expect(clampPanelPercent(35, 1400)).toBe(35);
  });

  it("holds the pane's 320px floor", () => {
    // 10% of 1400 is 140px, below the 320px minimum.
    expect(clampPanelPercent(10, 1400)).toBeCloseTo((320 / 1400) * 100, 5);
  });

  it("never exceeds 60% however wide the region gets", () => {
    expect(clampPanelPercent(95, 4000)).toBe(60);
  });

  it("leaves the main pane its 350px minimum before honouring 60%", () => {
    // 60% of 700 would leave the main pane 280px.
    expect(clampPanelPercent(60, 700)).toBeCloseTo((350 / 700) * 100, 5);
  });

  it("gives the main pane its floor when both floors cannot fit", () => {
    expect(clampPanelPercent(50, 500)).toBeCloseTo((150 / 500) * 100, 5);
  });

  it("falls back to the default rather than emitting NaN geometry", () => {
    expect(clampPanelPercent(Number.NaN, 1400)).toBe(
      DEFAULT_RECORD_PANEL_PERCENT,
    );
    expect(clampPanelPercent(35, 0)).toBe(DEFAULT_RECORD_PANEL_PERCENT);
  });
});
