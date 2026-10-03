import { describe, expect, it } from "vitest";

import { MAX_TURN_WALL_CLOCK_MS } from "../app-config/run-lifecycle-invariants.js";
import {
  AUTO_CONTINUE_FRESHNESS_MS,
  MAX_AUTO_CONTINUES_PER_TURN,
  admitAutoContinue,
  isTimeLimitStop,
  type TurnRunState,
} from "./auto-continue.js";

const NOW = 50_000_000;

function turn(
  newest: Partial<TurnRunState["newest"]> = {},
  overrides: Partial<Omit<TurnRunState, "newest">> = {},
): TurnRunState {
  return {
    newest: {
      id: "run-stopped",
      status: "truncated",
      terminalReason: "run_timeout",
      completedAt: NOW - 1_000,
      ...newest,
    },
    autoContinues: 0,
    startedAt: NOW - 60_000,
    ...overrides,
  };
}

const admit = (state: TurnRunState | null) =>
  admitAutoContinue({ turn: state, stoppedRunId: "run-stopped", nowMs: NOW });

describe("isTimeLimitStop", () => {
  it("is only the server's time-limit cut", () => {
    expect(isTimeLimitStop(turn().newest)).toBe(true);
    for (const run of [
      { status: "errored", terminalReason: "run_timeout" },
      { status: "errored", terminalReason: "error:credits-limit-daily" },
      { status: "errored", terminalReason: "error:provider_rate_limited" },
      { status: "errored", terminalReason: "missing_api_key" },
      { status: "aborted", terminalReason: "aborted:user" },
      { status: "aborted", terminalReason: "aborted:protocol-cancel" },
      { status: "aborted", terminalReason: "aborted:run_timeout" },
      { status: "truncated", terminalReason: "stream_ended" },
      { status: "truncated", terminalReason: "loop_limit" },
      { status: "truncated", terminalReason: "rate_limited" },
      { status: "truncated", terminalReason: "no_progress" },
      {
        status: "truncated",
        terminalReason: "background_continuation_dispatch_deferred",
      },
      { status: "completed", terminalReason: "done" },
    ]) {
      expect(isTimeLimitStop(run), JSON.stringify(run)).toBe(false);
    }
  });
});

describe("admitAutoContinue", () => {
  it("admits the turn's newest fresh time-limit stop", () => {
    expect(admit(turn())).toEqual({ admit: true });
  });

  it("refuses a stop that is not the turn's newest run, or not a time-limit stop", () => {
    for (const state of [
      turn({ id: "run-later", status: "running", completedAt: null }),
      turn({ status: "errored", terminalReason: "error:unknown" }),
      turn({ status: "aborted", terminalReason: "aborted:user" }),
      null,
    ]) {
      expect(admit(state)).toEqual({
        admit: false,
        code: "auto_continue_unavailable",
      });
    }
  });

  it("refuses a stale stop so reopening an old thread spends nothing", () => {
    expect(
      admit(turn({ completedAt: NOW - AUTO_CONTINUE_FRESHNESS_MS - 1 })),
    ).toEqual({ admit: false, code: "auto_continue_unavailable" });
  });

  it("caps automatic continuations per turn", () => {
    expect(
      admit(turn({}, { autoContinues: MAX_AUTO_CONTINUES_PER_TURN - 1 })),
    ).toEqual({ admit: true });
    expect(
      admit(turn({}, { autoContinues: MAX_AUTO_CONTINUES_PER_TURN })),
    ).toEqual({ admit: false, code: "auto_continue_cap_reached" });
  });

  it("never extends a turn past the server's own wall-clock budget", () => {
    expect(
      admit(turn({}, { startedAt: NOW - MAX_TURN_WALL_CLOCK_MS - 1 })),
    ).toEqual({ admit: false, code: "auto_continue_cap_reached" });
  });
});
