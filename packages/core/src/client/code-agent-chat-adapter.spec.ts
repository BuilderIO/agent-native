import { describe, expect, it, vi } from "vitest";

import {
  codeAgentTranscriptEventsToContent,
  codeAgentTranscriptHasPendingApproval,
  createCodeAgentChatAdapter,
  type CodeAgentChatController,
  type CodeAgentChatTranscriptEvent,
} from "./code-agent-chat-adapter.js";

async function drain(iterable: AsyncIterable<unknown>) {
  const results: unknown[] = [];
  for await (const result of iterable) results.push(result);
  return results;
}

function runOptions(
  message: any,
  abortSignal = new AbortController().signal,
  runConfig: Record<string, unknown> = {},
) {
  return {
    messages: [message],
    abortSignal,
    runConfig,
    context: {},
    config: {},
    unstable_getMessage: () => message,
  } as any;
}

describe("codeAgentTranscriptEventsToContent", () => {
  it("maps Code transcript text and tool events into assistant-ui content", () => {
    const content = codeAgentTranscriptEventsToContent([
      event("assistant", "system", "Checking it now", {
        role: "assistant",
      }),
      event("tool-start", "status", "Running tests.", {
        type: "tool_start",
        tool: "test",
        input: { file: "app.tsx" },
      }),
      event("tool-done", "status", "Finished tests.", {
        type: "tool_done",
        tool: "test",
        result: "ok",
      }),
    ]);

    expect(content).toEqual([
      { type: "text", text: "Checking it now" },
      {
        type: "tool-call",
        toolCallId: "code-tool-tool-start",
        toolName: "test",
        argsText: '{\n  "file": "app.tsx"\n}',
        args: { file: "app.tsx" },
        result: "ok",
      },
    ]);
  });

  it("drops transcript content before a hosted agent clear marker", () => {
    const content = codeAgentTranscriptEventsToContent([
      event("draft", "system", "Rejected draft", { role: "assistant" }),
      event("clear", "status", "", { agentChatEventType: "clear" }),
      event("final", "system", "Corrected answer", { role: "assistant" }),
    ]);

    expect(content).toEqual([{ type: "text", text: "Corrected answer" }]);
  });

  it("preserves completed hosted tool output across a clear marker", () => {
    const content = codeAgentTranscriptEventsToContent([
      event("tool-start", "status", "Running query.", {
        type: "tool_start",
        tool: "query",
        input: { sql: "select 1" },
      }),
      event("tool-done", "status", "Finished query.", {
        type: "tool_done",
        tool: "query",
        result: "1",
      }),
      event("draft", "system", "Rejected draft", { role: "assistant" }),
      event("z-clear", "status", "", { agentChatEventType: "clear" }),
      event("final-answer", "system", "Corrected answer", {
        role: "assistant",
      }),
    ]);

    expect(content).toEqual([
      expect.objectContaining({
        type: "tool-call",
        toolName: "query",
        result: "1",
      }),
      { type: "text", text: "Corrected answer" },
    ]);
  });

  it("attaches an approval key to a bash tool-call still awaiting approval", () => {
    const content = codeAgentTranscriptEventsToContent([
      event("evt-tool-start", "status", "Running bash.", {
        type: "tool_start",
        tool: "bash",
        input: { command: "rm -rf tmp" },
      }),
      event("evt-tool-done", "status", "Finished bash.", {
        type: "tool_done",
        tool: "bash",
        result: [
          "Approval required before running this command: destructive recursive delete.",
          "Approval id: approval-20260710120000",
          "Command: rm -rf tmp",
          "The run is paused; approve from the Agent-Native Code UI/CLI if this command is intentional.",
        ].join("\n"),
      }),
    ]);

    expect(content).toEqual([
      expect.objectContaining({
        type: "tool-call",
        toolName: "bash",
        approval: { approvalKey: "approval-20260710120000" },
      }),
    ]);
  });

  it("does not attach an approval key once the approval has been resolved", () => {
    const content = codeAgentTranscriptEventsToContent([
      event("evt-tool-start", "status", "Running bash.", {
        type: "tool_start",
        tool: "bash",
        input: { command: "rm -rf tmp" },
      }),
      event("evt-tool-done", "status", "Finished bash.", {
        type: "tool_done",
        tool: "bash",
        result: [
          "Approval required before running this command: destructive recursive delete.",
          "Approval id: approval-20260710120000",
          "Command: rm -rf tmp",
        ].join("\n"),
      }),
      event("evt-denied", "status", "User denied command.", {
        status: "running",
        phase: "approval-denied",
        approvalId: "approval-20260710120000",
      }),
    ]);

    expect(content[0]).toEqual(
      expect.objectContaining({ type: "tool-call", toolName: "bash" }),
    );
    expect((content[0] as { approval?: unknown }).approval).toBeUndefined();
  });
});

