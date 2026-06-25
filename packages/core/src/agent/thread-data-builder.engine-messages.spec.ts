import { describe, it, expect } from "vitest";

import { threadDataToEngineMessages } from "./thread-data-builder.js";

describe("threadDataToEngineMessages", () => {
  it("returns [] for empty / unparseable input", () => {
    expect(threadDataToEngineMessages(undefined)).toEqual([]);
    expect(threadDataToEngineMessages(null)).toEqual([]);
    expect(threadDataToEngineMessages("")).toEqual([]);
    expect(threadDataToEngineMessages("{not json")).toEqual([]);
    expect(threadDataToEngineMessages(JSON.stringify({}))).toEqual([]);
  });

  it("rebuilds user + assistant text messages from the repo shape", () => {
    const repo = JSON.stringify({
      headId: "a1",
      messages: [
        {
          message: {
            id: "u1",
            role: "user",
            content: [{ type: "text", text: "Summarize Q3." }],
          },
          parentId: null,
        },
        {
          message: {
            id: "a1",
            role: "assistant",
            content: [
              { type: "text", text: "Here is the summary." },
              { type: "tool-call", toolName: "db-query", args: {} },
            ],
          },
          parentId: "u1",
        },
      ],
    });
    expect(threadDataToEngineMessages(repo)).toEqual([
      { role: "user", content: [{ type: "text", text: "Summarize Q3." }] },
      {
        role: "assistant",
        content: [{ type: "text", text: "Here is the summary." }],
      },
    ]);
  });

  it("accepts a string content field and skips empty/non-text messages", () => {
    const repo = {
      messages: [
        { message: { id: "u1", role: "user", content: "hello" } },
        { message: { id: "a1", role: "assistant", content: [] } }, // no text → skipped
        { message: { id: "x1", role: "system", content: "ignored" } }, // not user/assistant
      ],
    };
    expect(threadDataToEngineMessages(repo)).toEqual([
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ]);
  });
});
