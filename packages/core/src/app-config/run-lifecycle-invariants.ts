import type { AppConfig } from "./schema.js";

/**
 * Wall-clock reserved between a background automation's round budget and its
 * own hard abort.
 *
 * It covers wind-down only — emit the terminal event, persist the turn, let
 * `finalized` settle — because the recoverable boundary on this path belongs to
 * the agent-loop wrapper's own per-round timer, not to a second timer in the
 * run manager.
 *
 * This is the constant that makes `automation soft timeout < automation hard
 * abort` true by construction rather than by hoping two independently chosen
 * numbers happen to be ordered — they were not: the shipped build gave the
 * automation path a 13-minute soft timeout under a 10-minute hard abort, so
 * the recoverable boundary was dead code and the only boundary an automation
 * could reach was the terminal one.
 */
export const BACKGROUND_AUTOMATION_SOFT_TIMEOUT_HEADROOM_MS = 20_000;

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
 * Slack between the CHAIN bound (`agent.maxBackgroundRunContinuations`) and the
 * per-turn LEDGER bound below.
 *
 * They count different things. The chain bound counts handoffs a chunk decided
 * to make; the ledger counts every run ROW the turn produced, which also
 * includes sweep redispatches and stale-run recoveries no chunk ever decided.
 * Without slack the ledger would refuse a turn before the chain bound it is
 * meant to sit above, so a turn recovered once would die holding unused chain
 * budget.
 */
/**
 * Shipped run-lifecycle bounds.
 *
 * They live beside the relationships that constrain them so a change to one is
 * checked against the others in the same file. `run-manager.ts` and
 * `production-agent.ts` re-export them under their historical names; this
 * module imports no agent code, so nothing here can become circular.
 */
/**
 * Hard ceiling for the soft timeout when a run executes inside a Netlify
 * background function (any deployed function whose name ends in `-background`).
 * Background functions return 202 immediately and run detached for up to 15
 * minutes, so the ~60s synchronous function wall that 40s defends against does
 * NOT apply. 13 minutes leaves ~2 min of headroom under Netlify's 15-min hard
 * kill to abort, persist the partial turn, write the terminal event, and (for
 * the rare >13-min turn) self-fire another background continuation.
 *
 * This ceiling is used ONLY when a caller explicitly opts in with
 * `backgroundFunction: true`. It does not change the foreground/interactive
 * ceiling and does not fire unless the durable-background path dispatched the
 * run into a background function. Per the design doc Guardrail, the 40s
 * interactive clamp stays correct for every non-background run.
 */
export const BACKGROUND_SOFT_TIMEOUT_CEILING_MS = 13 * 60_000;

/**
 * AUTHORITATIVE no-progress backstop for a run, enforced by the run manager
 * itself (timer-driven, independent of any layer below).
 *
 * The finer-grained watchdogs inside the agent loop (model-stream and
 * action-preparation no-progress, both 90s) only guard the model event stream
 * — a stall in any segment OUTSIDE that guarded loop (engine-call
 * establishment, worker setup between continuation chunks, a wedged transport
 * that emits keepalives while the loop never runs) previously hung forever
 * with the client watching keepalives. This backstop covers every segment by
 * construction: if no REAL progress event (see `shouldBumpProgressForEvent`;
 * keepalives and zero-byte prep activity don't count) lands for this long —
 * and no unit of work is in flight (see `inFlightWorkDelta`: tool calls,
 * cross-app calls, and the model stream all legitimately emit nothing for
 * minutes and each carry a bound of their own) — the run manager emits
 * `auto_continue { reason: "no_progress" }` and aborts the chunk, exactly
 * like the soft timeout, so the normal continuation machinery recovers it.
 *
 * Being numerically larger than the in-loop watchdogs is NOT what keeps this
 * from killing a healthy run, and treating it that way is what made it do so:
 * this clock and the loop's `lastModelStreamProgressAt` measure DIFFERENT
 * events. An extended-thinking phase bumps the inner clock on every engine
 * frame while forwarding nothing, so the inner watchdog correctly stayed quiet
 * and this one saw pure silence — runs whose worst gap crossed 150s died while
 * still streaming, some by a single second. Ordering between two clocks only
 * means something when they watch the same events; suspending on in-flight
 * work is what actually makes the two agree.
 *
 * This is now only the CEILING, not the value: `resolveRunNoProgressTimeoutMs`
 * clamps the foreground backstop to a fraction of the chunk's soft timeout
 * (~30s at a 40s chunk), which is BELOW the 90s in-loop watchdogs rather than
 * above them. That ordering is deliberate — the in-loop watchdogs could never
 * fire inside a hosted foreground chunk anyway, since the serverless wall
 * (~57-59s) arrives first. Proven durable-background chunks keep the full
 * `DEFAULT_BACKGROUND_NO_PROGRESS_TIMEOUT_MS` so large outputs can use the
 * background budget. Only armed when a soft-timeout regime is active (hosted
 * runs); local dev stays unbounded.
 */
export const RUN_NO_PROGRESS_HARD_TIMEOUT_MS = 150_000;