describe("codeAgentTranscriptHasPendingApproval", () => {
  it("is true while a bash tool-call's approval is unresolved", () => {
    const hasPending = codeAgentTranscriptHasPendingApproval([
      event("evt-tool-start", "status", "Running bash.", {
        type: "tool_start",
        tool: "bash",
        input: { command: "rm -rf tmp" },
      }),
      event("evt-tool-done", "status", "Finished bash.", {
        type: "tool_done",
        tool: "bash",
        result:
          "Approval required before running this command: destructive recursive delete.\nApproval id: approval-1\nCommand: rm -rf tmp",
      }),
    ]);

    expect(hasPending).toBe(true);
  });

  it("is false once the approval has been resolved", () => {
    const hasPending = codeAgentTranscriptHasPendingApproval([
      event("evt-tool-start", "status", "Running bash.", {
        type: "tool_start",
        tool: "bash",
        input: { command: "rm -rf tmp" },
      }),
      event("evt-tool-done", "status", "Finished bash.", {
        type: "tool_done",
        tool: "bash",
        result:
          "Approval required before running this command: destructive recursive delete.\nApproval id: approval-1\nCommand: rm -rf tmp",
      }),
      event("evt-approved", "status", "Approved command; running now.", {
        status: "running",
        phase: "approval-running",
        approvalId: "approval-1",
      }),
    ]);

    expect(hasPending).toBe(false);
  });

  it("is false for a transcript with no approval activity", () => {
    const hasPending = codeAgentTranscriptHasPendingApproval([
      event("evt-tool-start", "status", "Running bash.", {
        type: "tool_start",
        tool: "bash",
        input: { command: "pnpm test" },
      }),
      event("evt-tool-done", "status", "Finished bash.", {
        type: "tool_done",
        tool: "bash",
        result: "1 passed",
      }),
    ]);

    expect(hasPending).toBe(false);
  });
});

