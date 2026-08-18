import { describe, expect, it } from "vitest";

import {
  formatWorkedDuration,
  hasActiveTool,
  isCollapsibleWorkPart,
  shouldShowActivityRow,
  shouldShowWorkSummary,
} from "./presentation";
import type { ChatContentPart } from "./types";

const reasoning: ChatContentPart = { type: "reasoning", text: "Check" };
const completedTool: ChatContentPart = {
  type: "tool-call",
  toolCallId: "tool-1",
  toolName: "search",
  inputText: "{}",
  status: "completed",
};

describe("mobile chat presentation parity", () => {
  it("treats reasoning and ordinary completed tools as collapsible work", () => {
    expect(isCollapsibleWorkPart(reasoning)).toBe(true);
    expect(isCollapsibleWorkPart(completedTool)).toBe(true);
    expect(
      isCollapsibleWorkPart({ ...completedTool, status: "awaiting-approval" }),
    ).toBe(false);
  });

  it("keeps active tools expanded instead of hiding live work in a summary", () => {
    const running = { ...completedTool, status: "running" as const };
    expect(hasActiveTool([running])).toBe(true);
    expect(
      shouldShowWorkSummary({
        isLast: true,
        isComplete: false,
        parts: [running],
        isStreaming: true,
      }),
    ).toBe(false);
  });

  it("does not duplicate a visible reasoning or running-tool tail with activity", () => {
    const message = {
      id: "assistant-1",
      role: "assistant" as const,
      parts: [reasoning],
      createdAt: 0,
    };
    expect(shouldShowActivityRow("Thinking", [message])).toBe(false);
    expect(
      shouldShowActivityRow("Running search", [
        {
          ...message,
          parts: [{ ...completedTool, status: "running" as const }],
        },
      ]),
    ).toBe(false);
    expect(shouldShowActivityRow("Searching", [])).toBe(true);
  });

  it("collapses completed work with the same worked-for vocabulary as web", () => {
    expect(
      shouldShowWorkSummary({
        isLast: true,
        isComplete: true,
        parts: [reasoning, completedTool],
        isStreaming: false,
      }),
    ).toBe(true);
    expect(formatWorkedDuration(4200)).toBe("4s");
    expect(formatWorkedDuration(65_000)).toBe("1m 5s");
  });
});
