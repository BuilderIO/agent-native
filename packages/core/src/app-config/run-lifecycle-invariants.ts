import type { AppConfig } from "./schema.js";

/**
 * Wall-clock reserved between a background automation's chunk budget and its
 * own hard abort, so the boundary the run manager owns can actually fire and
 * be recovered before the runner kills the process.
 *
 * This is the constant that makes `automation soft timeout < automation hard
 * abort` true by construction rather than by hoping two independently chosen
 * numbers happen to be ordered — they were not: the shipped build gave the
 * automation path a 13-minute soft timeout under a 10-minute hard abort, so
 * the recoverable boundary was dead code and the only boundary an automation
 * could reach was the terminal one.
 */
export const BACKGROUND_AUTOMATION_SOFT_TIMEOUT_HEADROOM_MS = 60_000;

/**
 * The host's hard kill for a background function (Netlify: 15 minutes).
 *
 * Not configuration — a deployment does not choose it, the platform does. It is
 * here because `backgroundSoftTimeoutCeilingMs` IS the clamp that
 * `resolveRunSoftTimeoutMs` reduces every background soft timeout to, so once
 * that ceiling became configurable nothing was left bounding it: a deployment
 * could set 60 minutes and push its own chunk boundary past the wall the
 * ceiling exists to stay inside, turning every long background turn back into
 * the silent platform kill it was introduced to prevent. Configurable must not
 * mean unclamped.
 */
export const BACKGROUND_FUNCTION_WALL_MS = 15 * 60_000;

/**
 * Wall-clock a background chunk must leave itself to abort, persist the partial
 * turn, write the terminal event, and chain a successor before the host kills
 * the invocation. The shipped 13-minute ceiling under a 15-minute wall is
 * exactly this margin.
 */
export const BACKGROUND_FUNCTION_WALL_HEADROOM_MS = 2 * 60_000;

/**
 * Per-TURN follow budgets the browser applies while reading a background turn.
 *
 * They live here, not in `client/agent-chat-adapter.ts`, because they are one
 * half of an ordering relationship whose other half is server configuration —
 * and a relationship checked in only one of its two homes is the failure this
 * module exists to prevent. This file has no runtime imports (the `AppConfig`
 * import is type-only and erased), so the browser bundle pays nothing to read
 * them from here.
 *
 * CLIENT-ABOVE-SERVER: these MUST stay above the server's own ceilings. The
 * client fires on a clock and cannot tell looping from working; the server can,
 * so the server must always terminate a turn first and write a truthful
 * terminal reason. They shipped at 10 min / 6 runs while ONE legal background
 * chunk may run 13 minutes — so the client killed healthy turns the server was
 * still streaming, measured in production as aborts at 11-25 minutes with
 * progress recorded right up to the abort. That was the top non-auth cause of
 * "the chat just stopped".
 *
 * Do NOT tighten these to catch a stuck turn. A turn that is not progressing is
 * already caught twice by mechanisms that read progress rather than a clock:
 * `BACKGROUND_FOLLOW_IDLE_TIMEOUT_MS` and the repeated-terminal-reason
 * detector.
 */
export const MAX_FOLLOWED_BACKGROUND_RUNS = 24;
export const MAX_BACKGROUND_FOLLOW_WALL_TIME_MS = 95 * 60_000;

/**
 * Ordering relationships between the run-lifecycle bounds.
 *
 * Every one of these was already argued for in a source comment somewhere and
 * enforced by nothing, which is how the framework shipped a violated pair. The
 * check runs on resolved configuration — including the all-defaults case — so
 * a relationship broken by a new default fails the same way a relationship
 * broken by a deployment does.
 *
 * DECLARED EXCEPTION, deliberately not asserted:
 * `backgroundSoftTimeoutCeilingMs` (13 min) sits ABOVE
 * `backgroundRunHardTimeoutMs` (10 min). Those two bound different paths — the
 * ceiling belongs to a durable background CHAT chunk, whose wall is the host's
 * 15-minute background-function budget, while the hard abort belongs to the
 * in-process automation runner. The automation path does not inherit the
 * ceiling: it derives its budget from its own hard abort minus
 * `BACKGROUND_AUTOMATION_SOFT_TIMEOUT_HEADROOM_MS` (see
 * `resolveBackgroundAutomationSoftTimeoutMs`), which is what invariant 4 below
 * checks is possible at all.
 */
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

