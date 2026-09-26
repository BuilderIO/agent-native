import type {
  AgentChatRuntimeEvent,
  AgentChatRuntimeTurn,
} from "@agent-native/core/client/agent-chat";
import type { CodeAgentTranscriptEvent } from "@shared/ipc-channels";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDesktopLocalAgentRuntime } from "./desktop-local-agent-runtime.js";

type TranscriptListener = Parameters<
  ElectronAPI["codeAgents"]["subscribeTranscript"]
>[1];

function createDesktopAgentApi(stopOk = true) {
  let listener: TranscriptListener | undefined;
  const unsubscribe = vi.fn();
  const controlRun = vi.fn(async () => ({
    ok: stopOk,
    command: "stop" as const,
    message: stopOk ? "Run stopped." : "Could not stop the run.",
    ...(stopOk ? {} : { error: "stop_failed" }),
  }));
  const codeAgents = {
    createRun: vi.fn(async () => ({
      ok: true,
      run: { id: "run-1", goalId: "goal-1" },
      message: "Run started.",
    })),
    readTranscript: vi.fn(async () => ({ status: "ok" as const, events: [] })),
    appendFollowUp: vi.fn(async () => ({
      ok: true,
      message: "Follow-up added.",
    })),
    subscribeTranscript: vi.fn(
      (_request: unknown, callback: TranscriptListener) => {
        listener = callback;
        return unsubscribe;
      },
    ),
    controlRun,
  } as unknown as ElectronAPI["codeAgents"];

  vi.stubGlobal("window", { electronAPI: { codeAgents } });

  return {
    codeAgents,
    controlRun,
    unsubscribe,
    emit(events: CodeAgentTranscriptEvent[]) {
      listener?.({ status: "ok", runId: "run-1", events });
    },
  };
}

function completedEvent(): CodeAgentTranscriptEvent {
  return {
    id: "event-completed",
    runId: "run-1",
    type: "status",
    text: "Run completed.",
    createdAt: "2026-09-26T12:00:00.000Z",
    metadata: { status: "completed" },
  };
}

function needsApprovalEvent(): CodeAgentTranscriptEvent {
  return {
    id: "event-approval",
    runId: "run-1",
    type: "status",
    text: "Approve the pending local action to continue.",
    createdAt: "2026-09-26T12:00:00.000Z",
    metadata: { status: "needs-approval" },
  };
}

function assistantDeltaEvent(): CodeAgentTranscriptEvent {
  return {
    id: "event-assistant-delta",
    runId: "run-1",
    type: "system",
    text: "I need approval before continuing.",
    createdAt: "2026-09-26T12:00:00.000Z",
    metadata: { type: "assistant_delta" },
  };
}

