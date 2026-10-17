import type { AppConfig } from "./schema.js";

export const BACKGROUND_AUTOMATION_SOFT_TIMEOUT_HEADROOM_MS = 20_000;

export const BACKGROUND_FUNCTION_WALL_MS = 15 * 60_000;

export const BACKGROUND_FUNCTION_WALL_HEADROOM_MS = 2 * 60_000;

export const BACKGROUND_SOFT_TIMEOUT_CEILING_MS = 13 * 60_000;

export const RUN_NO_PROGRESS_HARD_TIMEOUT_MS = 150_000;

export const MAX_CONSECUTIVE_NO_PROGRESS_CONTINUATIONS = 2;

export const MAX_TURN_WALL_CLOCK_MS = 90 * 60_000;

export const MAX_RUN_LOOP_CONTINUATIONS = 6;

export const MAX_BACKGROUND_RUN_LOOP_CONTINUATIONS = 20;

export const TURN_RUN_LEDGER_SLACK = 5;

export const MAX_BACKGROUND_RUN_CONTINUATIONS = 20;

export const MAX_FOLLOWED_BACKGROUND_RUNS = 30;
export const MAX_BACKGROUND_FOLLOW_WALL_TIME_MS = 110 * 60_000;

interface Invariant {
  name: string;
  smaller: { key: string; value: number };
  larger: { key: string; value: number };
  relation: "<" | "<=";
  why: string;
}

export class RunLifecycleInvariantError extends Error {
  constructor(violations: readonly Invariant[]) {
    super(
      `Agent run-lifecycle configuration is inconsistent:\n${violations
        .map(
          (v) =>
            `  - ${v.name}: ${v.smaller.key} (${v.smaller.value}) must be ` +
            `${v.relation === "<" ? "less than" : "at most"} ` +
            `${v.larger.key} (${v.larger.value}) — ${v.why}`,
        )
        .join("\n")}`,
    );
    this.name = "RunLifecycleInvariantError";
  }
}

