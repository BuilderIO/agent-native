import type {
  AgentChatRuntime,
  AgentChatRuntimeMessage,
  CodeAgentChatController,
  CodeAgentChatTranscriptEvent,
} from "@agent-native/core/client/agent-chat";
import { describe, expect, it, vi } from "vitest";

import {
  CODE_AGENT_CHAT_METADATA_KEY,
  CODE_AGENT_CONVERSATION_MEDIA_TYPE,
  createCodeAgentAgentKitRuntime,
  startCodeAgentExternalTranscriptBridge,
} from "./code-agent-agentkit-runtime.js";

function event(
  id: string,
  kind: NonNullable<CodeAgentChatTranscriptEvent["kind"]>,
  message: string,
  metadata?: Record<string, unknown>,
): CodeAgentChatTranscriptEvent {
  return {
    id,
    runId: "run-1",
    kind,
    message,
    createdAt: `2026-09-25T20:00:0${kind === "user" ? "1" : "2"}.000Z`,
    ...(metadata ? { metadata } : {}),
  };
}

function controller(overrides: Partial<CodeAgentChatController> = {}) {
  const get = vi.fn<CodeAgentChatController["get"]>(async () => null);
  const transcript = vi.fn<CodeAgentChatController["transcript"]>(
    async () => [],
  );
  const sendFollowUp = vi.fn<CodeAgentChatController["sendFollowUp"]>(
    async () => ({ ok: true }),
  );
  const control = vi.fn<CodeAgentChatController["control"]>(async () => ({
    ok: true,
  }));
  return {
    controller: { get, transcript, sendFollowUp, control, ...overrides },
    get,
    transcript,
    sendFollowUp,
    control,
  };
}

function userMessage(messages: readonly AgentChatRuntimeMessage[] | undefined) {
  return messages?.find((message) => message.role === "user");
}

