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

  it("pairs persisted submission turn IDs and excludes older receipted turns from the current conversation", () => {
    const threadData = JSON.stringify({
      messages: [
        {
          role: "user",
          content: "Earlier question",
          metadata: {
            custom: {
              submittedTurnId: "turn-a",
              agentNativeQueuedMessageId: "operation-a",
            },
          },
        },
        {
          role: "assistant",
          content: "Earlier receipt",
          metadata: { custom: { turnId: "turn-a" } },
        },
        {
          role: "user",
          content: "Current question",
          metadata: {
            custom: {
              submittedTurnId: "turn-b",
              agentNativeQueuedMessageId: "operation-b",
            },
          },
        },
        {
          role: "assistant",
          content: "Current receipt",
          metadata: { custom: { turnId: "turn-b" } },
        },
        {
          role: "user",
          content: "Follow-up",
          metadata: {
            custom: {
              submittedTurnId: "turn-c",
              agentNativeQueuedMessageId: "operation-c",
            },
          },
        },
        {
          role: "assistant",
          content: "Follow-up answer",
          metadata: { custom: { turnId: "turn-c" } },
        },
      ],
    });
    expect(parseCommentAiConversation(threadData, "")).toEqual([
      {
        turnId: "turn-a",
        userText: "Earlier question",
        assistantText: "Earlier receipt",
        status: "complete",
      },
      {
        turnId: "turn-b",
        userText: "Current question",
        assistantText: "Current receipt",
        status: "complete",
      },
      {
        turnId: "turn-c",
        userText: "Follow-up",
        assistantText: "Follow-up answer",
        status: "complete",
      },
    ]);
    expect(
      parseCommentAiConversation(threadData, "turn-b", ["turn-a"]),
    ).toEqual([
      {
        turnId: "turn-c",
        userText: "Follow-up",
        assistantText: "Follow-up answer",
        status: "complete",
      },
    ]);
  });

  it("retains an unreceipted follow-up between two receipted requests", () => {
    const message = (role: string, turnId: string, content: string) => ({
      role,
      content,
      metadata: {
        custom: role === "user" ? { submittedTurnId: turnId } : { turnId },
      },
    });
    const data = JSON.stringify({
      messages: [
        message("user", "origin", "Question"),
        message("assistant", "origin", "Receipt"),
        message("user", "follow-up", "Why?"),
        message("assistant", "follow-up", "Because."),
        message("user", "current", "Another question"),
        message("assistant", "current", "Another receipt"),
      ],
    });
    expect(
      parseCommentAiConversation(data, "current", ["origin", "current"]),
    ).toEqual([
      {
        turnId: "follow-up",
        userText: "Why?",
        assistantText: "Because.",
        status: "complete",
      },
    ]);
  });

  it("preserves an incomplete continuation as recoverable state", () => {
    const threadData = JSON.stringify({
      messages: [
        {
          role: "user",
          content: "Initial",
          metadata: { custom: { submittedTurnId: "initial" } },
        },
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

  it("accepts Core's default empty thread data", () => {
    expect(parseCommentAiConversation("{}", "")).toEqual([]);
    expect(parseCommentAiConversation("{}", "initial")).toEqual([]);
  });

  it("fails loudly when persisted thread data is unreadable", () => {
    for (const data of [
      "not-json",
      "null",
      "[]",
      '{"unexpected":true}',
      '{"messages":{}}',
      '{"messages":[null]}',
      '{"messages":[{"message":{}}]}',
      '{"messages":[{"role":"user","content":{},"metadata":{"custom":{"submittedTurnId":"initial"}}}]}',
      '{"messages":[{"role":"user","content":"missing identity"}]}',
    ]) {
      expect(() => parseCommentAiConversation(data, "initial")).toThrow(
        "could not be read",
      );
    }
  });
});
