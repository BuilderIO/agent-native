// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { ChartDrawing, type ChartDrawingProps } from "./ChartDrawing";

function renderChart(props: ChartDrawingProps) {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<ChartDrawing {...props} />));
  return { container, unmount: () => act(() => root.unmount()) };
}

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Expected value to exist");
  return value;
}

function points(element: Element) {
  return (element.getAttribute("data-points") ?? "")
    .split(" ")
    .map((point) => point.split(",").map(Number));
}

it("separates line segments at missing values while preserving zero and raw click values", () => {
  const onMarkClick = vi.fn();
  const chart = renderChart({
    columns: ["day", "amount"],
    rows: [
      ["a", 2],
      ["b", 3],
      ["gap", null],
      ["d", 0],
      ["e", 4],
    ],
    mark: "line",
    onMarkClick,
    legend: true,
    seriesLabels: { amount: "Amount" },
  });
  const lines = [...chart.container.querySelectorAll(".nb-chart-line")];
  expect(lines.map((line) => points(line).length)).toEqual([2, 2]);
  expect(required(required(points(required(lines[0]))[1])[0])).toBeLessThan(
    required(required(points(required(lines[1]))[0])[0]),
  );
  const dots = chart.container.querySelectorAll<SVGElement>(".nb-chart-point");
  expect(dots).toHaveLength(4);
  act(() =>
    required(dots[2]).dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  expect(onMarkClick).toHaveBeenCalledWith({ x: "d", series: "amount" });
  expect(chart.container.textContent).toContain("Amount");
  chart.unmount();
});

it("draws separate stacked area fills against their corresponding lower bounds", () => {
  const chart = renderChart({
    columns: ["day", "base", "upper"],
    rows: [
      ["a", 2, null],
      ["b", 3, 1],
      ["c", 4, 2],
      ["d", 5, null],
      ["e", 6, 0],
      ["f", 7, 4],
      ["g", 8, null],
    ],
    mark: "area",
  });
  const lines = [...chart.container.querySelectorAll(".nb-chart-line")];
  const baseLine = points(required(lines[0]));
  const fills = [...chart.container.querySelectorAll(".nb-chart-area")].map(
    points,
  );
  expect(fills.map((fill) => fill.length)).toEqual([14, 4, 4]);
  expect(required(fills[1]).slice(2)).toEqual([baseLine[2], baseLine[1]]);
  expect(required(fills[2]).slice(2)).toEqual([baseLine[5], baseLine[4]]);
  expect(lines).toHaveLength(3);
  chart.unmount();
});

it("retains a single line and area fill for contiguous values", () => {
  const chart = renderChart({
    columns: ["day", "value"],
    rows: [
      ["a", 1],
      ["b", 0],
      ["c", 2],
    ],
    mark: "area",
    stacked: false,
  });
  expect(chart.container.querySelectorAll(".nb-chart-line")).toHaveLength(1);
  expect(
    points(required(chart.container.querySelector(".nb-chart-line"))),
  ).toHaveLength(3);
  expect(
    points(required(chart.container.querySelector(".nb-chart-area"))),
  ).toHaveLength(6);
  chart.unmount();
});