describe("createCodeAgentAgentKitRuntime", () => {
  it("loads normalized transcript history with attachment chips", async () => {
    const attachments = [
      {
        name: "brief.md",
        type: "text/markdown",
        size: 12,
        text: "Project brief",
      },
    ];
    const host = controller({
      transcript: vi.fn(async () => [
        event("user-1", "user", "Review this", { attachments }),
      ]),
    });
    const runtime = createCodeAgentAgentKitRuntime({
      controller: host.controller,
    });
    const session = await runtime.createSession({ threadId: "run-1" });

    const snapshot = await session.snapshot?.();
    const user = userMessage(snapshot?.messages);
    const messageData = user?.content.find(
      (part) =>
        part.type === "data" &&
        part.mediaType === CODE_AGENT_CONVERSATION_MEDIA_TYPE,
    );

    expect(user?.role).toBe("user");
    expect(messageData).toMatchObject({
      type: "data",
      data: {
        message: {
          text: "Review this",
          attachments: [{ name: "brief.md" }],
        },
      },
    });
    expect(snapshot?.status).toBe("idle");
  });

  it("refreshes snapshots from a transcript written by another Code Agent surface", async () => {
    let externalTranscript: CodeAgentChatTranscriptEvent[] = [];
    const host = controller({
      transcript: vi.fn(async () => externalTranscript),
    });
    const runtime = createCodeAgentAgentKitRuntime({
      controller: host.controller,
    });
    const session = await runtime.createSession({ threadId: "run-1" });

    expect((await session.snapshot?.())?.messages).toEqual([]);
    externalTranscript = [
      event("external-user", "user", "Started in another surface."),
      event("external-assistant", "system", "Remote work is underway.", {
        role: "assistant",
      }),
    ];

    const messages = (await session.snapshot?.())?.messages ?? [];
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(messages.at(-1)?.content).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: "Remote work is underway.",
      }),
    );
  });

  it("polls external transcript snapshots while no AgentKit run owns the stream", async () => {
    vi.useFakeTimers();
    try {
      let agentKitRunActive = false;
      const refresh = vi.fn(async () => undefined);
      const stop = startCodeAgentExternalTranscriptBridge({
        hasAgentKitRun: () => agentKitRunActive,
        refresh,
        intervalMs: 20,
      });

      await vi.advanceTimersByTimeAsync(20);
      expect(refresh).toHaveBeenCalledTimes(1);

      agentKitRunActive = true;
      await vi.advanceTimersByTimeAsync(20);
      expect(refresh).toHaveBeenCalledTimes(1);

      agentKitRunActive = false;
      await vi.advanceTimersByTimeAsync(20);
      expect(refresh).toHaveBeenCalledTimes(2);

      stop();
      await vi.advanceTimersByTimeAsync(40);
      expect(refresh).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("forwards host model, permission, follow-up, effort, and attachment options", async () => {
    const attachments = [
      {
        name: "screen.png",
        type: "image/png",
        size: 10,
        dataUrl: "data:image/png;base64,AA==",
      },
    ];
    let events: CodeAgentChatTranscriptEvent[] = [];
    let getCalls = 0;
    const host = controller({
      get: vi.fn(async () => {
        getCalls += 1;
        return { status: getCalls === 1 ? "running" : "completed" };
      }),
      transcript: vi.fn(async () => events),
      sendFollowUp: vi.fn(async () => {
        events = [
          event("user-1", "user", "Continue", { attachments }),
          event("assistant-1", "system", "I will continue.", {
            role: "assistant",
          }),
        ];
        return { ok: true };
      }),
    });
    const runtime = createCodeAgentAgentKitRuntime({
      controller: host.controller,
      pollIntervalMs: 0,
      idlePollIntervalMs: 0,
      terminalIdlePolls: 1,
    });
    const session = await runtime.createSession({ threadId: "run-1" });
    const turn = await session.startTurn({
      prompt: "Continue",
      model: "model-x",
      reasoningEffort: "high",
      metadata: {
        [CODE_AGENT_CHAT_METADATA_KEY]: {
          engine: "custom-engine",
          followUpMode: "queued",
          permissionMode: "ask",
          reasoningEffort: "max",
          attachments,
        },
      },
    });
    const emitted = [];
    for await (const item of turn.events) emitted.push(item);

    expect(host.controller.sendFollowUp).toHaveBeenCalledWith({
      runId: "run-1",
      prompt: "Continue",
      mode: "queued",
      permissionMode: "ask",
      engine: "custom-engine",
      model: "model-x",
      reasoningEffort: "max",
      source: "code-agent-chat",
      metadata: { attachments },
    });
    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "message-done",
        message: expect.objectContaining({
          role: "assistant",
          content: expect.arrayContaining([
            expect.objectContaining({ type: "text", text: "I will continue." }),
          ]),
        }),
      }),
    );
    expect(
      emitted.some(
        (item) =>
          item.type === "message-done" &&
          item.message.role === "user" &&
          item.message.content.some(
            (part) => part.type === "text" && part.text === "Continue",
          ),
      ),
    ).toBe(false);
  });

  it("keeps host approval pending and never maps AgentKit cancellation to code stop", async () => {
    let approvalResolved = false;
    let transcriptCalls = 0;
    const host = controller({
      get: vi.fn(async () =>
        approvalResolved
          ? { status: "completed" }
          : transcriptCalls < 2
            ? { status: "running" }
            : { status: "needs-approval", needsApproval: true },
      ),
      transcript: vi.fn(async () => {
        transcriptCalls += 1;
        return transcriptCalls < 3
          ? []
          : [
              event("assistant-1", "system", "Approval requested.", {
                role: "assistant",
              }),
            ];
      }),
    });
    const runtime: AgentChatRuntime = createCodeAgentAgentKitRuntime({
      controller: host.controller,
      pollIntervalMs: 1,
      idlePollIntervalMs: 1,
      terminalIdlePolls: 1,
    });
    const session = await runtime.createSession({ threadId: "run-1" });
    const turn = await session.startTurn({ prompt: "Run command" });
    const iterator = turn.events[Symbol.asyncIterator]();
    expect((await iterator.next()).value?.type).toBe("message-start");
    expect((await iterator.next()).value?.type).toBe("message-done");

    let nextSettled = false;
    const next = iterator.next().then((value) => {
      nextSettled = true;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(nextSettled).toBe(false);

    const cancellation = await session.cancelTurn?.({ runId: "run-1" });
    expect(cancellation?.status).toBe("unsupported");
    expect(host.control).not.toHaveBeenCalled();

    approvalResolved = true;
    expect((await next).value).toMatchObject({
      type: "done",
      reason: "complete",
    });
  });

  it("surfaces a host follow-up rejection as an error", async () => {
    const host = controller({
      sendFollowUp: vi.fn(async () => ({
        ok: false,
        error: "Host rejected it.",
      })),
    });
    const runtime = createCodeAgentAgentKitRuntime({
      controller: host.controller,
    });
    const session = await runtime.createSession({ threadId: "run-1" });

    await expect(session.startTurn({ prompt: "Continue" })).rejects.toThrow(
      "Host rejected it.",
    );
  });

  it("does not call the host when the chat connection gate is closed", async () => {
    const host = controller();
    const runtime = createCodeAgentAgentKitRuntime({
      controller: host.controller,
      isChatBlocked: () => true,
    });
    const session = await runtime.createSession({ threadId: "run-1" });

    await expect(session.startTurn({ prompt: "Continue" })).rejects.toThrow(
      "Connect Builder.io or add custom keys before chatting.",
    );
    expect(host.controller.sendFollowUp).not.toHaveBeenCalled();
  });
});
