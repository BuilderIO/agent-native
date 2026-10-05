import { MAX_TURN_WALL_CLOCK_MS } from "../app-config/run-lifecycle-invariants.js";

/**
 * Automatic continuations of one user turn after the server stopped it at its
 * run time limit. Each one replays the turn's context to the model and runs up
 * to another full chunk (40 s foreground, 13 min background), so this bounds
 * what one message can spend unattended; past it the turn waits for Continue.
 */
export const MAX_AUTO_CONTINUES_PER_TURN = 3;

/**
 * A time-limit stop older than this is history: reopening an old thread must
 * not quietly spend another chunk on it. Longer than the browser's wait for a
 * server successor (`BACKGROUND_FUNCTION_WALL_HEADROOM_MS`).
 */
export const AUTO_CONTINUE_FRESHNESS_MS = 10 * 60_000;

/** Request metadata naming the stopped run an automatic continuation resumes. */
export const AUTO_CONTINUE_OF_RUN_METADATA_KEY =
  "agentNativeAutoContinueOfRunId";

// i18n-ignore: Internal continuation instruction sent to the agent, never shown as product copy.
export const AUTO_CONTINUE_PROMPT = "Continue from where you left off.";

export const AUTO_CONTINUE_REFUSAL_CODES = [
  /** The turn used its automatic continuations, or its wall-clock budget. */
  "auto_continue_cap_reached",
  /** The named run is not the turn's newest fresh time-limit stop. */
  "auto_continue_unavailable",
] as const;

export type AutoContinueRefusalCode =
  (typeof AUTO_CONTINUE_REFUSAL_CODES)[number];

/**
 * The only stops a turn continues from on its own: the server cut the run at
 * its time limit. Errors, stops, cancellations, refusals, and credential or
 * rate limits all end the turn for a person to decide.
 */
export function isTimeLimitStop(run: {
  readonly status: string;
  readonly terminalReason?: string | null;
}): boolean {
  return run.status === "truncated" && run.terminalReason === "run_timeout";
}

/** A turn as its run rows record it; the rows are the durable count. */
export interface TurnRunState {
  readonly newest: {
    readonly id: string;
    readonly status: string;
    readonly terminalReason: string | null;
    readonly completedAt: number | null;
  };
  /** Runs in the turn that automatically continued an earlier one. */
  readonly autoContinues: number;
  readonly startedAt: number;
}

/**
 * Whether the turn may start another run that continues `stoppedRunId`. Read
 * from the turn's rows, so a reload or a second tab gets the same answer.
 */
export function admitAutoContinue(input: {
  readonly turn: TurnRunState | null;
  readonly stoppedRunId: string;
  readonly nowMs: number;
}): { admit: true } | { admit: false; code: AutoContinueRefusalCode } {
  const turn = input.turn;
  if (
    !turn ||
    turn.newest.id !== input.stoppedRunId ||
    !isTimeLimitStop(turn.newest) ||
    turn.newest.completedAt === null ||
    input.nowMs - turn.newest.completedAt > AUTO_CONTINUE_FRESHNESS_MS
  ) {
    return { admit: false, code: "auto_continue_unavailable" };
  }
  // The server's own turn ceiling still ends the turn first; that is what
  // keeps a continued turn inside the browser's follow budget.
  if (
    turn.autoContinues >= MAX_AUTO_CONTINUES_PER_TURN ||
    input.nowMs - turn.startedAt > MAX_TURN_WALL_CLOCK_MS
  ) {
    return { admit: false, code: "auto_continue_cap_reached" };
  }
  return { admit: true };
}
