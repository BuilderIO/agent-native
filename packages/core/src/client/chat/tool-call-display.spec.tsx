// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentMcpAppPayload } from "../../mcp-client/app-result.js";
import { ToolCallDisplay } from "./tool-call-display.js";
import {
  clearReservedToolRenderersForTests,
  clearToolRenderersForTests,
  registerToolRenderer,
  type ToolRendererProps,
} from "./tool-render-registry.js";
import {
  resolveBuiltinActionChatRenderer,
  resolveBuiltinFallbackToolRenderer,
} from "./widgets/builtin-tool-renderers.js";

vi.mock("../mcp-apps/McpAppRenderer.js", () => ({
  McpAppRenderer: () => <div data-testid="mcp-app">MCP APP</div>,
}));

function dataInsightPayload(extra: Record<string, unknown> = {}) {
  return {
    widget: "data-insights",
    summary: { responses: 1 },
    chartSeries: {
      type: "bar",
      title: "Responses by day",
      xKey: "date",
      series: [{ key: "submissions", label: "Submissions" }],
      data: [{ date: "2026-06-18", submissions: 1 }],
    },
    table: {
      title: "Recent rows",
      columns: [{ key: "name", label: "Name" }],
      rows: [{ id: "row-1", name: "Ada" }],
      totalRows: 1,
      sampledRows: 1,
      truncated: false,
    },
    ...extra,
  };
}

function dataInsightResult(extra: Record<string, unknown> = {}) {
  return JSON.stringify(dataInsightPayload(extra));
}

function AppRenderer(_: ToolRendererProps) {
  return <div>App renderer wins</div>;
}

const mcpApp: AgentMcpAppPayload = {
  serverId: "server",
  toolName: "tool",
  originalToolName: "tool",
  resourceUri: "ui://tool",
  toolInput: {},
  toolResult: {},
};

describe("ToolCallDisplay native renderers", () => {
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
    clearToolRenderersForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders explicit data widgets natively", () => {
    act(() => {
      root.render(
        <ToolCallDisplay
          toolName="response-insights"
          args={{}}
          result={dataInsightResult()}
          isRunning={false}
        />,
      );
    });

    expect(container.textContent).toContain("Recent rows");
    expect(container.textContent).toContain("Ada");
  });

  it("falls back for malformed widget payloads", () => {
    act(() => {
      root.render(
        <ToolCallDisplay
          toolName="response-insights"
          args={{}}
          result={JSON.stringify({ widget: "data-table" })}
          isRunning={false}
        />,
      );
    });

    expect(container.textContent).toContain("response insights");
    expect(container.textContent).not.toContain("Data table");
  });

  it("keeps agent tool calls out of native widget rendering", () => {
    act(() => {
      root.render(
        <ToolCallDisplay
          toolName="agent:forms"
          args={{}}
          result={dataInsightResult()}
          isRunning={false}
        />,
      );
    });

    expect(container.textContent).toContain("Asked forms");
    expect(container.textContent).not.toContain("Recent rows");
  });

  it("renders explicit native widgets ahead of MCP Apps metadata", () => {
    act(() => {
      root.render(
        <ToolCallDisplay
          toolName="response-insights"
          args={{}}
          result={dataInsightResult()}
          mcpApp={mcpApp}
          isRunning={false}
        />,
      );
    });

    expect(container.textContent).toContain("Recent rows");
    expect(container.textContent).toContain("Ada");
    expect(container.textContent).not.toContain("MCP APP");
  });

  it("renders MCP Apps when there is no native widget payload", () => {
    act(() => {
      root.render(
        <ToolCallDisplay
          toolName="external-widget"
          args={{}}
          result={JSON.stringify({ ok: true })}
          mcpApp={mcpApp}
          isRunning={false}
        />,
      );
    });

    expect(container.textContent).toContain("MCP APP");
  });

  it("renders action-declared native data widgets without relying on widget shape inference", () => {
    act(() => {
      root.render(
        <ToolCallDisplay
          toolName="top-customers"
          args={{}}
          result={JSON.stringify({
            table: {
              title: "Top customers",
              columns: [{ key: "name", label: "Name" }],
              rows: [{ name: "Ada" }],
            },
          })}
          chatUI={{ renderer: "core.data-table" }}
          isRunning={false}
        />,
      );
    });

    expect(container.textContent).toContain("Top customers");
    expect(container.textContent).toContain("Ada");
  });

  it("keeps built-in data widget renderer identities stable across resolves", () => {
    const context = {
      toolName: "top-customers",
      args: {},
      resultJson: {
        chartSeries: {
          type: "bar",
          title: "Responses by day",
          xKey: "date",
          series: [{ key: "submissions", label: "Submissions" }],
          data: [{ date: "2026-06-18", submissions: 1 }],
        },
      },
      isRunning: false,
      chatUI: { renderer: "core.data-chart" },
    } as const;

    expect(resolveBuiltinActionChatRenderer(context)).toBe(
      resolveBuiltinActionChatRenderer(context),
    );
    expect(resolveBuiltinFallbackToolRenderer(context)).toBe(
      resolveBuiltinFallbackToolRenderer(context),
    );
  });

  it("falls back instead of rendering blank for malformed action-declared data widgets", () => {
    act(() => {
      root.render(
        <ToolCallDisplay
          toolName="response-insights"
          args={{}}
          result='{"widget":"data-insights","chartSeries":'
          chatUI={{ renderer: "core.data-insights" }}
          isRunning={false}
        />,
      );
    });

    expect(container.textContent).toContain("response insights");
    expect(container.textContent).not.toContain("Responses by day");
  });

  it("renders render-data-widget from input when the echoed result is truncated", () => {
    act(() => {
      root.render(
        <ToolCallDisplay
          toolName="render-data-widget"
          args={dataInsightPayload()}
          result='{"widget":"data-insights","chartSeries":'
          isRunning={false}
        />,
      );
    });

    expect(container.textContent).toContain("Responses by day");
    expect(container.textContent).toContain("Recent rows");
    expect(container.textContent).not.toContain("render data widget");
  });

  it("lets app-specific renderers override the generic explicit widget fallback", () => {
    registerToolRenderer({
      id: "app.response-insights",
      match: "response-insights",
      Component: AppRenderer,
    });

    act(() => {
      root.render(
        <ToolCallDisplay
          toolName="response-insights"
          args={{}}
          result={dataInsightResult()}
          isRunning={false}
        />,
      );
    });

    expect(container.textContent).toContain("App renderer wins");
    expect(container.textContent).not.toContain("Recent rows");
  });

  it("renders built-in data widgets even when registry side effects are absent", () => {
    clearReservedToolRenderersForTests();

    act(() => {
      root.render(
        <ToolCallDisplay
          toolName="render-data-widget"
          args={dataInsightPayload()}
          result={dataInsightResult()}
          isRunning={false}
        />,
      );
    });

    expect(container.textContent).toContain("Responses by day");
    expect(container.textContent).toContain("Recent rows");
  });
});
