import { describe, expect, it } from "vitest";

import { evenTickValues } from "./chart-axis-labels.js";

const days = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    new Date(Date.UTC(2026, 9, 22 + index)).toISOString().slice(0, 10),
  );
const monthDay = (value: unknown) => String(value).slice(5);

describe("evenTickValues", () => {
  it("leaves the ticks to the chart when every label fits", () => {
    expect(evenTickValues(days(7), monthDay, 600, 12)).toBeUndefined();
  });

  it("labels every Nth day, counting back from the newest", () => {
    const values = days(28);
    const ticks = evenTickValues(values, monthDay, 300, 12) ?? [];
    const positions = ticks.map((tick) => values.indexOf(String(tick)));
    const gaps = positions.slice(1).map((at, index) => at - positions[index]);

    expect(ticks.at(-1)).toBe(values[27]);
    expect(ticks.length).toBeGreaterThan(2);
    expect(ticks.length).toBeLessThanOrEqual(6);
    expect(new Set(gaps).size).toBe(1);
  });

  it("leaves the ticks to the chart before it is measured or for other values", () => {
    expect(evenTickValues(days(28), monthDay, 0, 12)).toBeUndefined();
    expect(
      evenTickValues([{ day: 1 }, { day: 2 }], monthDay, 10, 12),
    ).toBeUndefined();
  });
});