async function readEvents(turn: AgentChatRuntimeTurn) {
  const events: AgentChatRuntimeEvent[] = [];
  for await (const event of turn.events) events.push(event);
  return events;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Desktop local AgentKit runtime lifecycle", () => {
  it("does not retain a disposed session", async () => {
    const runtime = createDesktopLocalAgentRuntime("codex");
    const firstSession = await runtime.createSession({
      id: "session-1",
      threadId: "thread-a",
    });

    await firstSession.dispose?.();

    const secondSession = await runtime.createSession({
      id: "session-1",
      threadId: "thread-b",
    });
    expect(secondSession.threadId).toBe("thread-b");
  });

  it("starts local chat runs in read-only mode by default", async () => {
    const api = createDesktopAgentApi();
    const session = await createDesktopLocalAgentRuntime("codex").createSession(
      { id: "thread-default-mode" },
    );

    const turn = await session.startTurn({ prompt: "Inspect the workspace." });

    expect(api.codeAgents.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ permissionMode: "read-only" }),
    );
    await turn.cancel?.({ reason: "test" });
  });

  it.each([
    { approved: true, command: "approve" },
    { approved: false, command: "deny" },
  ] as const)(
    "surfaces approval and continues the same local run ($command)",
    async ({ approved, command }) => {
      const api = createDesktopAgentApi();
      const runtime = createDesktopLocalAgentRuntime("codex");
      const session = await runtime.createSession({ id: "thread-approval" });
      const turn = await session.startTurn({
        prompt: "Make the requested change.",
      });

      api.emit([assistantDeltaEvent(), needsApprovalEvent()]);
      const events = await readEvents(turn);
      expect(
        events.findIndex((event) => event.type === "message-done"),
      ).toBeLessThan(
        events.findIndex((event) => event.type === "approval-request"),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "approval-request",
          approvalId: "event-approval",
          message: "Approve the pending local action to continue.",
        }),
      );
      expect(events).not.toContainEqual(
        expect.objectContaining({ type: "error" }),
      );
      expect(runtime.capabilities.tools?.approvals).toBe(true);

      await expect(
        session.continueTurn?.({
          approval: { id: "stale-approval", approved: true },
        }),
      ).rejects.toThrow("not waiting for this approval");
      expect(api.controlRun).not.toHaveBeenCalled();

      const continued = await session.continueTurn?.({
        turnId: turn.id,
        approval: { id: "event-approval", approved },
      });
      expect(api.controlRun).toHaveBeenCalledWith("goal-1", "run-1", command);
      expect(continued?.runId).toBe("run-1");
      expect(continued?.id).not.toBe(turn.id);

      if (!continued) throw new Error("The local run did not continue.");
      api.emit([completedEvent()]);
      await expect(readEvents(continued)).resolves.toContainEqual(
        expect.objectContaining({ type: "done", reason: "complete" }),
      );
    },
  );

  it("keeps a failed stop distinct from an already-finished run", async () => {
    const api = createDesktopAgentApi(false);
    const session = await createDesktopLocalAgentRuntime("codex").createSession(
      {
        id: "thread-1",
        threadId: "thread-1",
      },
    );
    const turn = await session.startTurn({ prompt: "Inspect this workspace." });

    await expect(session.cancelTurn?.({ reason: "user" })).resolves.toEqual({
      status: "unsupported",
      message: "stop_failed",
    });
    await expect(
      session.startTurn({ prompt: "Continue while the first run is active." }),
    ).rejects.toThrow("stop_failed");
    expect(api.codeAgents.appendFollowUp).not.toHaveBeenCalled();
    expect(api.unsubscribe).not.toHaveBeenCalled();

    api.emit([completedEvent()]);
    await expect(readEvents(turn)).resolves.toContainEqual(
      expect.objectContaining({ type: "done", reason: "complete" }),
    );
    expect(api.unsubscribe).toHaveBeenCalledOnce();
  });

  it("closes the AgentKit event stream when stop succeeds", async () => {
    const api = createDesktopAgentApi();
    const session = await createDesktopLocalAgentRuntime("codex").createSession(
      {
        id: "thread-2",
        threadId: "thread-2",
      },
    );
    const turn = await session.startTurn({ prompt: "Inspect this workspace." });

    await expect(
      session.cancelTurn?.({ reason: "user" }),
    ).resolves.toMatchObject({ status: "cancelled" });
    await expect(readEvents(turn)).resolves.toContainEqual(
      expect.objectContaining({ type: "done", reason: "interrupted" }),
    );
    expect(api.unsubscribe).toHaveBeenCalledOnce();
  });

  it("closes the local event stream during disposal even if IPC stop fails", async () => {
    const api = createDesktopAgentApi(false);
    const session = await createDesktopLocalAgentRuntime("codex").createSession(
      {
        id: "thread-3",
        threadId: "thread-3",
      },
    );
    const turn = await session.startTurn({ prompt: "Inspect this workspace." });
    const eventsPromise = readEvents(turn);

    await session.dispose?.();

    await expect(eventsPromise).resolves.toContainEqual(
      expect.objectContaining({ type: "done", reason: "interrupted" }),
    );
    expect(api.unsubscribe).toHaveBeenCalledOnce();
    await expect(
      session.startTurn({ prompt: "Use a disposed session." }),
    ).rejects.toThrow("session has been disposed");
  });
});
