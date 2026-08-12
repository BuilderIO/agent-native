// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assistantMessageHasCompletedCustomUi,
  assistantMessageHasCustomUi,
  assistantMessageHasUnresolvedTool,
  computeActiveTailToolCallId,
  getAssistantWorkSummaryDurationMs,
  getAssistantToolSummaryInfo,
  groupAssistantWorkParts,
  InlineRunErrorNotice,
  isAlwaysVisibleAssistantTool,
  isCollapsibleAssistantWorkPart,
  isMissingFinalResponseWarningText,
  latestUserMessageText,
  messageTextFromContent,
  shouldShowAssistantWorkSummary,
  shouldShowAssistantMessageFooter,
  shouldShowInlineRunError,
  shouldShowMissingFinalResponse,
  useSettledFlag,
  ThinkingIndicator,
  userMessageTextBeforeAssistant,
  isHiddenUserMessage,
  assistantMessageRunId,
  assistantMessageTurnId,
  assistantMessageWasUserStopped,
  resolveAssistantRequestId,
} from "./message-components.js";
import { runErrorKey } from "./run-recovery.js";

describe("assistant request ID resolution", () => {
  it("prefers the server run ID attached to the message", () => {
    expect(
      resolveAssistantRequestId(
        { id: "local-message-id", metadata: { custom: { runId: "run-1" } } },
        { threadId: "thread-1", runId: "run-2" },
        "thread-1",
      ),
    ).toBe("run-1");
  });

  it("uses the current thread's active server run ID for an in-flight message", () => {
    expect(
      resolveAssistantRequestId(
        { id: "local-message-id" },
        { threadId: "thread-1", runId: "run-1" },
        "thread-1",
      ),
    ).toBe("run-1");
  });

  it("never falls back to a local message ID or another thread's run", () => {
    expect(
      resolveAssistantRequestId(
        { id: "local-message-id" },
        { threadId: "thread-2", runId: "run-2" },
        "thread-1",
      ),
    ).toBeUndefined();
    expect(assistantMessageRunId({ id: "local-message-id" })).toBeUndefined();
  });

  it("reads the stable logical turn ID from assistant metadata", () => {
    expect(
      assistantMessageTurnId({
        metadata: { custom: { turnId: "turn-1" } },
      }),
    ).toBe("turn-1");
  });

  it("recognizes a persisted user stop marker", () => {
    expect(
      assistantMessageWasUserStopped({
        metadata: { custom: { userStopped: true } },
      }),
    ).toBe(true);
    expect(assistantMessageWasUserStopped({})).toBe(false);
  });
});

describe("ThinkingIndicator", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders plain accessible status text", () => {
    act(() => {
      root.render(<ThinkingIndicator />);
    });

    const status = container.querySelector('[role="status"]');
    expect(status?.getAttribute("aria-label")).toBe("Thinking");
    expect(status?.textContent).toBe("Thinking");
    expect(container.querySelector("svg")).toBeNull();
    expect(
      container.querySelectorAll(".agent-thinking-indicator__ellipsis-dot"),
    ).toHaveLength(0);
    expect(
      container.querySelector(".agent-thinking-indicator__logo"),
    ).toBeNull();
  });
});