describe("createCodeAgentChatAdapter", () => {
  it("sends the latest user prompt and attachments through the Code controller", async () => {
    const events: CodeAgentChatTranscriptEvent[] = [];
    const sendFollowUp = vi.fn(async () => {
      events.push(event("assistant", "system", "Done", { role: "assistant" }));
      return { ok: true };
    });
    const controller: CodeAgentChatController = {
      get: vi.fn(async () => ({ status: "completed" })),
      transcript: vi.fn(async () => events),
      sendFollowUp,
      control: vi.fn(async () => ({ ok: true })),
    };
    const adapter = createCodeAgentChatAdapter({
      controller,
      runIdRef: { current: "run-1" },
      permissionModeRef: { current: "full-auto" },
      modelRef: { current: "claude-sonnet-4-6" },
      engineRef: { current: "builder" },
      effortRef: { current: "high" },
      pollIntervalMs: 1,
      idlePollIntervalMs: 1,
      terminalIdlePolls: 1,
    });

    const results = await drain(
      adapter.run(
        runOptions({
          role: "user",
          content: [{ type: "text", text: "Fix it" }],
          attachments: [
            {
              name: "screen.png",
              contentType: "image/png",
              content: [{ type: "image", image: "data:image/png;base64,abc" }],
            },
          ],
        }),
      ) as AsyncIterable<unknown>,
    );

    expect(sendFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        prompt: "Fix it",
        permissionMode: "full-auto",
        model: "claude-sonnet-4-6",
        engine: "builder",
        reasoningEffort: "high",
        metadata: {
          attachments: [
            {
              name: "screen.png",
              type: "image/png",
              dataUrl: "data:image/png;base64,abc",
            },
          ],
        },
      }),
    );
    expect(results.at(-1)).toMatchObject({
      content: [{ type: "text", text: "Done" }],
      metadata: { custom: { runId: "run-1" } },
    });
  });

  it('resolves a paused approval through control("approve") instead of sending a follow-up', async () => {
    const sendFollowUp = vi.fn(async () => ({ ok: true }));
    const control = vi.fn(async () => ({ ok: true }));
    const controller: CodeAgentChatController = {
      get: vi.fn(async () => ({ status: "needs-approval" })),
      transcript: vi.fn(async () => []),
      sendFollowUp,
      control,
    };
    const adapter = createCodeAgentChatAdapter({
      controller,
      runIdRef: { current: "run-1" },
      pollIntervalMs: 1,
      idlePollIntervalMs: 1,
      terminalIdlePolls: 1,
    });

    await drain(
      adapter.run(
        runOptions(
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Approved. Go ahead and run the requested action.",
              },
            ],
          },
          new AbortController().signal,
          { custom: { approvedToolCalls: ["approval-1"] } },
        ),
      ) as AsyncIterable<unknown>,
    );

    expect(control).toHaveBeenCalledWith({
      runId: "run-1",
      command: "approve",
    });
    expect(sendFollowUp).not.toHaveBeenCalled();
  });

  it("yields an empty snapshot when a hosted agent clear marker arrives alone", async () => {
    const events: CodeAgentChatTranscriptEvent[] = [];
    const sendFollowUp = vi.fn(async () => {
      events.push(
        event("draft", "system", "Rejected draft", { role: "assistant" }),
        event("z-clear", "status", "", { agentChatEventType: "clear" }),
      );
      return { ok: true };
    });
    const controller: CodeAgentChatController = {
      get: vi.fn(async () => ({ status: "completed" })),
      transcript: vi.fn(async () => events),
      sendFollowUp,
      control: vi.fn(async () => ({ ok: true })),
    };
    const adapter = createCodeAgentChatAdapter({
      controller,
      runIdRef: { current: "run-1" },
      pollIntervalMs: 1,
      idlePollIntervalMs: 1,
      terminalIdlePolls: 1,
    });

    const results = await drain(
      adapter.run(
        runOptions({
          role: "user",
          content: [{ type: "text", text: "Fix it" }],
        }),
      ) as AsyncIterable<unknown>,
    );

    expect(results).toContainEqual(
      expect.objectContaining({
        content: [],
        metadata: { custom: { runId: "run-1" } },
      }),
    );
  });

  it("does not stop the Code run for lifecycle aborts by default", async () => {
    const abortController = new AbortController();
    const control = vi.fn(async () => ({ ok: true }));
    const controller: CodeAgentChatController = {
      get: vi.fn(async () => ({ status: "running" })),
      transcript: vi.fn(async () => []),
      sendFollowUp: vi.fn(async () => ({ ok: true })),
      control,
    };
    const adapter = createCodeAgentChatAdapter({
      controller,
      runIdRef: { current: "run-1" },
      pollIntervalMs: 5,
      idlePollIntervalMs: 5,
    });

    setTimeout(() => abortController.abort(), 0);
    await drain(
      adapter.run(
        runOptions(
          {
            role: "user",
            content: [{ type: "text", text: "Stop soon" }],
          },
          abortController.signal,
        ),
      ) as AsyncIterable<unknown>,
    );

    expect(control).not.toHaveBeenCalled();
  });

  it("can map assistant-ui aborts to Code stop when explicitly requested", async () => {
    const abortController = new AbortController();
    const control = vi.fn(async () => ({ ok: true }));
    const controller: CodeAgentChatController = {
      get: vi.fn(async () => ({ status: "running" })),
      transcript: vi.fn(async () => []),
      sendFollowUp: vi.fn(async () => ({ ok: true })),
      control,
    };
    const adapter = createCodeAgentChatAdapter({
      controller,
      runIdRef: { current: "run-1" },
      pollIntervalMs: 5,
      idlePollIntervalMs: 5,
      stopOnAbort: true,
    });

    setTimeout(() => abortController.abort(), 0);
    await drain(
      adapter.run(
        runOptions(
          {
            role: "user",
            content: [{ type: "text", text: "Stop soon" }],
          },
          abortController.signal,
        ),
      ) as AsyncIterable<unknown>,
    );

    expect(control).toHaveBeenCalledWith({ runId: "run-1", command: "stop" });
  });
});

function event(
  id: string,
  kind: CodeAgentChatTranscriptEvent["kind"],
  message: string,
  metadata?: Record<string, unknown>,
): CodeAgentChatTranscriptEvent {
  return {
    id,
    runId: "run-1",
    kind,
    message,
    createdAt: `2026-05-17T12:00:0${id.length % 10}.000Z`,
    metadata,
  };
}
