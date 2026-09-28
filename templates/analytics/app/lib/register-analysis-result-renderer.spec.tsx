// @vitest-environment happy-dom

import { AgentKitActionWidget } from "@agent-native/core/client/agentkit-chat";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  DEFAULT_LOCALE: "en-US",
  useT: () => (key: string, options?: Record<string, unknown>) => {
    if (key === "analysisResult.title") return "Analysis result";
    if (key === "analysisResult.comparisonContext") {
      return `${String(options?.period)}: ${String(options?.current)} vs ${String(options?.previous)}`;
    }
    if (key === "agentChat.widget.downloadCsv") return "Download CSV";
    return key;
  },
  useOptionalLocale: () => ({ locale: "en-US" }),
  useFormatters: () => ({
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat("en-US", options).format(value),
  }),
}));

import {
  resolveToolRenderer,
  type ToolRendererContext,
} from "@agent-native/core/client/chat";
import { ANALYTICS_ANALYSIS_RESULT_RENDERER } from "@shared/analysis-result";

import "./register-analysis-result-renderer";

describe("Analytics analysis result renderer", () => {
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
    vi.unstubAllGlobals();
  });

  it("renders a localized large number and its metric label", async () => {
    expect(AgentKitActionWidget).toBeDefined();
    const context: ToolRendererContext = {
      toolName: "query-agent-native-analytics",
      args: {},
      resultJson: {
        rows: [{ weekly_active_users: 48200 }],
        schema: [{ name: "weekly_active_users", type: "number" }],
      },
      isRunning: false,
      chatUI: { renderer: ANALYTICS_ANALYSIS_RESULT_RENDERER },
    };
    const Renderer = resolveToolRenderer(context);
    if (!Renderer)
      throw new Error("Analytics result renderer is not registered");

    await act(async () => {
      root.render(<Renderer context={context} />);
    });

    expect(
      container.querySelector("[data-analysis-result-card]"),
    ).not.toBeNull();
    expect(container.textContent).toContain("Analysis result");
    expect(container.textContent).toContain("48,200");
    expect(container.textContent).toContain("weekly active users");
    expect(
      container
        .querySelector("[data-analysis-result-card]")
        ?.classList.contains("border"),
    ).toBe(false);
  });

  it("renders a localized comparison delta with its period context", async () => {
    const context: ToolRendererContext = {
      toolName: "query-agent-native-analytics",
      args: {},
      resultJson: {
        rows: [
          {
            metric: "activated users",
            current_value: 482,
            previous_value: 408,
            period: "Last 30 days",
          },
        ],
        schema: [
          { name: "metric", type: "string" },
          { name: "current_value", type: "number" },
          { name: "previous_value", type: "number" },
          { name: "period", type: "string" },
        ],
      },
      isRunning: false,
      chatUI: { renderer: ANALYTICS_ANALYSIS_RESULT_RENDERER },
    };
    const Renderer = resolveToolRenderer(context);
    if (!Renderer)
      throw new Error("Analytics result renderer is not registered");

    await act(async () => {
      root.render(<Renderer context={context} />);
    });

    const output = container.querySelector("output");
    expect(output?.children[0]?.textContent).toBe("+18.1%");
    expect(output?.children[1]?.textContent).toBe("activated users");
    expect(container.textContent).toContain("Last 30 days: 482 vs 408");
  });

  it("keeps sub-percent changes visible", async () => {
    const context: ToolRendererContext = {
      toolName: "query-agent-native-analytics",
      args: {},
      resultJson: {
        rows: [
          {
            metric: "activated users",
            current_value: 1004,
            previous_value: 1000,
            period: "Last 30 days",
          },
        ],
        schema: [
          { name: "metric", type: "string" },
          { name: "current_value", type: "number" },
          { name: "previous_value", type: "number" },
          { name: "period", type: "string" },
        ],
      },
      isRunning: false,
      chatUI: { renderer: ANALYTICS_ANALYSIS_RESULT_RENDERER },
    };
    const Renderer = resolveToolRenderer(context);
    if (!Renderer)
      throw new Error("Analytics result renderer is not registered");

    await act(async () => {
      root.render(<Renderer context={context} />);
    });

    expect(container.querySelector("output")?.children[0]?.textContent).toBe(
      "+0.4%",
    );
  });

  it("keeps non-scalar results out of the metric card", async () => {
    const context: ToolRendererContext = {
      toolName: "query-agent-native-analytics",
      args: {},
      resultJson: {
        rows: [{ weekly_active_users: 48200 }, { weekly_active_users: 50100 }],
        schema: [{ name: "weekly_active_users", type: "number" }],
      },
      isRunning: false,
      chatUI: { renderer: ANALYTICS_ANALYSIS_RESULT_RENDERER },
    };
    const Renderer = resolveToolRenderer(context);
    if (!Renderer)
      throw new Error("Analytics result renderer is not registered");
    expect(
      resolveToolRenderer({
        ...context,
        chatUI: { renderer: "core.data-table" },
      }),
    ).not.toBeNull();

    await act(async () => {
      root.render(<Renderer context={context} />);
    });

    expect(container.querySelector("[data-analysis-result-card]")).toBeNull();
  });

  it("reuses the standard table renderer when query rows were requested", async () => {
    const context: ToolRendererContext = {
      toolName: "query-agent-native-analytics",
      args: { showTable: true },
      resultJson: {
        widget: "data-table",
        table: {
          title: "Analytics query result",
          columns: [{ key: "events", label: "Events", align: "right" }],
          rows: [{ events: 3 }],
        },
      },
      isRunning: false,
      chatUI: { renderer: ANALYTICS_ANALYSIS_RESULT_RENDERER },
    };
    const Renderer = resolveToolRenderer(context);
    if (!Renderer)
      throw new Error("Analytics result renderer is not registered");

    await act(async () => {
      root.render(<Renderer context={context} />);
    });

    expect(container.querySelector("[data-analysis-result-card]")).toBeNull();
    await vi.waitFor(() => {
      expect(container.querySelector("table th")?.textContent).toBe("Events");
    });
    expect(container.textContent).toContain("Download CSV");
  });
});
