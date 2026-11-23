// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import {
  ChartDrawing,
  formatChartValue,
  formatDayLabel,
  monotonePath,
  niceTicks,
} from "./ChartDrawing";

function draw(props: Parameters<typeof ChartDrawing>[0]) {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<ChartDrawing {...props} />));
  return { container, unmount: () => act(() => root.unmount()) };
}

it("chooses evenly spaced round axis ticks that include zero", () => {
  expect(niceTicks(0, 557)).toEqual([0, 150, 300, 450, 600]);
  expect(niceTicks(0, 100)).toEqual([0, 25, 50, 75, 100]);
  const ticks = niceTicks(-20, 80);
  expect(ticks).toContain(0);
  expect(ticks[0]).toBeLessThanOrEqual(-20);
  expect(ticks.at(-1)).toBeGreaterThanOrEqual(80);
  const steps = new Set(ticks.slice(1).map((tick, i) => tick - ticks[i]!));
  expect(steps.size).toBe(1);
  expect(niceTicks(0, 0)).toEqual([0, 0.25, 0.5, 0.75, 1]);
});

it("formats axis and tooltip values", () => {
  expect(formatChartValue(1234567)).toBe("1,234,567");
  expect(formatChartValue(0.25, "percent")).toBe("25.00%");
  expect(formatChartValue(-0.5, "percent")).toBe("-50.00%");
  expect(formatChartValue(37.5, "percent")).toBe("37.50%");
  expect(formatDayLabel("2026-08-24")).toBe("Aug 24");
  expect(formatDayLabel("2026-08-24T10:00:00Z")).toBe("Aug 24");
  expect(formatDayLabel("Email")).toBeNull();
});

it("draws a smooth path that does not overshoot between points", () => {
  expect(monotonePath([])).toBe("");
  expect(monotonePath([[0, 5]])).toBe("M 0 5");
  expect(
    monotonePath([
      [0, 0],
      [10, 10],
    ]),
  ).toBe("M 0 0 L 10 10");
  const path = monotonePath([
    [0, 10],
    [10, 0],
    [20, 0],
    [30, 10],
  ]);
  expect(path.startsWith("M 0 10 C")).toBe(true);
  const ys = [
    ...path.matchAll(
      /C ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)/g,
    ),
  ].flatMap((m) => [Number(m[2]), Number(m[4]), Number(m[6])]);
  expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...ys)).toBeLessThanOrEqual(10);
});

it("labels a dated axis as short days and draws five round y ticks", () => {
  const view = draw({
    columns: ["day", "sessions"],
    rows: [
      ["2026-08-24", 120],
      ["2026-08-25", 557],
      ["2026-08-26", 300],
    ],
    mark: "bar",
  });
  const x = [...view.container.querySelectorAll(".nb-chart-xticks text")].map(
    (node) => node.textContent,
  );
  expect(x).toEqual(["Aug 24", "Aug 25", "Aug 26"]);
  const y = [...view.container.querySelectorAll(".nb-chart-yticks text")].map(
    (node) => node.textContent,
  );
  expect(y).toEqual(["0", "150", "300", "450", "600"]);
  view.unmount();
});

it("draws a funnel as stage bars with share of the first stage and drop-off", () => {
  const view = draw({
    columns: ["stage", "people"],
    rows: [
      ["Visited", 200],
      ["Signed up", 50],
    ],
    mark: "funnel",
  });
  const stages = [...view.container.querySelectorAll("[data-funnel-stage]")];
  expect(stages.map((node) => node.getAttribute("data-funnel-stage"))).toEqual([
    "Visited",
    "Signed up",
  ]);
  expect(stages[0]?.textContent).toContain("200 · 100.0%");
  expect(stages[1]?.textContent).toContain("50 · 25.0% · ↓ 75.0%");
  view.unmount();
});
