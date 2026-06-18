import { describe, expect, it } from "vitest";
import { aiSdkHarnessPartToEvents } from "./ai-sdk-adapter.js";

describe("aiSdkHarnessPartToEvents", () => {
  it("maps AI SDK stream text and tool parts to harness events", () => {
    expect(
      aiSdkHarnessPartToEvents({ type: "text-delta", text: "hi" }),
    ).toEqual([{ type: "text-delta", text: "hi" }]);
    expect(
      aiSdkHarnessPartToEvents({
        type: "tool-call",
        toolCallId: "t1",
        toolName: "bash",
        input: { command: "npm test" },
      }),
    ).toEqual([
      {
        type: "tool-start",
        id: "t1",
        name: "bash",
        input: { command: "npm test" },
      },
    ]);
    expect(
      aiSdkHarnessPartToEvents({
        type: "tool-result",
        toolCallId: "t1",
        toolName: "bash",
        output: "ok",
      }),
    ).toEqual([{ type: "tool-done", id: "t1", name: "bash", result: "ok" }]);
  });

  it("maps approval, file, compaction, finish, and error parts", () => {
    expect(
      aiSdkHarnessPartToEvents({
        type: "tool-approval-request",
        id: "approval-1",
        toolName: "write",
        message: "Approve write?",
      }),
    ).toEqual([
      {
        type: "approval-request",
        id: "approval-1",
        tool: "write",
        message: "Approve write?",
        input: undefined,
      },
    ]);
    expect(
      aiSdkHarnessPartToEvents({
        type: "file-change",
        path: "README.md",
        operation: "update",
      }),
    ).toEqual([
      {
        type: "file-change",
        path: "README.md",
        operation: "update",
        summary: undefined,
      },
    ]);
    expect(aiSdkHarnessPartToEvents({ type: "compaction" })).toEqual([
      { type: "compaction", summary: undefined },
    ]);
    expect(
      aiSdkHarnessPartToEvents({ type: "finish", finishReason: "stop" }),
    ).toEqual([{ type: "done", reason: "stop" }]);
    expect(
      aiSdkHarnessPartToEvents({
        type: "error",
        error: new Error("boom"),
      }),
    ).toEqual([{ type: "error", error: "boom" }]);
  });
});
