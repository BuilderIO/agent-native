import { describe, expect, it } from "vitest";

import type { RemoteRun, RemoteTranscriptEvent } from "../remote-sessions-api";
import { buildRemoteChatState } from "./remote-presentation";

const run = (status: RemoteRun["status"]): RemoteRun => ({
  id: "run-1",
  title: "Remote task",
  status,
  createdAt: "2026-08-16T10:00:00.000Z",
  updatedAt:
    status === "completed"
      ? "2026-08-16T10:00:03.000Z"
      : "2026-08-16T10:00:00.000Z",
});

function event(
  id: string,
  type: RemoteTranscriptEvent["type"],
  text: string,
  metadata?: Record<string, unknown>,
): RemoteTranscriptEvent {
  const second =
    id === "user"
      ? "00"
      : id === "thinking"
        ? "01"
        : id === "start"
          ? "02"
          : id === "done"
            ? "03"
            : "04";
  return {
    id,
    runId: "run-1",
    type,
    text,
    createdAt: `2026-08-16T10:00:${second}.000Z`,
    metadata,
  };
}

describe("buildRemoteChatState", () => {
  it("projects remote thinking, tool calls, and final text into shared chat parts", () => {
    const state = buildRemoteChatState({
      run: run("completed"),
      events: [
        event("user", "user", "Inspect the workspace."),
        event("thinking", "status", "I will inspect the workspace.", {
          type: "thinking",
        }),
        event("start", "status", "Running list_files.", {
          type: "tool_start",
          tool: "list_files",
          toolCallId: "call-1",
          input: { path: "." },
        }),
        event("done", "status", "Finished list_files.", {
          type: "tool_done",
          tool: "list_files",
          toolCallId: "call-1",
          result: "README.md",
        }),
        event("answer", "system", "The workspace is ready."),
      ],
    });

    expect(state.isStreaming).toBe(false);
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]?.role).toBe("user");
    expect(state.messages[1]?.workDurationMs).toBe(3_000);
    expect(state.messages[1]?.parts.map((part) => part.type)).toEqual([
      "reasoning",
      "tool-call",
      "text",
    ]);
    expect(state.messages[1]?.parts[1]).toMatchObject({
      type: "tool-call",
      toolCallId: "call-1",
      toolName: "list_files",
      status: "completed",
      resultText: "README.md",
    });
  });

  it("keeps an active remote tool as a running tool with no synthetic spinner state", () => {
    const state = buildRemoteChatState({
      run: run("running"),
      events: [
        event("user", "user", "Run the checks."),
        event("start", "status", "Running checks.", {
          type: "tool_start",
          tool: "exec_command",
          input: { cmd: "pnpm test" },
        }),
      ],
    });

    expect(state.isStreaming).toBe(true);
    expect(state.messages[1]?.parts[0]).toMatchObject({
      type: "tool-call",
      status: "running",
      toolName: "exec_command",
    });
  });

  it("projects remote pending approval metadata into the shared approval affordance", () => {
    const state = buildRemoteChatState({
      run: {
        ...run("needs-approval"),
        needsApproval: true,
        metadata: {
          pendingApproval: {
            id: "approval-1",
            command: "pnpm test",
            reason: "Run the test suite",
          },
        },
      },
      events: [event("user", "user", "Run the tests.")],
    });

    expect(state.messages[1]?.parts[0]).toMatchObject({
      type: "tool-call",
      toolName: "Command",
      status: "awaiting-approval",
      approvalKey: "approval-1",
      inputText: '"pnpm test"',
    });
  });
});
