// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { ChartDrawing } from "./ChartDrawing";

it("report A2-ASK84-NURTURE-CATEGORY-LABELS", () => {
  const onMarkClick = vi.fn();
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() =>
    root.render(
      <ChartDrawing
        columns={["day", "delivered"]}
        rows={[
          [0, 5],
          [1, 3],
          [-1, 2],
        ]}
        mark="line"
        legend
        seriesLabels={{ "0": "Email", "1": "+1", delivered: "Delivered" }}
        onMarkClick={onMarkClick}
      />,
    ),
  );

  const ticks = [...container.querySelectorAll(".nb-chart-xticks text")].map(
    (node) => node.textContent,
  );
  expect(ticks).toEqual(["Email", "+1", "-1"]);
  expect(container.textContent).toContain("Delivered");
  const points = container.querySelectorAll<SVGElement>(".nb-chart-point");
  act(() => {
    points[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    points[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(onMarkClick.mock.calls).toEqual([
    [{ x: "0", series: "delivered" }],
    [{ x: "1", series: "delivered" }],
  ]);
  act(() => root.unmount());
});
