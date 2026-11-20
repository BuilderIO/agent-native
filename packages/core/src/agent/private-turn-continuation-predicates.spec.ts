import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./run-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./run-store.js")>();
  return {
    ...actual,
    insertRun: vi.fn(async () => {}),
    insertRunEvent: vi.fn(async () => {}),
    insertRunEvents: vi.fn(async () => {}),
    updateRunStatus: vi.fn(async () => {}),
    updateRunStatusIfRunning: vi.fn(async () => true),
    updateRunHeartbeat: vi.fn(async () => {}),
    bumpRunProgress: vi.fn(async () => {}),
    setRunInFlightMarker: vi.fn(async () => {}),
    reconcileTerminalRunFromEvents: vi.fn(async () => false),
    ensureTerminalRunEvent: vi.fn(async () => true),
    getLastTerminalRunEvent: vi.fn(async () => null),
    resolveErroredRunTerminalEvent: vi.fn(async () => null),
    setRunError: vi.fn(async () => {}),
    setRunTerminalReason: vi.fn(async () => {}),
    setRunTerminalReasonIfStatus: vi.fn(async () => true),
    persistRunCheckpointEvent: vi.fn(async () => null),
    recordRunDiagnostic: vi.fn(async () => {}),
    getRunById: vi.fn(async () => null),
    getRunStatus: vi.fn(async () => "running"),
    getRunEventsSince: vi.fn(async () => []),
    claimTurnExecutionLease: vi.fn(async () => "lease-token"),
    renewTurnExecutionLease: vi.fn(async () => true),
    releaseTurnExecutionLease: vi.fn(async () => {}),
  };
});

import { runPostAgentRunComplete } from "../server/agent-chat-plugin.js";
import {
  backgroundContinuationReasonForRun,
  endsAtContinuationBoundary,
  resolveBackgroundNoProgressRepeat,
  shouldChainBackgroundContinuation,
} from "./production-agent.js";
import {
  endsAfterToolResultWithoutAssistantFinal,
  endsDuringActionPreparation,
  startRun,
} from "./run-manager.js";

