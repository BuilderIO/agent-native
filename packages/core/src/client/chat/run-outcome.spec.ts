import type { AgentEvent } from "@agent-native/agentkit/protocol";
import { describe, expect, it } from "vitest";

import { BACKGROUND_FUNCTION_WALL_HEADROOM_MS } from "../../app-config/run-lifecycle-invariants.js";
import {
  LEGACY_RUN_CODES,
  MAX_SUBSCRIBE_FAILURES,
  RUN_OUTCOMES,
  RUN_SIGNED_OUT_MESSAGE,
  RUN_UNVERIFIED_MESSAGE,
  decideAfterStreamClosed,
  runOutcomeForCode,
  runOutcomeOfEvents,
  type RunAuthorityRead,
  type ServerRunState,
  type StreamClosedContext,
} from "./run-outcome.js";

const context = (
  overrides: Partial<StreamClosedContext> = {},
): StreamClosedContext => ({
  runId: "run-1",
  quietReads: 0,
  subscribeFailures: 0,
  nowMs: 1_000_000,
  ...overrides,
});

const read = (state: ServerRunState): RunAuthorityRead => ({
  kind: "read",
  state,
});

const DRAINED = { runId: "run-1", attempts: 1, readToEnd: true };

describe("run outcome codes", () => {
  it("maps every legacy 'the agent stopped' code into the closed outcome set", () => {
    // The incident codes users reported as one state: "the agent stopped / is
    // stuck". Each must stay mapped; a code the table forgets is a type error.
    const reported = [
      "stream_ended",
      "action_not_started",
      "background_run_lost",
      "run_budget_exhausted",
      "aborted_abort_check_unavailable",
      "connection_error",
      "run_stream_failed",
      "run_timeout",
      "builder_gateway_stream_ended",
      "thread_not_found",
      "interrupted_before_reporting",
      "run_slot_busy",
    ];
    for (const code of reported) {
      expect(LEGACY_RUN_CODES).toContain(code);
    }
    for (const code of LEGACY_RUN_CODES) {
      expect(RUN_OUTCOMES).toContain(runOutcomeForCode(code));
    }
    expect(RUN_OUTCOMES.length).toBeLessThanOrEqual(6);
  });

  it("keeps a still-working thread out of the failure outcomes", () => {
    expect(runOutcomeForCode("run_slot_busy")).toBe("running");
    expect(runOutcomeForCode("background_continuation_dispatch_deferred")).toBe(
      "running",
    );
    expect(runOutcomeForCode("run_subscription_poll_failed")).toBe(
      "unverified",
    );
  });

  it("reports an unmapped code as a real failure, never a success", () => {
    expect(runOutcomeForCode("provider_auth_failed")).toBe("failed");
    expect(runOutcomeForCode(undefined)).toBe("failed");
  });

  it("classifies abort codes by who stopped the run", () => {
    expect(runOutcomeForCode("aborted_user")).toBe("stopped");
    expect(runOutcomeForCode("aborted_user_stuck_cancel")).toBe("stopped");
    expect(runOutcomeForCode("aborted_no_progress")).toBe("interrupted");
    expect(runOutcomeForCode("aborted_adapter-dispose")).toBe("interrupted");
  });

  it("reads the outcome a protocol event log shows", () => {
    const failed = {
      type: "run.failed",
      error: { code: "stale_run", message: "stopped" },
    } as AgentEvent;
    expect(runOutcomeOfEvents([])).toBe("running");
    expect(runOutcomeOfEvents([failed])).toBe("interrupted");
    expect(runOutcomeOfEvents([{ type: "run.completed" } as AgentEvent])).toBe(
      "succeeded",
    );
    expect(runOutcomeOfEvents([{ type: "run.cancelled" } as AgentEvent])).toBe(
      "stopped",
    );
  });
});

