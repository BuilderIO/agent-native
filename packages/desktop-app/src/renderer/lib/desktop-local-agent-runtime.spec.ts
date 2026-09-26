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
