import { describe, expect, it } from "vitest";

import { parseCommentAiConversation } from "./comment-ai-client";

describe("parseCommentAiConversation", () => {
  it("omits the canonical first response and pairs continuation turns", () => {
    const threadData = JSON.stringify({
      messages: [
        {
          message: {
            role: "user",
            content: [{ type: "text", text: "Initial request" }],
            metadata: { custom: { agentNativeQueuedMessageId: "initial" } },
          },
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "Canonical reply" }],
          metadata: { custom: { turnId: "initial" } },
        },
        {
          role: "user",
          content: [{ type: "text", text: "Can you explain why?" }],
          metadata: { custom: { agentNativeQueuedMessageId: "follow-up" } },
        },
        {
          message: {
            role: "assistant",
            content: [
              { type: "reasoning", text: "private" },
              { type: "text", text: "Because the source changed." },
            ],
            metadata: { custom: { turnId: "follow-up" } },
            status: { type: "complete" },
          },
        },
      ],
    });

    expect(parseCommentAiConversation(threadData, "initial")).toEqual([
      {
        turnId: "follow-up",
        userText: "Can you explain why?",
        assistantText: "Because the source changed.",
        status: "complete",
      },
    ]);
  });

  it("preserves an incomplete continuation as recoverable state", () => {
    const threadData = JSON.stringify({
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "Partial answer" }],
          metadata: { custom: { turnId: "follow-up" } },
          status: { type: "incomplete" },
        },
      ],
    });

    expect(parseCommentAiConversation(threadData, "initial")).toEqual([
      {
        turnId: "follow-up",
        userText: null,
        assistantText: "Partial answer",
        status: "incomplete",
      },
    ]);
  });

  it("fails loudly when persisted thread data is unreadable", () => {
    expect(() => parseCommentAiConversation("not-json", "initial")).toThrow(
      "could not be read",
    );
  });
});
