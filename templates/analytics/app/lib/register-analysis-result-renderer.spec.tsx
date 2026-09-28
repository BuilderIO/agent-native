// @vitest-environment happy-dom

import { AgentKitActionWidget } from "@agent-native/core/client/agentkit-chat";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  DEFAULT_LOCALE: "en-US",
  useT: () => (key: string) => {
    if (key === "analysisResult.title") return "Analysis result";
    if (key === "agentChat.widget.downloadCsv") return "Download CSV";
    return key;
  },
  useOptionalLocale: () => ({ locale: "en-US" }),
  useFormatters: () => ({
    formatNumber: (value: number) => value.toLocaleString("en-US"),
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
