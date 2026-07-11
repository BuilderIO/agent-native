// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentMcpAppPayload } from "../../mcp-client/app-result.js";
import type { ContentPart } from "../sse-event-processor.js";
import {
  ChatRunningContext,
  ReconnectStreamMessage,
  ToolCallDisplay,
  ToolCallFallback,
  TOOL_LONG_RUNNING_HINT_DELAY_MS,
  formatWorkedDuration,
  ReasoningCell,
  WorkedForSummary,
  toolInputPayload,
} from "./tool-call-display.js";
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

vi.mock("../extensions/InlineExtensionFrame.js", () => ({
  InlineExtensionFrame: ({ extensionId, extension }: any) => (
    <div
      data-testid="inline-extension-frame"
      data-extension-id={extensionId ?? extension?.id}
      data-extension-mode={extension?.mode}
    >
      {extension?.name}
    </div>
  ),
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

  it("renders chart-only data insight payloads without a table", () => {
    act(() => {
      root.render(
        <ToolCallDisplay
          toolName="response-insights"
          args={{}}
          result={dataInsightResult({ table: undefined })}
          isRunning={false}
        />,
      );
    });

    expect(container.textContent).toContain("Responses by day");
    expect(container.textContent).not.toContain("Recent rows");
    expect(container.textContent).not.toContain("Ada");
  });

  it("renders table-only data insight payloads without a chart", () => {
    act(() => {
      root.render(
        <ToolCallDisplay
          toolName="response-insights"
          args={{}}
          result={dataInsightResult({ chartSeries: undefined })}
          isRunning={false}
        />,
      );
    });

    expect(container.textContent).toContain("Recent rows");
    expect(container.textContent).toContain("Ada");
    expect(container.textContent).not.toContain("Responses by day");
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

  it("shows activity tool cards as running even between continuation posts", () => {
    act(() => {
      root.render(
        <ChatRunningContext.Provider value={false}>
          <ToolCallFallback
            toolName="generate-design"
            args={{}}
            argsText=""
            activity
          />
        </ChatRunningContext.Provider>,
      );
    });

    expect(container.textContent).toContain("generate design");
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("shows a subtle long-running hint after a running tool stays active", () => {
    vi.useFakeTimers();
    try {
      act(() => {
        root.render(
          <ToolCallDisplay toolName="edit-design" args={{}} isRunning={true} />,
        );
      });

      expect(container.textContent).toContain("edit screen");
      expect(container.textContent).not.toContain(
        "Large updates can take a minute or two.",
      );

      act(() => {
        vi.advanceTimersByTime(TOOL_LONG_RUNNING_HINT_DELAY_MS);
      });

      expect(container.textContent).toContain(
        "Still working. Large updates can take a minute or two.",
      );

      act(() => {
        root.render(
          <ToolCallDisplay
            toolName="edit-design"
            args={{}}
            isRunning={false}
          />,
        );
      });

      expect(container.textContent).not.toContain(
        "Large updates can take a minute or two.",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the long-running hint for structured tool rows", () => {
    vi.useFakeTimers();
    try {
      act(() => {
        root.render(
          <ToolCallDisplay
            toolName="edit-file"
            args={{}}
            structuredMeta={{
              toolKind: "edit",
              filePath: "app.tsx",
              oldText: "before",
              newText: "after",
            }}
            isRunning={true}
          />,
        );
      });

      expect(container.textContent).toContain("app.tsx");
      expect(container.textContent).not.toContain(
        "Large updates can take a minute or two.",
      );

      act(() => {
        vi.advanceTimersByTime(TOOL_LONG_RUNNING_HINT_DELAY_MS);
      });

      expect(container.textContent).toContain(
        "Still working. Large updates can take a minute or two.",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the long-running hint for renderer-backed tool rows", () => {
    vi.useFakeTimers();
    registerToolRenderer({
      id: "app.long-renderer",
      match: "custom-long-renderer",
      Component: AppRenderer,
    });

    try {
      act(() => {
        root.render(
          <ToolCallDisplay
            toolName="custom-long-renderer"
            args={{}}
            isRunning={true}
          />,
        );
      });

      expect(container.textContent).toContain("App renderer wins");
      expect(container.textContent).not.toContain(
        "Large updates can take a minute or two.",
      );

      act(() => {
        vi.advanceTimersByTime(TOOL_LONG_RUNNING_HINT_DELAY_MS);
      });

      expect(container.textContent).toContain(
        "Still working. Large updates can take a minute or two.",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets generic tool rows fill the assistant message column", () => {
    act(() => {
      root.render(
        <ToolCallDisplay
          toolName="hubspot-deals"
          args={{ query: "recent deals" }}
          isRunning={true}
        />,
      );
    });

    const row = container.querySelector("button")?.parentElement;
    expect(row?.className).toContain("w-full");
    expect(container.querySelector("button")?.className).toContain("w-full");
  });

  it("expands inputs inline and opens output in a popover", () => {
    act(() => {
      root.render(
        <ToolCallDisplay
          toolName="slack_read_thread"
          args={{ channel_id: "C123", message_ts: "1.2" }}
          result={JSON.stringify({ messages: "ok" })}
          isRunning={false}
        />,
      );
    });

    expect(container.textContent).toContain("slack read thread");
    expect(container.textContent).not.toContain("C123");

    const expandButton = container.querySelector(
      'button[aria-expanded="false"]',
    ) as HTMLButtonElement | null;
    expect(expandButton).not.toBeNull();
    act(() => {
      expandButton?.click();
    });

    expect(container.textContent).toContain("C123");
    const outputButton = container.querySelector(
      'button[aria-label="View slack_read_thread output"]',
    ) as HTMLButtonElement | null;
    expect(outputButton).not.toBeNull();

    act(() => {
      outputButton?.click();
    });

    expect(document.body.textContent).toContain(
      "Raw slack_read_thread tool call output",
    );
    expect(document.body.textContent).toContain("messages");
  });

  it("syntax highlights run-code source as JavaScript", () => {
    const payload = toolInputPayload("run-code", {
      code: "const answer = 42;\nconsole.log(answer);",
    });

    expect(payload?.lang).toBe("javascript");
  });

  it("shows a compact repeat count for coalesced tool rows", () => {
    act(() => {
      root.render(
        <ToolCallDisplay
          toolName="update-dashboard"
          args={{ dashboardId: "dash-1" }}
          result="saved"
          isRunning={false}
          repeatCount={3}
        />,
      );
    });

    expect(container.textContent).toContain("update dashboard");
    expect(container.textContent).toContain("3x");
  });

  it("shows reconnect activity cards as running without global chat state", () => {
    const content: ContentPart[] = [
      {
        type: "tool-call",
        toolCallId: "activity-1",
        toolName: "generate-design",
        argsText: "",
        args: {},
        activity: true,
      },
    ];

    act(() => {
      root.render(
        <ChatRunningContext.Provider value={false}>
          <ReconnectStreamMessage content={content} />
        </ChatRunningContext.Provider>,
      );
    });

    expect(container.textContent).toContain("generate design");
    expect(container.querySelector(".animate-spin")).not.toBeNull();
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

  it("honors chart action renderers over combined insight payloads", () => {
    act(() => {
      root.render(
        <ToolCallDisplay
          toolName="response-insights"
          args={{}}
          result={dataInsightResult()}
          chatUI={{ renderer: "core.data-chart" }}
          isRunning={false}
        />,
      );
    });

    expect(container.textContent).toContain("Responses by day");
    expect(container.textContent).not.toContain("Recent rows");
    expect(container.textContent).not.toContain("Ada");
  });

  it("honors table action renderers over combined insight payloads", () => {
    act(() => {
      root.render(
        <ToolCallDisplay
          toolName="response-insights"
          args={{}}
          result={dataInsightResult()}
          chatUI={{ renderer: "core.data-table" }}
          isRunning={false}
        />,
      );
    });

    expect(container.textContent).toContain("Recent rows");
    expect(container.textContent).toContain("Ada");
    expect(container.textContent).not.toContain("Responses by day");
  });

  it("renders action-declared inline extensions natively", () => {
    act(() => {
      root.render(
        <ToolCallDisplay
          toolName="render-inline-extension"
          args={{}}
          result={JSON.stringify({
            ok: true,
            inlineExtension: {
              mode: "transient",
              id: "inline-1",
              name: "Sensitivity controls",
              description: "Adjust the threshold",
              content: "<div>Controls</div>",
            },
          })}
          chatUI={{ renderer: "core.inline-extension" }}
          isRunning={false}
        />,
      );
    });

    const frame = container.querySelector(
      '[data-testid="inline-extension-frame"]',
    );
    expect(frame).toBeTruthy();
    expect(frame?.getAttribute("data-extension-id")).toBe("inline-1");
    expect(frame?.getAttribute("data-extension-mode")).toBe("transient");
    expect(container.textContent).toContain("Sensitivity controls");
    expect(container.textContent).not.toContain("render inline extension");
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

  it("smooth-streams only the tail text part during reconnect replay", () => {
    const longText = (label: string) => `${label} ${"text ".repeat(140)}`;
    const content: ContentPart[] = [
      { type: "text", text: longText("before") },
      {
        type: "tool-call",
        toolCallId: "tc_1",
        toolName: "read-file",
        args: {},
        result: "done",
      },
      { type: "text", text: longText("middle") },
      {
        type: "tool-call",
        toolCallId: "tc_2",
        toolName: "write-file",
        args: {},
        result: "done",
      },
      { type: "text", text: longText("tail") },
    ];

    act(() => {
      root.render(
        <ChatRunningContext.Provider value={true}>
          <ReconnectStreamMessage content={content} />
        </ChatRunningContext.Provider>,
      );
    });

    const textParts = Array.from(container.querySelectorAll(".agent-markdown"));
    expect(
      textParts.map((part) => part.getAttribute("data-streaming")),
    ).toEqual([null, null, "true"]);
  });

  it("does not smooth-stream completed text when reconnect replay is on a tool", () => {
    const content: ContentPart[] = [
      { type: "text", text: `done ${"text ".repeat(140)}` },
      {
        type: "tool-call",
        toolCallId: "tc_1",
        toolName: "update-dashboard",
        args: {},
      },
    ];

    act(() => {
      root.render(
        <ChatRunningContext.Provider value={true}>
          <ReconnectStreamMessage content={content} />
        </ChatRunningContext.Provider>,
      );
    });

    const textParts = Array.from(container.querySelectorAll(".agent-markdown"));
    expect(
      textParts.map((part) => part.getAttribute("data-streaming")),
    ).toEqual([null]);
  });
});

describe("formatWorkedDuration", () => {
  it("formats seconds, minutes, and hours", () => {
    expect(formatWorkedDuration(1_000)).toBe("1s");
    expect(formatWorkedDuration(45_000)).toBe("45s");
    expect(formatWorkedDuration(60_000)).toBe("1m");
    expect(formatWorkedDuration(125_000)).toBe("2m 5s");
    expect(formatWorkedDuration(3_600_000)).toBe("1h");
    expect(formatWorkedDuration(3_900_000)).toBe("1h 5m");
  });
});

describe("ReasoningCell", () => {
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

  it("renders plain-English thinking prose expanded by default and can collapse", () => {
    act(() => {
      root.render(
        <ReasoningCell text="I should verify the join keys first." />,
      );
    });

    expect(container.textContent).toContain("Thought");
    expect(container.textContent).toContain("verify the join keys first.");

    const button = container.querySelector(
      'button[aria-expanded="true"]',
    ) as HTMLButtonElement | null;
    act(() => {
      button?.click();
    });

    expect(button?.getAttribute("aria-expanded")).toBe("false");
  });

  it("honors an explicitly collapsed default", () => {
    act(() => {
      root.render(
        <ReasoningCell
          text="I should verify the join keys first."
          defaultOpen={false}
        />,
      );
    });

    expect(container.textContent).toContain("Thought");
    expect(container.textContent).not.toContain("verify the join keys");

    const button = container.querySelector(
      'button[aria-expanded="false"]',
    ) as HTMLButtonElement | null;
    act(() => {
      button?.click();
    });

    expect(button?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("verify the join keys first.");
  });

  it("renders reasoning directly inside the shared work disclosure", () => {
    act(() => {
      root.render(
        <WorkedForSummary>
          <ReasoningCell text="I should verify the join keys first." />
        </WorkedForSummary>,
      );
    });

    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(container.textContent).not.toContain("verify the join keys first.");

    act(() => {
      container.querySelector("button")?.click();
    });

    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(container.textContent).toContain("verify the join keys first.");
    expect(container.textContent).not.toContain("Thought");
  });

  it('shows a shimmering "Thinking" label while streaming', () => {
    act(() => {
      root.render(<ReasoningCell text="Weighing options…" isStreaming />);
    });

    expect(container.textContent).toContain("Thinking");
    const shimmer = container.querySelector(".agent-thinking-indicator__text");
    expect(shimmer?.textContent).toBe("Thinking");
  });

  it('falls back to a plain "Thought" label with no live timing', () => {
    act(() => {
      root.render(<ReasoningCell text="Some finished reasoning." />);
    });

    expect(container.textContent).toContain("Thought");
    expect(container.querySelector(".agent-thinking-indicator__text")).toBe(
      null,
    );
  });

  it('shows "Thought for Xs" once a duration is known', () => {
    act(() => {
      root.render(
        <ReasoningCell text="Some finished reasoning." durationMs={4200} />,
      );
    });

    expect(container.textContent).toContain("Thought for 4s");
  });

  it("ignores sub-second durations and shows plain Thought", () => {
    act(() => {
      root.render(
        <ReasoningCell text="Some finished reasoning." durationMs={400} />,
      );
    });

    const button = container.querySelector("button");
    expect(button?.textContent).toBe("Thought");
  });

  it("clamps to a tail view while streaming and open, and unclamps once done", () => {
    act(() => {
      root.render(
        <ReasoningCell
          text="Line one\nLine two\nLine three"
          isStreaming
          defaultOpen
        />,
      );
    });

    expect(container.querySelector(".reasoning-cell-tail")).not.toBe(null);

    act(() => {
      root.render(
        <ReasoningCell
          text="Line one\nLine two\nLine three"
          isStreaming={false}
          defaultOpen
        />,
      );
    });

    expect(container.querySelector(".reasoning-cell-tail")).toBe(null);
  });
});
