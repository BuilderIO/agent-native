// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentMcpAppPayload } from "../../mcp-client/app-result.js";
import { ToolCallDisplay } from "./tool-call-display.js";

vi.mock("../mcp-apps/McpAppRenderer.js", () => ({
  McpAppRenderer: () => <div data-testid="mcp-app">MCP APP</div>,
}));

function dataInsightResult(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    widget: "data-insights",
    summary: { responses: 1 },
    table: {
      title: "Recent rows",
      columns: [{ key: "name", label: "Name" }],
      rows: [{ id: "row-1", name: "Ada" }],
      totalRows: 1,
      sampledRows: 1,
      truncated: false,
    },
    ...extra,
  });
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
});
