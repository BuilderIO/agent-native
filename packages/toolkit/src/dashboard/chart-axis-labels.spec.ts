import { describe, expect, it } from "vitest";

import { estimateTextWidth, evenTickValues } from "./chart-axis-labels.js";

const days = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    new Date(Date.UTC(2026, 7, 21 + index)).toISOString().slice(0, 10),
  );
const monthDay = (value: unknown) =>
  new Date(`${String(value)}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const RECHARTS_MIN_TICK_GAP = 5;

function shownByRecharts(
  ticks: readonly (string | number)[],
  values: readonly unknown[],
  plotWidth: number,
  fontSize: number,
): (string | number)[] {
  const pointGap = plotWidth / (values.length - 1);
  const shown: (string | number)[] = [];
  let end = plotWidth;
  for (const tick of [...ticks].reverse()) {
    const width = estimateTextWidth(monthDay(tick), fontSize);
    const at = values.indexOf(tick) * pointGap;
    const coordinate = shown.length === 0 ? Math.min(at, end - width / 2) : at;
    if (coordinate - width / 2 >= 0 && coordinate + width / 2 <= end) {
      shown.unshift(tick);
      end = coordinate - width / 2 - RECHARTS_MIN_TICK_GAP;
    }
  }
  return shown;
}

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

  it.each([7, 28, 90])(
    "picks ticks Recharts draws without skipping one, for %i days",
    (count) => {
      const values = days(count);
      for (let plotWidth = 120; plotWidth <= 1200; plotWidth += 7) {
        const ticks = evenTickValues(values, monthDay, plotWidth, 12);
        if (!ticks) continue;
        expect(shownByRecharts(ticks, values, plotWidth, 12)).toEqual(
          expect.arrayContaining(ticks.slice(1)),
        );
      }
    },
  );

  it("keeps a skipped tick out of a 214 px plot of 90 days", () => {
    const values = days(90);
    const ticks = evenTickValues(values, monthDay, 214, 12) ?? [];

    expect(ticks.at(-1)).toBe(values[89]);
    expect(shownByRecharts(ticks, values, 214, 12)).toEqual(
      expect.arrayContaining(ticks.slice(1)),
    );
  });

  it("leaves the ticks to the chart when x values repeat", () => {
    expect(
      evenTickValues(Array(12).fill("2026-11-18"), monthDay, 200, 12),
    ).toBeUndefined();
    expect(
      evenTickValues([1, 2, 2, 3, 4, 5, 6, 7, 8, 9], String, 40, 12),
    ).toBeUndefined();
  });

  it("leaves the ticks to the chart when dates run newest first", () => {
    expect(
      evenTickValues([...days(90)].reverse(), monthDay, 214, 12),
    ).toBeUndefined();
  });

  it("leaves the ticks to the chart before it is measured or for other values", () => {
    expect(evenTickValues(days(28), monthDay, 0, 12)).toBeUndefined();
    expect(
      evenTickValues([{ day: 1 }, { day: 2 }], monthDay, 10, 12),
    ).toBeUndefined();
  });
});
