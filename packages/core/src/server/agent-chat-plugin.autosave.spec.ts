import { describe, expect, it, vi } from "vitest";

import type { ActiveRun } from "../agent/run-manager.js";
import type { AgentChatEvent, AgentChatScope } from "../agent/types.js";
import {
  runPostAgentRunComplete,
  runPostAgentTurnAutosave,
  runPreAgentTurnAutosave,
} from "./agent-chat-plugin.js";
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

describe("pre-agent-turn autosave", () => {
  it("runs for a scoped turn before generation", async () => {
    const autosave = vi.fn();
    const run = { threadId: "thread-1", runId: "run-1" };

    await runPreAgentTurnAutosave(autosave, scope, run);

    expect(autosave).toHaveBeenCalledOnce();
    expect(autosave).toHaveBeenCalledWith(scope, {
      threadId: "thread-1",
      runId: "run-1",
    });
  });

  it("skips missing handlers or scope and contains callback failures", async () => {
    const autosave = vi.fn(async () => {
      throw new Error("snapshot unavailable");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await runPreAgentTurnAutosave(autosave, null, makeRun([]));
      await runPreAgentTurnAutosave(undefined, scope, makeRun([]));
      await expect(
        runPreAgentTurnAutosave(autosave, scope, makeRun([])),
      ).resolves.toBeUndefined();
      expect(autosave).toHaveBeenCalledOnce();
      expect(log).toHaveBeenCalledWith(
        "[agent-chat] pre-agent-turn autosave failed:",
        expect.any(Error),
      );
    } finally {
      log.mockRestore();
    }
  });
});

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

describe("post-agent-run observer", () => {
  it("runs for read-only turns and receives scope and run", async () => {
    const observer = vi.fn();
    const run = makeRun([
      { type: "tool_done", tool: "bigquery", result: "rows", isError: false },
    ]);

    await runPostAgentRunComplete(observer, scope, run);

    expect(observer).toHaveBeenCalledOnce();
    expect(observer).toHaveBeenCalledWith(scope, run);
  });

  it("reports observer errors without rejecting the completed run", async () => {
    const error = new Error("telemetry unavailable");
    const captured = vi.fn();
    const unregister = registerErrorCaptureProvider("observer-test", captured);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        runPostAgentRunComplete(
          async () => {
            throw error;
          },
          null,
          makeRun([{ type: "text", text: "done" }]),
        ),
      ).resolves.toBeUndefined();

      expect(captured).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          aiTraceId: "run-1",
          tags: expect.objectContaining({
            failureClass: "post-agent-run-observer",
          }),
        }),
      );
    } finally {
      unregister();
      log.mockRestore();
    }
  });
});
