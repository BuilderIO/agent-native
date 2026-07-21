// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assistantMessageHasUnresolvedTool,
  getAssistantToolSummaryInfo,
  isCollapsibleAssistantWorkPart,
  messageTextFromContent,
  shouldShowAssistantWorkSummary,
  shouldShowAssistantMessageFooter,
  ThinkingIndicator,
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