describe("shouldShowAssistantMessageFooter", () => {
  it("hides controls for the current assistant response while it is running", () => {
    expect(
      shouldShowAssistantMessageFooter({
        isLast: true,
        chatRunning: true,
        hasRenderableContent: true,
        statusIsTerminal: false,
      }),
    ).toBe(false);
  });

  it("hides controls for empty assistant placeholders", () => {
    expect(
      shouldShowAssistantMessageFooter({
        isLast: true,
        chatRunning: false,
        hasRenderableContent: false,
        statusIsTerminal: true,
      }),
    ).toBe(false);
  });

  it("shows controls for the final assistant response only after terminal status", () => {
    expect(
      shouldShowAssistantMessageFooter({
        isLast: true,
        chatRunning: false,
        hasRenderableContent: true,
        statusIsTerminal: true,
      }),
    ).toBe(true);
  });

  it("hides controls for the current assistant response while a tool is unresolved", () => {
    expect(
      shouldShowAssistantMessageFooter({
        isLast: true,
        chatRunning: false,
        hasRenderableContent: true,
        statusIsTerminal: true,
        hasUnresolvedTool: true,
      }),
    ).toBe(false);
  });

  it("keeps unrelated historical assistant controls while chat work runs", () => {
    expect(
      shouldShowAssistantMessageFooter({
        isLast: false,
        chatRunning: true,
        hasRenderableContent: true,
        statusIsTerminal: true,
      }),
    ).toBe(true);
  });

  it("hides historical controls when they belong to the active run", () => {
    expect(
      shouldShowAssistantMessageFooter({
        isLast: false,
        chatRunning: true,
        activeRunId: "run-active",
        messageRunId: "run-active",
        hasRenderableContent: true,
        statusIsTerminal: true,
      }),
    ).toBe(false);
  });

  it("hides historical controls across continuation run IDs in the same turn", () => {
    expect(
      shouldShowAssistantMessageFooter({
        isLast: false,
        chatRunning: true,
        activeRunId: "run-successor",
        messageRunId: "run-original",
        activeTurnId: "turn-shared",
        messageTurnId: "turn-shared",
        hasRenderableContent: true,
        statusIsTerminal: true,
      }),
    ).toBe(false);
  });

  it("does not treat missing turn metadata as a different turn", () => {
    expect(
      shouldShowAssistantMessageFooter({
        isLast: false,
        chatRunning: true,
        activeRunId: "run-same",
        messageRunId: "run-same",
        activeTurnId: "turn-current",
        hasRenderableContent: true,
        statusIsTerminal: true,
      }),
    ).toBe(false);
  });
});

describe("shouldShowMissingFinalResponse", () => {
  it("backs up terminal tool-only messages with visible text", () => {
    expect(
      shouldShowMissingFinalResponse({
        isCurrentTurnRunning: false,
        statusIsTerminal: true,
        hasAssistantText: false,
        hasUnresolvedTool: false,
      }),
    ).toBe(true);
  });

  it("stays hidden while a tool is unresolved or final text exists", () => {
    expect(
      shouldShowMissingFinalResponse({
        isCurrentTurnRunning: false,
        statusIsTerminal: true,
        hasAssistantText: false,
        hasUnresolvedTool: true,
      }),
    ).toBe(false);
    expect(
      shouldShowMissingFinalResponse({
        isCurrentTurnRunning: false,
        statusIsTerminal: true,
        hasAssistantText: true,
        hasUnresolvedTool: false,
      }),
    ).toBe(false);
    expect(
      shouldShowMissingFinalResponse({
        isCurrentTurnRunning: false,
        statusIsTerminal: true,
        hasAssistantText: false,
        hasUnresolvedTool: false,
        hasCompletedCustomUi: true,
      }),
    ).toBe(false);
  });

  it("stays hidden while the server still reports the run as running", () => {
    // Local chatRunning dips at every chunk boundary; server truth wins.
    expect(
      shouldShowMissingFinalResponse({
        isCurrentTurnRunning: false,
        serverRunActive: true,
        statusIsTerminal: true,
        hasAssistantText: false,
        hasUnresolvedTool: false,
      }),
    ).toBe(false);
  });

  it("stays hidden after the user explicitly stops the run", () => {
    expect(
      shouldShowMissingFinalResponse({
        isCurrentTurnRunning: false,
        statusIsTerminal: true,
        hasAssistantText: false,
        hasUnresolvedTool: false,
        userStoppedRun: true,
      }),
    ).toBe(false);
  });

  it("does not flash after a tool completes while the current turn is still running", () => {
    expect(
      shouldShowMissingFinalResponse({
        isCurrentTurnRunning: true,
        statusIsTerminal: true,
        hasAssistantText: false,
        hasUnresolvedTool: false,
      }),
    ).toBe(false);
  });
});