/**
 * THE IN-LOOP NO-PROGRESS WATCHDOGS ARE GONE, and their absence is the design.
 *
 * Two 90s bounds used to live here — one on silence between engine frames,
 * one on a tool input whose byte count stopped growing. Both inferred a dead
 * stream from the absence of a particular event, and on the Anthropic
 * transport that inference cannot be made: the SDK drops the provider's `ping`
 * keepalives before any consumer sees them (`core/streaming.js`), so a model
 * composing a large tool argument is indistinguishable from a wedged socket.
 * Only a tool declared for eager input streaming emits anything at all while
 * its arguments are generated, so the silent case is ORDINARY, not
 * exceptional.
 *
 * They were added to make runs more reliable and did the opposite: of 27
 * one-shot analyst runs in production, 2 completed. Deleting them leaves the
 * bounds that key off evidence rather than absence — the engine's own
 * first-event abort, the run-manager backstop outside the stream, the per-tool
 * execution timeout, the chunk budget, and the stale reaper. Reintroducing a
 * clock here needs a liveness signal this process can actually observe.
 */

/**
 * Consecutive chunks allowed to end on the SAME terminal error code having
 * produced nothing before the chain stops.
 *
 * Two, because two independent recovery layers multiply here and neither can
 * see the other: the engine already retried this identical request 3x with
 * backoff before the error was ever emitted, and a recoverable error is also a
 * continuation boundary, so every chunk that fails costs 4 gateway attempts
 * and dispatches a fresh one. A production turn spent 27 background runs and
 * 15 minutes on one message this way. The first repeat is the retry this path
 * exists for; a second identical failure that moved nothing is evidence the
 * retrying itself is what is broken, not the request.
 */
export const MAX_CONSECUTIVE_NO_PROGRESS_CONTINUATIONS = 2;

/**
 * Wall-clock ceiling on a single logical turn. The run-count ledger alone is
 * not a time bound: in durable mode each of the ~25 permitted chunks may burn
 * ~780s, so the ledger's real worst case is over five hours (production has an
 * observed 2h34m turn). Nobody is waiting that long, and every minute past
 * this point is spend on a request the user has abandoned.
 */
export const MAX_TURN_WALL_CLOCK_MS = 90 * 60_000;

/**
 * Cap on continuation iterations inside a single
 * `runAgentLoopDirectWithSoftTimeout` invocation. The host's hard function
 * timeout usually bounds this naturally — but a defensive cap prevents an
 * instant-error spiral from looping forever inside hosting environments with a
 * generous budget.
 *
 * 6 leaves room for: 1 normal completion + a few resume rounds for design
 * generation (prompt + 3 variants ≈ 4 LLM calls), with a small safety margin.
 */
export const MAX_RUN_LOOP_CONTINUATIONS = 6;

/**
 * A delegated turn that is proven to be running inside a durable background
 * function has the same 15-minute host budget as main chat, but this wrapper
 * historically kept the foreground-sized six-continuation cap. A healthy
 * child A2A call can consume several minutes and the receiving model may then
 * need more than six recovery/model-stream boundaries to finish its own tool
 * work. Keep a hard cap, but give the proven background path the same bounded
 * continuation allowance as the durable main-chat runner. The cumulative
 * soft-timeout below still prevents these rounds from exceeding the one real
 * background-function wall-clock budget.
 */
export const MAX_BACKGROUND_RUN_LOOP_CONTINUATIONS = 20;

export const TURN_RUN_LEDGER_SLACK = 5;

/**
 * Hard cap on server-driven background→background continuation chunks for a
 * single logical turn. A `backgroundFunction` run gets a ~13-min soft timeout,
 * so reaching this boundary at all is the rare exception (most turns finish in
 * one chunk). The cap bounds a pathological turn that would otherwise chain
 * background invocations forever, mirroring `MAX_AGENT_TEAM_CONTINUATIONS`.
 */
export const MAX_BACKGROUND_RUN_CONTINUATIONS = 20;

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
export const MAX_FOLLOWED_BACKGROUND_RUNS = 30;
export const MAX_BACKGROUND_FOLLOW_WALL_TIME_MS = 110 * 60_000;

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
  // Only two of these are configuration. The rest are the shipped constants,
  // read here rather than duplicated as config defaults — a number with two
  // homes needs a test to keep them in step, and that test is the tell that it
  // should have had one home to begin with. A deployment that wants to move a
  // bound it cannot currently reach should get a field added deliberately, with
  // the relationship below extended to cover it.
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

  // A disabled backstop (0) has no ordering to satisfy — it never fires.
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
    // EFFECTIVE, not nominal: the ceiling is checked at chunk boundaries, so a
    // turn passing the check one chunk short of it still gets a whole further
    // chunk. Comparing the configured number alone hid a real inversion in the
    // shipped values — 90min + a 13min chunk against a client that stopped
    // following at 95min.
    key: "agent.maxTurnWallClockMs + agent.backgroundSoftTimeoutCeilingMs",
    value: maxTurnWallClockMs + backgroundSoftTimeoutCeilingMs,
  }, {
    key: "MAX_BACKGROUND_FOLLOW_WALL_TIME_MS",
    value: MAX_BACKGROUND_FOLLOW_WALL_TIME_MS,
  }, "the server must end the turn first, because it is the side that can tell progress from a loop and write a truthful terminal reason");

  require("server chain bound below the client's follow-run budget", {
    // EFFECTIVE, not nominal: the durable ledger allows the chain bound PLUS
    // the recovery slack in run ROWS, and the client counts rows. 20 + 5 = 25
    // against a client that stopped at 24 — the same inversion, hidden the
    // same way.
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