/**
 * Throws when the resolved run-lifecycle bounds cannot all do their job.
 *
 * Called from configuration resolution, so it fails at startup naming both
 * constants and the relationship rather than at 3am when a run dies inside the
 * window a mis-ordered pair opened.
 */
export function assertRunLifecycleInvariants(agent: AppConfig["agent"]): void {
  const {
    runNoProgressTimeoutMs,
    backgroundNoProgressTimeoutMs,
    backgroundSoftTimeoutCeilingMs,
    backgroundRunHardTimeoutMs,
    modelStreamNoProgressTimeoutMs,
    actionPreparationNoProgressTimeoutMs,
    maxBackgroundRunContinuations,
    maxConsecutiveNoProgressContinuations,
    maxTurnWallClockMs,
  } = agent;

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

  // A disabled backstop (0) has no ordering to satisfy — it never fires.
  if (backgroundNoProgressTimeoutMs > 0) {
    require("in-loop watchdog before the run-manager backstop", {
      key: "agent.modelStreamNoProgressTimeoutMs",
      value: modelStreamNoProgressTimeoutMs,
    }, {
      key: "agent.backgroundNoProgressTimeoutMs",
      value: backgroundNoProgressTimeoutMs,
    }, "the in-loop watchdog emits a boundary the agent loop itself recovers; the run-manager backstop is the coarser one above it");
    require("action-preparation watchdog before the run-manager backstop", {
      key: "agent.actionPreparationNoProgressTimeoutMs",
      value: actionPreparationNoProgressTimeoutMs,
    }, {
      key: "agent.backgroundNoProgressTimeoutMs",
      value: backgroundNoProgressTimeoutMs,
    }, "a stalled argument stream must be caught by the watchdog that knows which tool stalled");
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

  if (runNoProgressTimeoutMs > 0 && backgroundNoProgressTimeoutMs > 0) {
    requireAtMost(
      "foreground backstop ceiling under the background one",
      { key: "agent.runNoProgressTimeoutMs", value: runNoProgressTimeoutMs },
      {
        key: "agent.backgroundNoProgressTimeoutMs",
        value: backgroundNoProgressTimeoutMs,
      },
      "the foreground ceiling is clamped further by the chunk budget, so it can never usefully exceed the background window",
    );
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

  // ── Client-above-server ────────────────────────────────────────────────
  //
  // Until this branch these were pinned in `agent-chat-adapter.spec.ts` against
  // the server's module CONSTANTS. Making those constants configurable moved
  // the real values out from under that test without moving the test: a
  // deployment could raise any of them past what the shipped client can follow
  // and every check still passed. Asserting against the RESOLVED config is what
  // closes that.
  require("server chunk budget leaves the client room for more than one chunk", {
    key: "agent.backgroundSoftTimeoutCeilingMs * 2",
    value: backgroundSoftTimeoutCeilingMs * 2,
  }, {
    key: "MAX_BACKGROUND_FOLLOW_WALL_TIME_MS",
    value: MAX_BACKGROUND_FOLLOW_WALL_TIME_MS,
  }, "a whole-turn client budget below two full-length chunks kills a healthy turn mid-stream — the exact inversion that shipped");

  require("server turn ceiling below the client's follow budget", {
    key: "agent.maxTurnWallClockMs",
    value: maxTurnWallClockMs,
  }, {
    key: "MAX_BACKGROUND_FOLLOW_WALL_TIME_MS",
    value: MAX_BACKGROUND_FOLLOW_WALL_TIME_MS,
  }, "the server must end the turn first, because it is the side that can tell progress from a loop and write a truthful terminal reason");

  require("server chain bound below the client's follow-run budget", {
    key: "agent.maxBackgroundRunContinuations",
    value: maxBackgroundRunContinuations,
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