export function assertRunLifecycleInvariants(agent: AppConfig["agent"]): void {
  const { backgroundNoProgressTimeoutMs, backgroundRunHardTimeoutMs } = agent;
  const backgroundSoftTimeoutCeilingMs = BACKGROUND_SOFT_TIMEOUT_CEILING_MS;
  const maxBackgroundRunContinuations = MAX_BACKGROUND_RUN_CONTINUATIONS;
  const maxConsecutiveNoProgressContinuations =
    MAX_CONSECUTIVE_NO_PROGRESS_CONTINUATIONS;
  const maxTurnWallClockMs = MAX_TURN_WALL_CLOCK_MS;

  const violations: Invariant[] = [];
  const require = (
    name: string,
    smaller: { key: string; value: number },
    larger: { key: string; value: number },
    why: string,
  ) => {
    if (smaller.value < larger.value) return;
    violations.push({ name, smaller, larger, relation: "<", why });
  };
  const requireAtMost = (
    name: string,
    smaller: { key: string; value: number },
    larger: { key: string; value: number },
    why: string,
  ) => {
    if (smaller.value <= larger.value) return;
    violations.push({ name, smaller, larger, relation: "<=", why });
  };

  if (backgroundNoProgressTimeoutMs > 0) {
    require("background backstop inside the background chunk budget", {
      key: "agent.backgroundNoProgressTimeoutMs",
      value: backgroundNoProgressTimeoutMs,
    }, {
      key: "agent.backgroundSoftTimeoutCeilingMs",
      value: backgroundSoftTimeoutCeilingMs,
    }, "a backstop at or above the chunk budget can never fire — the chunk boundary always arrives first");
    require("background backstop inside the automation's own budget", {
      key: "agent.backgroundNoProgressTimeoutMs",
      value: backgroundNoProgressTimeoutMs,
    }, {
      key: "agent.backgroundRunHardTimeoutMs - BACKGROUND_AUTOMATION_SOFT_TIMEOUT_HEADROOM_MS",
      value:
        backgroundRunHardTimeoutMs -
        BACKGROUND_AUTOMATION_SOFT_TIMEOUT_HEADROOM_MS,
    }, "an automation whose backstop outlives its own chunk budget dies at the hard abort instead of checkpointing");
  }

  requireAtMost(
    "background chunk budget inside the host's background-function wall",
    {
      key: "agent.backgroundSoftTimeoutCeilingMs",
      value: backgroundSoftTimeoutCeilingMs,
    },
    {
      key: "BACKGROUND_FUNCTION_WALL_MS - BACKGROUND_FUNCTION_WALL_HEADROOM_MS",
      value: BACKGROUND_FUNCTION_WALL_MS - BACKGROUND_FUNCTION_WALL_HEADROOM_MS,
    },
    "this ceiling is the clamp every background soft timeout is reduced to, so raising it past the host wall makes the chunk boundary unreachable and the run dies as a silent platform kill instead",
  );

  require("graceful boundary fits before the hard abort", {
    key: "BACKGROUND_AUTOMATION_SOFT_TIMEOUT_HEADROOM_MS",
    value: BACKGROUND_AUTOMATION_SOFT_TIMEOUT_HEADROOM_MS,
  }, {
    key: "agent.backgroundRunHardTimeoutMs",
    value: backgroundRunHardTimeoutMs,
  }, "without room for the headroom there is no chunk budget left to hand a boundary to");

  requireAtMost(
    "no-progress streak bound inside the chain bound",
    {
      key: "agent.maxConsecutiveNoProgressContinuations",
      value: maxConsecutiveNoProgressContinuations,
    },
    {
      key: "agent.maxBackgroundRunContinuations",
      value: maxBackgroundRunContinuations,
    },
    "a streak bound above the chain bound can never trip, so a repeating failure runs to the chain limit instead",
  );

  require("server chunk budget leaves the client room for more than one chunk", {
    key: "agent.backgroundSoftTimeoutCeilingMs * 2",
    value: backgroundSoftTimeoutCeilingMs * 2,
  }, {
    key: "MAX_BACKGROUND_FOLLOW_WALL_TIME_MS",
    value: MAX_BACKGROUND_FOLLOW_WALL_TIME_MS,
  }, "a whole-turn client budget below two full-length chunks kills a healthy turn mid-stream — the exact inversion that shipped");

  require("server turn ceiling below the client's follow budget", {
    key: "agent.maxTurnWallClockMs + agent.backgroundSoftTimeoutCeilingMs",
    value: maxTurnWallClockMs + backgroundSoftTimeoutCeilingMs,
  }, {
    key: "MAX_BACKGROUND_FOLLOW_WALL_TIME_MS",
    value: MAX_BACKGROUND_FOLLOW_WALL_TIME_MS,
  }, "the server must end the turn first, because it is the side that can tell progress from a loop and write a truthful terminal reason");

  require("server chain bound below the client's follow-run budget", {
    key: "agent.maxBackgroundRunContinuations + TURN_RUN_LEDGER_SLACK",
    value: maxBackgroundRunContinuations + TURN_RUN_LEDGER_SLACK,
  }, {
    key: "MAX_FOLLOWED_BACKGROUND_RUNS",
    value: MAX_FOLLOWED_BACKGROUND_RUNS,
  }, "a client that stops following before the server stops chaining leaves the user watching a spinner over a live run");

  requireAtMost(
    "turn ceiling above one chunk budget",
    {
      key: "agent.backgroundSoftTimeoutCeilingMs",
      value: backgroundSoftTimeoutCeilingMs,
    },
    { key: "agent.maxTurnWallClockMs", value: maxTurnWallClockMs },
    "a turn ceiling below a single chunk budget kills every turn at its first chunk boundary",
  );

  if (violations.length > 0) throw new RunLifecycleInvariantError(violations);
}
