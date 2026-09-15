import { describe, expect, it, vi } from "vitest";

import {
  aiSdkHarnessPartToEvents,
  createNativeSession,
  resolveAiSdkHarnessPermissionMode,
} from "./ai-sdk-adapter.js";

describe("AI SDK harness session setup", () => {
  it("uses Codex's supported default and rejects unsupported modes", () => {
    expect(resolveAiSdkHarnessPermissionMode("codex")).toBe("allow-all");
    expect(resolveAiSdkHarnessPermissionMode("claude-code")).toBe(
      "allow-reads",
    );
    expect(() =>
      resolveAiSdkHarnessPermissionMode("codex", "allow-reads"),
    ).toThrow(/allow-all/);
  });

  it("passes the stable session resume contract to HarnessAgent", async () => {
    const createSession = vi.fn().mockResolvedValue({ id: "native-session" });
    const resumeState = { type: "resume-session", data: {} };

    await createNativeSession(
      { createSession },
      {
        sessionId: "agent-session",
        resumeState,
      },
    );

    expect(createSession).toHaveBeenCalledWith({
      sessionId: "agent-session",
      resumeFrom: resumeState,
    });
  });

  it("does not silently start a fresh session without a resume id", async () => {
    await expect(
      createNativeSession(
        { createSession: vi.fn() },
        { resumeState: { type: "resume-session", data: {} } },
      ),
    ).rejects.toThrow(/requires sessionId/);
  });
});

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
        input: { command: "npm test" },
        output: "ok",
      }),
    ).toEqual([
      {
        type: "tool-done",
        id: "t1",
        name: "bash",
        input: { command: "npm test" },
        result: "ok",
      },
    ]);
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