describe("decideAfterStreamClosed", () => {
  it("never ends a run the server cannot be reached about", () => {
    for (const quietReads of [0, 1, 5, 50]) {
      const decision = decideAfterStreamClosed(
        { kind: "unreachable", error: new TypeError("Failed to fetch") },
        context({ quietReads, waitingSinceMs: 0 }),
      );
      expect(decision.type).toBe("wait");
    }
  });

  it("never ends a run the server says is running, and follows its successor", () => {
    expect(
      decideAfterStreamClosed(
        read({ status: "running", runId: "run-1" }),
        context({ quietReads: 3, drain: DRAINED }),
      ),
    ).toMatchObject({ type: "resubscribe", runId: "run-1", drain: false });
    expect(
      decideAfterStreamClosed(
        read({ status: "running", runId: "run-2", turnId: "turn-1" }),
        context({ quietReads: 3 }),
      ),
    ).toEqual({
      type: "resubscribe",
      runId: "run-2",
      turnId: "turn-1",
      delayMs: 0,
      drain: false,
    });
  });

  it("re-reads a terminal run once to receive the server's own terminal event", () => {
    for (const status of [
      "completed",
      "errored",
      "aborted",
      "truncated",
    ] as const) {
      expect(
        decideAfterStreamClosed(
          read({ status, runId: "run-1", terminalReason: null }),
          context(),
        ),
      ).toMatchObject({ type: "resubscribe", runId: "run-1", drain: true });
    }
  });

  it("retries reading a finished run's stream a bounded number of times", () => {
    const completed = read({
      status: "completed",
      runId: "run-1",
      terminalReason: "done",
    });
    const attempt = (attempts: number) =>
      decideAfterStreamClosed(
        completed,
        context({ drain: { runId: "run-1", attempts, readToEnd: false } }),
      );
    expect(attempt(1)).toMatchObject({
      type: "resubscribe",
      drain: true,
      delayMs: 250,
    });
    expect(attempt(2)).toMatchObject({ type: "resubscribe", drain: true });
    expect(attempt(3)).toEqual({ type: "terminal", outcome: "succeeded" });
  });

  it("ends a drained run with the server's recorded outcome", () => {
    const drained = context({ drain: DRAINED });
    expect(
      decideAfterStreamClosed(
        read({ status: "completed", runId: "run-1", terminalReason: "done" }),
        drained,
      ),
    ).toEqual({ type: "terminal", outcome: "succeeded" });
    expect(
      decideAfterStreamClosed(
        read({
          status: "aborted",
          runId: "run-1",
          terminalReason: "aborted:user",
        }),
        drained,
      ),
    ).toEqual({ type: "terminal", outcome: "stopped" });
    expect(
      decideAfterStreamClosed(
        read({
          status: "errored",
          runId: "run-1",
          terminalReason: "error:provider_auth_failed",
        }),
        drained,
      ),
    ).toMatchObject({
      type: "terminal",
      outcome: "failed",
      error: { code: "provider_auth_failed", retryable: false },
    });
    expect(
      decideAfterStreamClosed(
        read({
          status: "errored",
          runId: "run-1",
          terminalReason: "error:stale_run",
        }),
        drained,
      ),
    ).toMatchObject({
      type: "terminal",
      outcome: "interrupted",
      error: { code: "stale_run", retryable: true },
    });
    expect(
      decideAfterStreamClosed(
        read({
          status: "aborted",
          runId: "run-1",
          terminalReason: "aborted:auto_stuck_retry",
        }),
        drained,
      ),
    ).toMatchObject({
      type: "terminal",
      outcome: "interrupted",
      error: { code: "aborted_auto_stuck_retry" },
    });
  });

  it("waits for a continuation's successor before reporting the chunk as interrupted", () => {
    const truncated = read({
      status: "truncated",
      runId: "run-1",
      terminalReason: "run_timeout",
    });
    const startedAt = 1_000_000;
    expect(
      decideAfterStreamClosed(
        truncated,
        context({ drain: DRAINED, nowMs: startedAt }),
      ),
    ).toMatchObject({ type: "wait" });
    expect(
      decideAfterStreamClosed(
        truncated,
        context({
          drain: DRAINED,
          waitingSinceMs: startedAt,
          nowMs: startedAt + BACKGROUND_FUNCTION_WALL_HEADROOM_MS - 1,
        }),
      ),
    ).toMatchObject({ type: "wait" });
    expect(
      decideAfterStreamClosed(
        truncated,
        context({
          drain: DRAINED,
          waitingSinceMs: startedAt,
          nowMs: startedAt + BACKGROUND_FUNCTION_WALL_HEADROOM_MS,
        }),
      ),
    ).toMatchObject({
      type: "terminal",
      outcome: "interrupted",
      error: { code: "run_timeout", retryable: true },
    });
    expect(
      decideAfterStreamClosed(
        read({
          status: "aborted",
          runId: "run-1",
          terminalReason: "aborted:run_timeout",
        }),
        context({ drain: DRAINED }),
      ),
    ).toMatchObject({ type: "wait" });
  });

  it("backs off a successor whose event stream would not open, then stops following it as unverified", () => {
    const successor = read({ status: "running", runId: "run-2" });
    const delays = [0, 1, 2, 3].map(
      (subscribeFailures) =>
        (
          decideAfterStreamClosed(
            successor,
            context({ subscribeFailures }),
          ) as {
            delayMs: number;
          }
        ).delayMs,
    );
    expect(delays).toEqual([0, 250, 500, 1_000]);
    const exhausted = decideAfterStreamClosed(
      successor,
      context({ subscribeFailures: MAX_SUBSCRIBE_FAILURES }),
    );
    expect(exhausted).toMatchObject({
      type: "terminal",
      outcome: "unverified",
      error: {
        code: "run_events_unreachable",
        message: RUN_UNVERIFIED_MESSAGE,
        retryable: true,
      },
    });
    expect(runOutcomeForCode("run_events_unreachable")).toBe("unverified");
  });

  it("ends as unverified when the server refuses to say how the run is doing", () => {
    expect(
      decideAfterStreamClosed({ kind: "refused", status: 401 }, context()),
    ).toMatchObject({
      type: "terminal",
      outcome: "unverified",
      error: { code: "run_state_unreadable", message: RUN_SIGNED_OUT_MESSAGE },
    });
    for (const refusal of [{ status: 403 }, { status: 400 }, {}]) {
      expect(
        decideAfterStreamClosed({ kind: "refused", ...refusal }, context()),
      ).toMatchObject({
        type: "terminal",
        outcome: "unverified",
        error: {
          code: "run_state_unreadable",
          message: RUN_UNVERIFIED_MESSAGE,
        },
      });
    }
    expect(runOutcomeForCode("run_state_unreadable")).toBe("unverified");
  });

  it("reports a run the server has no record of as interrupted, with the server's code", () => {
    expect(
      decideAfterStreamClosed(read({ status: "missing" }), context()),
    ).toMatchObject({
      type: "terminal",
      outcome: "interrupted",
      error: { code: "run_record_missing", retryable: true },
    });
  });
});
