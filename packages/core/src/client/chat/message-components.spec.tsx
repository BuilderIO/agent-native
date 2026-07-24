// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assistantMessageHasCompletedCustomUi,
  assistantMessageHasCustomUi,
  assistantMessageHasUnresolvedTool,
  computeActiveTailToolCallId,
  getAssistantToolSummaryInfo,
  isCollapsibleAssistantWorkPart,
  latestUserMessageText,
  messageTextFromContent,
  shouldShowAssistantWorkSummary,
  shouldShowAssistantMessageFooter,
  shouldShowMissingFinalResponse,
  ThinkingIndicator,
  userMessageTextBeforeAssistant,
  isHiddenUserMessage,
} from "./message-components.js";

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

  it("keeps completed historical assistant controls visible while chat work runs", () => {
    expect(
      shouldShowAssistantMessageFooter({
        isLast: false,
        chatRunning: true,
        hasRenderableContent: true,
        statusIsTerminal: true,
      }),
    ).toBe(true);
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
      }),
    ).toBe(false);
  });

  it("does not group work that still has an unresolved tool", () => {
    expect(
      shouldShowAssistantWorkSummary({
        isLast: false,
        isComplete: false,
        hasCollapsibleWork: true,
        hasUnresolvedTool: true,
      }),
    ).toBe(false);
  });
});

describe("isCollapsibleAssistantWorkPart", () => {
  it("keeps the Builder handoff card outside collapsed work", () => {
    expect(
      isCollapsibleAssistantWorkPart({
        type: "tool-call",
        toolName: "connect-builder",
      }),
    ).toBe(false);
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
