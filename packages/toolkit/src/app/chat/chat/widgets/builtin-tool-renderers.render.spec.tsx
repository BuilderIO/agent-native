// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolRendererContext } from "../tool-render-registry.js";
import { resolveBuiltinActionChatRenderer } from "./builtin-tool-renderers.js";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

const chartSeries = {
  type: "bar",
  title: "Responses by day",
  xKey: "date",
  series: [{ key: "submissions", label: "Submissions" }],
  data: [{ date: "2026-06-18", submissions: 1 }],
};

function chartContext(
  renderer: "core.data-chart" | "core.data-widget",
  summary: unknown,
): ToolRendererContext {
  const summaryField = summary === undefined ? {} : { summary };
  const resultJson =
    renderer === "core.data-chart"
      ? { ...summaryField, chartSeries }
      : { widget: "data-chart", ...summaryField, chartSeries };
  return {
    toolName: "query-support-metrics",
    args: {},
    resultJson,
    isRunning: false,
    chatUI: { renderer },
  };
}

describe("built-in chart semantic-model attribution", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function render(context: ToolRendererContext) {
    const Renderer = resolveBuiltinActionChatRenderer(context);
    if (!Renderer) throw new Error("No built-in renderer matched the chart");
    await act(async () => root.render(<Renderer context={context} />));
    await act(async () => vi.dynamicImportSettled());
  }

  it.each(["core.data-chart", "core.data-widget"] as const)(
    "renders trimmed attribution after a valid %s chart result",
    async (renderer) => {
      await render(
        chartContext(renderer, { semanticModelName: "  Support metrics  " }),
      );

      const attribution = container.querySelector(
        '[data-testid="data-widget-semantic-model-attribution"]',
      );
      expect(attribution?.textContent).toBe("Support metrics");
      expect(attribution?.previousElementSibling?.textContent).toContain(
        "Responses by day",
      );
    },
  );

  it.each([
    ["missing", undefined],
    ["wrong type", { semanticModelName: 42 }],
    ["blank", { semanticModelName: "  \n " }],
    ["too long", { semanticModelName: "m".repeat(201) }],
  ])(
    "omits attribution for %s semantic model metadata",
    async (_name, summary) => {
      await render(chartContext("core.data-widget", summary));
      expect(
        container.querySelector(
          '[data-testid="data-widget-semantic-model-attribution"]',
        ),
      ).toBeNull();
    },
  );

  it("does not render an attribution without a valid built-in chart", async () => {
    const context = chartContext("core.data-widget", {
      semanticModelName: "Support metrics",
    });
    const Renderer = resolveBuiltinActionChatRenderer(context);
    if (!Renderer) throw new Error("No built-in renderer matched the chart");
    context.resultJson = {
      widget: "data-chart",
      summary: { semanticModelName: "Support metrics" },
      chartSeries: { type: "unknown", data: [] },
    };
    await act(async () => root.render(<Renderer context={context} />));

    expect(
      container.querySelector(
        '[data-testid="data-widget-semantic-model-attribution"]',
      ),
    ).toBeNull();
  });
});