describe("useSettledFlag", () => {
  let container: HTMLDivElement;
  let root: Root;

  function Probe({ active, delayMs }: { active: boolean; delayMs: number }) {
    return <span>{useSettledFlag(active, delayMs) ? "shown" : "hidden"}</span>;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  it("holds the flag back until the condition has lasted the delay", () => {
    act(() => {
      root.render(<Probe active delayMs={3000} />);
    });
    expect(container.textContent).toBe("hidden");

    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(container.textContent).toBe("hidden");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(container.textContent).toBe("shown");
  });

  it("never shows when the condition clears inside the delay, and re-arms after", () => {
    act(() => {
      root.render(<Probe active delayMs={3000} />);
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => {
      root.render(<Probe active={false} delayMs={3000} />);
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(container.textContent).toBe("hidden");

    act(() => {
      root.render(<Probe active delayMs={3000} />);
    });
    expect(container.textContent).toBe("hidden");
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(container.textContent).toBe("shown");
  });

  it("shows immediately with no delay, so settled history does not pop in", () => {
    act(() => {
      root.render(<Probe active delayMs={0} />);
    });
    expect(container.textContent).toBe("shown");
  });
});

describe("assistantMessageHasCompletedCustomUi", () => {
  it("recognizes a completed action-declared renderer as a response", () => {
    expect(
      assistantMessageHasCompletedCustomUi([
        {
          type: "tool-call",
          result: '{"ok":true}',
          chatUI: { renderer: "todo-demo.todo-list-inline" },
        },
      ]),
    ).toBe(true);
    expect(
      assistantMessageHasCompletedCustomUi([
        {
          type: "tool-call",
          result: '{"ok":true}',
          chatUI: { renderer: "todo-demo.todo-list-inline" },
        },
        {
          type: "tool-call",
          result: "done",
          toolName: "list-todos",
        },
      ]),
    ).toBe(false);
  });

  it("recognizes a completed Builder handoff as interactive UI", () => {
    expect(
      assistantMessageHasCompletedCustomUi([
        {
          type: "tool-call",
          toolName: "connect-builder",
          result: JSON.stringify({ kind: "connect-builder-card" }),
        },
      ]),
    ).toBe(true);
  });
});

describe("assistantMessageHasCustomUi", () => {
  it("keeps turns with action-declared or MCP UI expanded", () => {
    expect(
      assistantMessageHasCustomUi([
        { type: "reasoning", text: "Loading todos" },
        {
          type: "tool-call",
          result: '{"ok":true}',
          chatUI: { renderer: "todo-demo.todo-list-inline" },
        },
        { type: "text", text: "Here are your todos." },
      ]),
    ).toBe(true);
    expect(
      assistantMessageHasCustomUi([
        { type: "tool-call", result: "done", mcpApp: { uri: "ui://todo" } },
      ]),
    ).toBe(true);
    expect(
      assistantMessageHasCustomUi([
        { type: "reasoning", text: "Checking" },
        { type: "tool-call", toolName: "list-todos", result: "done" },
      ]),
    ).toBe(false);
  });

  it("keeps pending needsApproval affordances expanded", () => {
    expect(
      assistantMessageHasCustomUi([
        {
          type: "tool-call",
          toolName: "create-builder-branch",
          result: "Awaiting human approval. This action did NOT execute.",
          approval: { approvalKey: "create-builder-branch:{}" },
        },
        {
          type: "text",
          text: "Waiting for your approval to run create-builder-branch.",
        },
      ]),
    ).toBe(true);
    expect(
      assistantMessageHasCustomUi([
        {
          type: "tool-call",
          toolName: "create-builder-branch",
          result: "Awaiting human approval. This action did NOT execute.",
          approval: {
            approvalKey: "create-builder-branch:{}",
            dismissed: true,
          },
        },
      ]),
    ).toBe(false);
  });

  it("keeps the Builder handoff treated as interactive UI", () => {
    expect(
      assistantMessageHasCustomUi([
        {
          type: "tool-call",
          toolName: "connect-builder",
          result: JSON.stringify({ kind: "connect-builder-card" }),
        },
      ]),
    ).toBe(true);
  });
});

describe("messageTextFromContent", () => {
  it("uses visible text only so tool payloads cannot trigger provider suggestions", () => {
    expect(
      messageTextFromContent([
        {
          type: "tool-call",
          result: "GitHub read repositories and code context",
        },
        {
          type: "reasoning",
          text: "Connect GitHub before reading the repository",
        },
        {
          type: "text",
          text: "Stopped because manage-progress failed 3 times.",
        },
      ]),
    ).toBe("Stopped because manage-progress failed 3 times.");
  });
});

describe("assistant completion notices", () => {
  it("recognizes terminal missing-response warnings separately from final text", () => {
    expect(
      isMissingFinalResponseWarningText(
        "The agent completed the view screen action, but stopped before sending a final message.",
      ),
    ).toBe(true);
    expect(isMissingFinalResponseWarningText("The work is complete.")).toBe(
      false,
    );
  });
});

describe("latestUserMessageText", () => {
  it("uses only visible user-authored text for connection suggestions", () => {
    expect(
      latestUserMessageText([
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Open Notion<context>Connect Granola</context>",
            },
          ],
        },
        {
          role: "user",
          content: [{ type: "text", text: "Connect Granola" }],
          metadata: { custom: { agentNativeHiddenUserMessage: true } },
        },
      ]),
    ).toBe("Open Notion");
  });
});

describe("userMessageTextBeforeAssistant", () => {
  it("keeps a response connection suggestion tied to its own user turn", () => {
    expect(
      userMessageTextBeforeAssistant(
        [
          { id: "user-1", role: "user", content: "Connect Granola" },
          {
            id: "assistant-1",
            role: "assistant",
            content: "I cannot read it.",
          },
          {
            id: "user-2",
            role: "user",
            content: "Make the slide title larger",
          },
          { id: "assistant-2", role: "assistant", content: "Done." },
        ],
        "assistant-1",
      ),
    ).toBe("Connect Granola");
    expect(
      userMessageTextBeforeAssistant(
        [
          { id: "user-1", role: "user", content: "Connect Granola" },
          {
            id: "assistant-1",
            role: "assistant",
            content: "I cannot read it.",
          },
        ],
        "assistant-2",
      ),
    ).toBe("");
  });
});

describe("shouldShowAssistantWorkSummary", () => {
  it("keeps completed historical work grouped while a later turn runs", () => {
    expect(
      shouldShowAssistantWorkSummary({
        isLast: false,
        isComplete: false,
        hasCollapsibleWork: true,
        hasUnresolvedTool: false,
        chatRunning: true,
      }),
    ).toBe(true);
  });

  it("does not group the currently running assistant response", () => {
    expect(
      shouldShowAssistantWorkSummary({
        isLast: true,
        isComplete: false,
        hasCollapsibleWork: true,
        hasUnresolvedTool: false,
        chatRunning: true,
      }),
    ).toBe(false);
  });

  it("does not group the running turn whose tool is still in flight", () => {
    expect(
      shouldShowAssistantWorkSummary({
        isLast: true,
        isComplete: false,
        hasCollapsibleWork: true,
        hasUnresolvedTool: true,
        chatRunning: true,
      }),
    ).toBe(false);
  });

  it("still shows the duration summary for a stalled turn that is not running", () => {
    expect(
      shouldShowAssistantWorkSummary({
        isLast: true,
        isComplete: false,
        hasCollapsibleWork: true,
        hasUnresolvedTool: true,
        chatRunning: false,
      }),
    ).toBe(true);
  });

  it("groups historical work with a dangling tool", () => {
    expect(
      shouldShowAssistantWorkSummary({
        isLast: false,
        isComplete: false,
        hasCollapsibleWork: true,
        hasUnresolvedTool: true,
        chatRunning: true,
      }),
    ).toBe(true);
  });
});

describe("getAssistantWorkSummaryDurationMs", () => {
  it("shows a turn duration only on the first folded work segment", () => {
    expect(getAssistantWorkSummaryDurationMs(11_000, 2, 2)).toBe(11_000);
    expect(getAssistantWorkSummaryDurationMs(11_000, 5, 2)).toBeNull();
  });

  it("does not invent a duration when the turn has none", () => {
    expect(getAssistantWorkSummaryDurationMs(null, 2, 2)).toBeNull();
    expect(getAssistantWorkSummaryDurationMs(undefined, 2, 2)).toBeUndefined();
  });
});

describe("shouldShowInlineRunError", () => {
  const runError = {
    message: "Provider timed out.",
    errorCode: "connection_error",
    runId: "run-9",
  };

  it("marks a failed turn regardless of where it sits in the thread", () => {
    // No isLast input: an error persisted on an earlier turn stays visible once
    // the user sends the next message.
    expect(
      shouldShowInlineRunError({ runError, bannerRunErrorKey: null }),
    ).toBe(true);
    expect(
      shouldShowInlineRunError({ runError, bannerRunErrorKey: undefined }),
    ).toBe(true);
  });

  it("stays quiet when the banner already shows this same run", () => {
    expect(
      shouldShowInlineRunError({
        runError,
        bannerRunErrorKey: runErrorKey(runError),
      }),
    ).toBe(false);
  });

  it("still marks a turn while the banner shows a different run", () => {
    expect(
      shouldShowInlineRunError({
        runError,
        bannerRunErrorKey: runErrorKey({ ...runError, runId: "run-10" }),
      }),
    ).toBe(true);
  });

  it("shows nothing when the turn carries no run error", () => {
    expect(
      shouldShowInlineRunError({ runError: null, bannerRunErrorKey: null }),
    ).toBe(false);
  });
});

describe("InlineRunErrorNotice", () => {
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

  it("collapses to one line with the run duration and expands on click", () => {
    act(() => {
      root.render(
        <InlineRunErrorNotice
          info={{
            message: "Provider timed out.",
            errorCode: "connection_error",
            runId: "run-9",
            recoverable: true,
          }}
          durationMs={125_000}
        />,
      );
    });

    const toggle = container.querySelector("button");
    expect(toggle?.textContent).toBe(
      "The agent stopped before finishing after 2m 5s",
    );
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("Provider timed out.");

    act(() => {
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Provider timed out.");
    expect(container.textContent).toContain("connection_error");
  });

  it("uses the error headline when the run is not recoverable", () => {
    act(() => {
      root.render(
        <InlineRunErrorNotice info={{ message: "Boom." }} durationMs={null} />,
      );
    });

    expect(container.querySelector("button")?.textContent).toBe(
      "The agent hit an error",
    );
  });
});

describe("isCollapsibleAssistantWorkPart", () => {
  it("keeps the Builder handoff card outside collapsed work", () => {
    const builderHandoff = {
      type: "tool-call",
      toolName: "connect-builder",
    };
    expect(isAlwaysVisibleAssistantTool(builderHandoff)).toBe(true);
    expect(isCollapsibleAssistantWorkPart(builderHandoff)).toBe(false);
  });

  it("still groups ordinary work and reasoning", () => {
    expect(
      isCollapsibleAssistantWorkPart({
        type: "tool-call",
        toolName: "read-file",
      }),
    ).toBe(true);
    expect(isCollapsibleAssistantWorkPart({ type: "reasoning" })).toBe(true);
  });

  it("keeps custom UI outside collapsed work", () => {
    expect(
      isCollapsibleAssistantWorkPart({
        type: "tool-call",
        toolName: "render-todo-list-inline",
        chatUI: { renderer: "todo-demo.todo-list-inline" },
      }),
    ).toBe(false);
  });

  it("keeps pending needsApproval tools outside collapsed work", () => {
    expect(
      isCollapsibleAssistantWorkPart({
        type: "tool-call",
        toolName: "create-builder-branch",
        approval: { approvalKey: "create-builder-branch:{}" },
      }),
    ).toBe(false);
    expect(
      isCollapsibleAssistantWorkPart({
        type: "tool-call",
        toolName: "create-builder-branch",
        approval: {
          approvalKey: "create-builder-branch:{}",
          dismissed: true,
        },
      }),
    ).toBe(true);
  });
});

describe("getAssistantToolSummaryInfo", () => {
  it("keeps the newest three tool calls visible", () => {
    expect(
      getAssistantToolSummaryInfo([
        { type: "reasoning" },
        { type: "tool-call", toolName: "read-file" },
        { type: "tool-call", toolName: "read-file" },
        { type: "tool-call", toolName: "read-file" },
        { type: "tool-call", toolName: "read-file" },
        { type: "tool-call", toolName: "read-file" },
      ]),
    ).toEqual({ startIndex: 3, hiddenToolCount: 2 });
  });

  it("does not summarize three or fewer tool calls", () => {
    expect(
      getAssistantToolSummaryInfo([
        { type: "tool-call", toolName: "read-file" },
        { type: "tool-call", toolName: "read-file" },
        { type: "tool-call", toolName: "read-file" },
      ]),
    ).toEqual({ startIndex: -1, hiddenToolCount: 0 });
  });

  it("does not count a call-agent row shadowed by agent progress", () => {
    expect(
      getAssistantToolSummaryInfo([
        {
          type: "tool-call",
          toolCallId: "call-analytics",
          toolName: "call-agent",
          args: { agent: "analytics" },
        },
        {
          type: "tool-call",
          toolCallId: "agent-analytics",
          toolName: "agent:Analytics",
          args: {},
        },
        { type: "tool-call", toolName: "query", args: {} },
        { type: "tool-call", toolName: "summarize", args: {} },
      ]),
    ).toEqual({ startIndex: -1, hiddenToolCount: 0 });
  });
});

describe("groupAssistantWorkParts", () => {
  it("keeps a shadowed call-agent row inside the surrounding work group", () => {
    const parts = [
      { type: "tool-call", toolName: "read-file" },
      {
        type: "tool-call",
        toolCallId: "call-analytics",
        toolName: "call-agent",
        args: { agent: "analytics" },
      },
      {
        type: "tool-call",
        toolCallId: "agent-analytics",
        toolName: "agent:Analytics",
        args: {},
      },
      { type: "tool-call", toolName: "query" },
    ] as const;

    expect(
      parts.map((part, index) => groupAssistantWorkParts(part, index, parts)),
    ).toEqual([["group-work"], ["group-work"], ["group-work"], ["group-work"]]);
  });

  it("does not open a work group for a leading shadowed call-agent row", () => {
    const parts = [
      {
        type: "tool-call",
        toolCallId: "call-analytics",
        toolName: "call-agent",
        args: { agent: "analytics" },
      },
      {
        type: "tool-call",
        toolCallId: "agent-analytics",
        toolName: "agent:Analytics",
        args: {},
      },
    ] as const;

    expect(groupAssistantWorkParts(parts[0], 0, parts)).toBeNull();
    expect(groupAssistantWorkParts(parts[1], 1, parts)).toEqual(["group-work"]);
  });
});

describe("isHiddenUserMessage", () => {
  it("detects internal user messages hidden from chat history", () => {
    expect(
      isHiddenUserMessage({
        role: "user",
        content: [{ type: "text", text: "Continue from where you stopped." }],
        metadata: { custom: { agentNativeHiddenUserMessage: true } },
      }),
    ).toBe(true);
  });

  it("hides older recovery-action user messages", () => {
    expect(
      isHiddenUserMessage({
        role: "user",
        content: [{ type: "text", text: "Continue from where you stopped." }],
        metadata: { custom: { agentNativeRecoveryAction: "continue" } },
      }),
    ).toBe(true);
  });

  it("does not hide ordinary user messages", () => {
    expect(
      isHiddenUserMessage({
        role: "user",
        content: [{ type: "text", text: "What changed?" }],
      }),
    ).toBe(false);
  });
});

describe("computeActiveTailToolCallId", () => {
  it("never shimmers an older message's dangling unresolved tool", () => {
    expect(
      computeActiveTailToolCallId(
        [
          {
            type: "tool-call",
            toolCallId: "tc_1",
            toolName: "read-file",
            argsText: "",
            args: {},
          },
        ],
        { chatRunning: true, isLast: false },
      ),
    ).toBeNull();
  });

  it("picks the last unresolved tool among parallel calls", () => {
    expect(
      computeActiveTailToolCallId(
        [
          {
            type: "tool-call",
            toolCallId: "tc_1",
            toolName: "read-file",
            argsText: "",
            args: {},
          },
          {
            type: "tool-call",
            toolCallId: "tc_2",
            toolName: "list-files",
            argsText: "",
            args: {},
          },
        ],
        { chatRunning: true, isLast: true },
      ),
    ).toBe("tc_2");
  });

  it("keeps the newest resolved tool active while the chat still runs", () => {
    expect(
      computeActiveTailToolCallId(
        [
          {
            type: "tool-call",
            toolCallId: "tc_1",
            toolName: "read-file",
            argsText: "",
            args: {},
          },
          {
            type: "tool-call",
            toolCallId: "tc_2",
            toolName: "list-files",
            argsText: "",
            args: {},
            result: "done",
          },
        ],
        { chatRunning: true, isLast: true },
      ),
    ).toBe("tc_2");
  });

  it("returns null when the chat is idle and no part reports activity", () => {
    expect(
      computeActiveTailToolCallId(
        [
          {
            type: "tool-call",
            toolCallId: "tc_1",
            toolName: "read-file",
            argsText: "",
            args: {},
          },
        ],
        { chatRunning: false, isLast: true },
      ),
    ).toBeNull();
  });
});

describe("assistantMessageHasUnresolvedTool", () => {
  it("detects unresolved running and activity tool parts", () => {
    expect(
      assistantMessageHasUnresolvedTool([
        {
          type: "tool-call",
          toolName: "edit-design",
          toolCallId: "tc_1",
          argsText: "",
          args: {},
          activity: true,
        },
      ]),
    ).toBe(true);
  });

  it("ignores completed tool parts", () => {
    expect(
      assistantMessageHasUnresolvedTool([
        {
          type: "tool-call",
          toolName: "edit-design",
          toolCallId: "tc_1",
          argsText: "{}",
          args: {},
          result: "{}",
        },
      ]),
    ).toBe(false);
  });
});
