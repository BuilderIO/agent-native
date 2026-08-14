import { describe, expect, it, vi } from "vitest";

import { createDesktopLocalAgentRuntime } from "./desktop-local-agent-runtime.js";

describe("desktop local agent runtime", () => {
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
    const createRun = vi.fn().mockResolvedValue({
      ok: true,
      message: "started",
      run: { id: "run-1", goalId: "goal-1" },
    });
    const controlRun = vi.fn().mockResolvedValue({
      ok: true,
      message: "stopped",
    });
    const subscribeTranscript = vi.fn(() => () => undefined);
    vi.stubGlobal("window", {
      electronAPI: {
        codeAgents: { createRun, controlRun, subscribeTranscript },
      },
    });

    try {
      const runtime = createDesktopLocalAgentRuntime("codex");
      const session = await runtime.createSession({ id: "session-1" });
      const turn = await session.startTurn({ prompt: "inspect the repo" });

      expect(createRun).toHaveBeenCalledWith(
        expect.objectContaining({ permissionMode: "read-only" }),
      );
      await turn.cancel?.({ reason: "test" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