describe("private-turn continuation predicates across run-manager, production-agent, and agent-chat-plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("treats redacted non-empty private assistant text as a finished turn across all callers", async () => {
    const runId = "run-private-shared-predicate-text";
    const observer = vi.fn();
    let endsAfterTool: boolean | undefined;
    let endsDuringPrep: boolean | undefined;
    let endsAtBoundary: boolean | undefined;
    let shouldChainBg: boolean | undefined;
    let shouldChainFg: boolean | undefined;
    let continuationReason: string | undefined;
    let serializedEvents = "";

    const run = startRun(
      runId,
      `thread-${runId}`,
      async (send) => {
        await send({
          type: "tool_start",
          id: "call-1",
          tool: "manage-gmail-draft",
          input: { to: "alice@example.com", body: "private-draft-sentinel" },
          omitFromPersistedHistory: true,
        });
        await send({
          type: "tool_done",
          id: "call-1",
          tool: "manage-gmail-draft",
          input: { to: "alice@example.com", body: "private-draft-sentinel" },
          result: "Draft created",
          completedSideEffect: true,
          omitFromPersistedHistory: true,
        });
        await send({
          type: "text",
          text: "I created the draft for Alice.",
          omitFromPersistedHistory: true,
        });
      },
      async (completionRun) => {
        serializedEvents = JSON.stringify(completionRun.events);
        endsAfterTool = endsAfterToolResultWithoutAssistantFinal(completionRun);
        endsDuringPrep = endsDuringActionPreparation(completionRun);
        endsAtBoundary = endsAtContinuationBoundary(completionRun);
        shouldChainBg = shouldChainBackgroundContinuation({
          isBackgroundWorker: true,
          run: completionRun,
          continuationCount: 0,
        });
        shouldChainFg = shouldChainBackgroundContinuation({
          isBackgroundWorker: false,
          foregroundSelfChainEligible: true,
          run: completionRun,
          continuationCount: 0,
        });
        continuationReason = backgroundContinuationReasonForRun(completionRun);
        await runPostAgentRunComplete(
          observer,
          { type: "mail", id: "inbox" },
          completionRun,
          { turnContinues: endsAtContinuationBoundary(completionRun) },
        );
      },
      { softTimeoutMs: 0 },
    );

    await run.finalized;

    expect(serializedEvents).not.toContain("private-draft-sentinel");
    expect(serializedEvents).not.toContain("I created the draft for Alice.");
    expect(endsAfterTool).toBe(false);
    expect(endsDuringPrep).toBe(false);
    expect(endsAtBoundary).toBe(false);
    expect(shouldChainBg).toBe(false);
    expect(shouldChainFg).toBe(false);
    expect(continuationReason).not.toBe("stream_ended");
    expect(observer).toHaveBeenCalledWith(
      { type: "mail", id: "inbox" },
      expect.objectContaining({ runId }),
      { turnContinues: false },
    );
    expect(run.events.some(({ event }) => event.type === "auto_continue")).toBe(
      false,
    );
  });

  it("treats redacted private UI tool completions and post-prep private text as finished across all callers", async () => {
    for (const kind of ["ui", "action-prep-then-text"] as const) {
      const runId = `run-private-shared-predicate-${kind}`;
      const observer = vi.fn();
      let endsAtBoundary: boolean | undefined;
      let shouldChainBg: boolean | undefined;
      let continuationReason: string | undefined;

      const run = startRun(
        runId,
        `thread-${runId}`,
        async (send) => {
          if (kind === "ui") {
            await send({
              type: "tool_start",
              id: "call-ui",
              tool: "render-private-card",
              input: { secret: "private-ui-sentinel" },
              omitFromPersistedHistory: true,
            });
            await send({
              type: "tool_done",
              id: "call-ui",
              tool: "render-private-card",
              input: { secret: "private-ui-sentinel" },
              result: "ok",
              chatUI: { renderer: "core.inline-extension" },
              omitFromPersistedHistory: true,
            });
          } else {
            await send({
              type: "tool_input_start",
              id: "call-prep",
              tool: "manage-gmail-draft",
              omitFromPersistedHistory: true,
            });
            await send({
              type: "text",
              text: "Finished without calling the draft action.",
              omitFromPersistedHistory: true,
            });
          }
        },
        async (completionRun) => {
          endsAtBoundary = endsAtContinuationBoundary(completionRun);
          shouldChainBg = shouldChainBackgroundContinuation({
            isBackgroundWorker: true,
            run: completionRun,
            continuationCount: 0,
          });
          continuationReason =
            backgroundContinuationReasonForRun(completionRun);
          await runPostAgentRunComplete(observer, null, completionRun, {
            turnContinues: endsAtContinuationBoundary(completionRun),
          });
        },
        { softTimeoutMs: 0 },
      );

      await run.finalized;

      expect(endsAtBoundary).toBe(false);
      expect(shouldChainBg).toBe(false);
      expect(continuationReason).not.toBe("stream_ended");
      expect(observer).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ runId }),
        { turnContinues: false },
      );
      expect(
        run.events.some(({ event }) => event.type === "auto_continue"),
      ).toBe(false);
    }
  });

  it("still marks a private turn unfinished when emitted assistant text was genuinely empty", async () => {
    const runId = "run-private-shared-predicate-empty";
    const observer = vi.fn();
    let endsAtBoundary: boolean | undefined;
    let shouldChainBg: boolean | undefined;
    let continuationReason: string | undefined;

    const run = startRun(
      runId,
      `thread-${runId}`,
      async (send) => {
        await send({
          type: "tool_start",
          id: "call-1",
          tool: "manage-gmail-draft",
          input: {},
          omitFromPersistedHistory: true,
        });
        await send({
          type: "tool_done",
          id: "call-1",
          tool: "manage-gmail-draft",
          input: {},
          result: "Draft created",
          completedSideEffect: true,
          omitFromPersistedHistory: true,
        });
        await send({
          type: "text",
          text: "   ",
          omitFromPersistedHistory: true,
        });
      },
      async (completionRun) => {
        endsAtBoundary = endsAtContinuationBoundary(completionRun);
        shouldChainBg = shouldChainBackgroundContinuation({
          isBackgroundWorker: true,
          run: completionRun,
          continuationCount: 0,
        });
        continuationReason = backgroundContinuationReasonForRun(completionRun);
        await runPostAgentRunComplete(observer, null, completionRun, {
          turnContinues: endsAtContinuationBoundary(completionRun),
        });
      },
      { softTimeoutMs: 0 },
    );

    await run.finalized;

    expect(endsAtBoundary).toBe(true);
    expect(shouldChainBg).toBe(true);
    expect(continuationReason).toBe("stream_ended");
    expect(observer).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ runId }),
      { turnContinues: true },
    );
    expect(
      run.events.some(
        ({ event }) =>
          event.type === "auto_continue" && event.reason === "stream_ended",
      ),
    ).toBe(true);
  });

  it("counts redacted non-empty private text as forward progress for no-progress repeat detection", async () => {
    const runId = "run-private-shared-predicate-progress";
    let repeat:
      | ReturnType<typeof resolveBackgroundNoProgressRepeat>
      | undefined;

    const run = startRun(
      runId,
      `thread-${runId}`,
      async (send) => {
        await send({
          type: "text",
          text: "Here is part of the private answer.",
          omitFromPersistedHistory: true,
        });
        await send({
          type: "error",
          error: "write outcome unknown",
          errorCode: "write_tool_outcome_unknown",
          recoverable: true,
        });
      },
      async (completionRun) => {
        repeat = resolveBackgroundNoProgressRepeat({
          run: completionRun,
          priorErrorCode: "write_tool_outcome_unknown",
          priorCount: 2,
        });
      },
      { softTimeoutMs: 0 },
    );

    await run.finalized;

    expect(repeat).toEqual({ count: 0, tripped: false });
  });
});
