// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { DataChartWidget as DataChartWidgetData } from "./data-widget-types.js";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { DataChartRenderer } from "./DataChartRenderer.js";

describe("DataChartRenderer tooltip width", () => {
  it("widens the tooltip while preserving its right-edge anchor and height", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const chart = {
      type: "bar",
      layout: "horizontal",
      xKey: "category",
      xAxisTitle: "Value",
      yAxisTitle: "Category",
      series: [{ key: "value", label: "Value" }],
      data: [{ category: "beta", value: 2 }],
    } as DataChartWidgetData;

    try {
      await act(async () => {
        root.render(<DataChartRenderer chart={chart} />);
      });

      const chartRoot = container.querySelector("svg")?.parentElement;
      if (!chartRoot) throw new Error("Expected a chart wrapper");
      vi.spyOn(chartRoot, "getBoundingClientRect").mockReturnValue(
        new DOMRect(100, 50, 640, 360),
      );
      const mark = container.querySelector<SVGRectElement>("svg rect");
      if (!mark) throw new Error("Expected a rendered bar mark");

      await act(async () => {
        mark.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            pointerId: 1,
            pointerType: "mouse",
            clientX: 500,
            clientY: 200,
          }),
        );
      });

      const tooltip = container.querySelector<HTMLElement>('[role="tooltip"]');
      expect(tooltip?.className).toContain("px-2.5");
      expect(tooltip?.className).toContain("py-1.5");
      expect(tooltip?.className).toContain("leading-5");
      expect(tooltip?.style.left).toBe("392px");
      expect(tooltip?.style.top).toBe("142px");
      expect(tooltip?.style.transform).toBe("translateX(-100%)");
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});
