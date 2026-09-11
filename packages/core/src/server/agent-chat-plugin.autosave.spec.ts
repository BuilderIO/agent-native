import { describe, expect, it, vi } from "vitest";

import type { ActiveRun } from "../agent/run-manager.js";
import type { AgentChatEvent, AgentChatScope } from "../agent/types.js";
import { runPostAgentTurnAutosave } from "./agent-chat-plugin.js";
import { registerErrorCaptureProvider } from "./capture-error.js";

function makeRun(events: AgentChatEvent[]): ActiveRun {
  return {
    runId: "run-1",
    threadId: "thread-1",
    turnId: "turn-1",
    events: events.map((event, seq) => ({ seq, event })),
    status: "completed",
    subscribers: new Set(),
    abort: new AbortController(),
    startedAt: 1,
  };
}

const scope: AgentChatScope = {
  type: "deck",
  id: "deck-1",
  label: "Launch",
};

describe("post-agent-turn autosave", () => {
  it("runs only for an explicit successful side effect and passes scope and run", async () => {
    const autosave = vi.fn();
    const run = makeRun([
      { type: "tool_done", tool: "read-deck", result: "ok" },
      {
        type: "tool_done",
        tool: "update-deck",
        result: "saved",
        completedSideEffect: true,
      },
    ]);

    await runPostAgentTurnAutosave(autosave, scope, run);

    expect(autosave).toHaveBeenCalledOnce();
    expect(autosave).toHaveBeenCalledWith(scope, run);
  });

  it("skips missing, failed, and non-side-effect tool completions", async () => {
    const autosave = vi.fn();

    await runPostAgentTurnAutosave(
      autosave,
      scope,
      makeRun([{ type: "tool_done", tool: "read-deck", result: "ok" }]),
    );
    await runPostAgentTurnAutosave(
      autosave,
      scope,
      makeRun([
        {
          type: "tool_done",
          tool: "update-deck",
          result: "blocked",
          completedSideEffect: false,
        },
      ]),
    );
    await runPostAgentTurnAutosave(
      autosave,
      scope,
      makeRun([
        {
          type: "tool_done",
          tool: "update-deck",
          result: "failed",
          isError: true,
          completedSideEffect: true,
        },
      ]),
    );
    await runPostAgentTurnAutosave(
      autosave,
      null,
      makeRun([
        {
          type: "tool_done",
          tool: "update-deck",
          result: "saved",
          completedSideEffect: true,
        },
      ]),
    );

    expect(autosave).not.toHaveBeenCalled();
  });

  it("reports autosave failures without rejecting the completed turn", async () => {
    const error = new Error("snapshot unavailable");
    const captured = vi.fn();
    const unregister = registerErrorCaptureProvider("autosave-test", captured);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        runPostAgentTurnAutosave(
          async () => {
            throw error;
          },
          scope,
          makeRun([
            {
              type: "tool_done",
              tool: "update-deck",
              result: "saved",
              completedSideEffect: true,
            },
          ]),
        ),
      ).resolves.toBeUndefined();

      expect(captured).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          aiTraceId: "run-1",
          tags: expect.objectContaining({
            failureClass: "post-agent-turn-autosave",
          }),
        }),
      );
      expect(log).toHaveBeenCalledWith(
        "[agent-chat] post-agent-turn autosave failed:",
        error,
      );
    } finally {
      unregister();
      log.mockRestore();
    }
  });
});
