import { describe, expect, it, vi } from "vitest";

import {
  aiSdkHarnessPartToEvents,
  createNativeSession,
  resolveAiSdkHarnessPermissionMode,
  toAiSdkToolApprovalContinuation,
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
    const sandboxSession = { id: "sandbox-session" };

    await createNativeSession(
      { createSession },
      {
        sessionId: "agent-session",
        resumeState,
        sandbox: sandboxSession,
      },
    );

    expect(createSession).toHaveBeenCalledWith({
      sessionId: "agent-session",
      resumeFrom: resumeState,
      sandboxSession,
    });
  });

  it("maps framework approvals to the stable Harness continuation shape", () => {
    expect(
      toAiSdkToolApprovalContinuation({
        id: "approval-1",
        approved: false,
        message: "Not this time",
      }),
    ).toEqual({
      type: "tool-approval-response",
      approvalId: "approval-1",
      approved: false,
      reason: "Not this time",
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
      aiSdkHarnessPartToEvents({ type: "text-delta", delta: "stable hi" }),
    ).toEqual([{ type: "text-delta", text: "stable hi" }]);
    expect(
      aiSdkHarnessPartToEvents({
        type: "reasoning-delta",
        delta: "stable thought",
      }),
    ).toEqual([{ type: "thinking-delta", text: "stable thought" }]);
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
    expect(
      aiSdkHarnessPartToEvents({
        type: "tool-input-start",
        id: "t1",
        toolName: "bash",
      }),
    ).toEqual([]);
  });

  it("maps approval, file, compaction, finish, and error parts", () => {
    expect(
      aiSdkHarnessPartToEvents({
        type: "tool-approval-request",
        approvalId: "approval-1",
        toolCall: {
          toolCallId: "tool-1",
          toolName: "write",
          input: { path: "README.md" },
        },
        message: "Approve write?",
      }),
    ).toEqual([
      {
        type: "approval-request",
        id: "approval-1",
        tool: "write",
        message: "Approve write?",
        input: { path: "README.md" },
      },
    ]);
    const toolCalls = new Map<string, { name: string; input?: unknown }>();
    aiSdkHarnessPartToEvents(
      {
        type: "tool-call",
        toolCallId: "tool-2",
        toolName: "write",
        input: { path: "src/app.ts" },
      },
      toolCalls,
    );
    expect(
      aiSdkHarnessPartToEvents(
        {
          type: "tool-approval-request",
          approvalId: "approval-2",
          toolCallId: "tool-2",
        },
        toolCalls,
      ),
    ).toEqual([
      {
        type: "approval-request",
        id: "approval-2",
        tool: "write",
        message: "Harness is waiting for approval",
        input: { path: "src/app.ts" },
      },
    ]);
    expect(toolCalls.size).toBe(0);
    expect(
      aiSdkHarnessPartToEvents({
        type: "file-change",
        path: "README.md",
        event: "modify",
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
      aiSdkHarnessPartToEvents({
        type: "tool-call",
        toolCallId: "file-1",
        toolName: "fileChange",
        input: { event: "modify", path: "src/app.ts" },
        dynamic: true,
        providerExecuted: true,
      }),
    ).toEqual([
      {
        type: "file-change",
        path: "src/app.ts",
        operation: "update",
      },
    ]);
    expect(
      aiSdkHarnessPartToEvents({
        type: "tool-result",
        toolCallId: "file-1",
        toolName: "fileChange",
        output: { event: "modify", path: "src/app.ts" },
        dynamic: true,
        providerExecuted: true,
      }),
    ).toEqual([]);
    expect(
      aiSdkHarnessPartToEvents({
        type: "tool-result",
        toolCallId: "compact-1",
        toolName: "compaction",
        output: { trigger: "auto", summary: "trimmed context" },
        dynamic: true,
        providerExecuted: true,
      }),
    ).toEqual([{ type: "compaction", summary: "trimmed context" }]);
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
