// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OutputPreview } from "./OutputPreview.js";

describe("OutputPreview chart accessibility", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("includes plotted points in the chart accessible name", () => {
    act(() => {
      root.render(
        <OutputPreview
          answer={JSON.stringify({
            type: "chart",
            title: "Latency",
            unit: "ms",
            data: [
              { label: "p50", value: 120 },
              { label: "p95", value: 480 },
            ],
          })}
          previewLabel="Agent output"
        />,
      );
    });

    const chart = container.querySelector('[data-preview-kind="chart"]');
    expect(chart?.getAttribute("role")).toBe("img");
    expect(chart?.getAttribute("aria-label")).toBe(
      "Latency: p50: 120ms, p95: 480ms",
    );
  });
});
