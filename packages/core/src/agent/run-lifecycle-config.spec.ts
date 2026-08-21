import { afterEach, describe, expect, it } from "vitest";

import {
  defineAppConfig,
  getAppConfig,
  resetAppConfigForTests,
} from "../app-config/index.js";
import {
  BACKGROUND_AUTOMATION_SOFT_TIMEOUT_HEADROOM_MS,
  MAX_BACKGROUND_FOLLOW_WALL_TIME_MS,
  MAX_FOLLOWED_BACKGROUND_RUNS,
  BACKGROUND_FUNCTION_WALL_HEADROOM_MS,
  BACKGROUND_FUNCTION_WALL_MS,
  RunLifecycleInvariantError,
  assertRunLifecycleInvariants,
} from "../app-config/run-lifecycle-invariants.js";
import { BACKGROUND_RUN_HARD_TIMEOUT_MS } from "../jobs/background-automation-runner.js";
import {
  ACTION_PREPARATION_NO_PROGRESS_TIMEOUT_MS,
  MAX_BACKGROUND_RUN_CONTINUATIONS,
  MAX_CONSECUTIVE_NO_PROGRESS_CONTINUATIONS,
  MAX_TURN_WALL_CLOCK_MS,
  MODEL_STREAM_NO_PROGRESS_TIMEOUT_MS,
} from "./production-agent.js";
import {
  MAX_BACKGROUND_RUN_LOOP_CONTINUATIONS,
  MAX_RUN_LOOP_CONTINUATIONS,
} from "./run-loop-with-resume.js";
import {
  BACKGROUND_SOFT_TIMEOUT_CEILING_MS,
  DEFAULT_BACKGROUND_NO_PROGRESS_TIMEOUT_MS,
  RUN_NO_PROGRESS_HARD_TIMEOUT_MS,
  resolveActionPreparationNoProgressTimeoutMs,
  resolveBackgroundAutomationSoftTimeoutMs,
  resolveBackgroundRunHardTimeoutMs,
  resolveBackgroundSoftTimeoutCeilingMs,
  resolveMaxBackgroundRunContinuations,
  resolveMaxBackgroundRunLoopContinuations,
  resolveMaxConsecutiveNoProgressContinuations,
  resolveMaxRunLoopContinuations,
  resolveMaxTurnWallClockMs,
  resolveModelStreamNoProgressTimeoutMs,
  resolveRunNoProgressTimeoutMs,
  resolveRunSoftTimeoutMs,
} from "./run-manager.js";
import {
  TURN_RUN_LEDGER_SLACK,
  resolveTurnRunLedgerBudget,
  turnRunLedgerExhausted,
} from "./run-store.js";

afterEach(() => {
  resetAppConfigForTests();
});

describe("run-lifecycle configuration", () => {
  // Task 3.1 ships as a pure refactor: a deployment that configures nothing
  // must see the numbers that shipped. The historical constants are the
  // reference, so a default edited on one side alone fails here rather than
  // changing behaviour for everyone silently.
  it("declares the shipped constants as its defaults", () => {
    expect(resolveRunNoProgressTimeoutMs({ softTimeoutMs: 0 })).toBe(0);
    const agent = getAppConfig().agent;
    expect(agent.runNoProgressTimeoutMs).toBe(RUN_NO_PROGRESS_HARD_TIMEOUT_MS);
    expect(agent.backgroundNoProgressTimeoutMs).toBe(
      DEFAULT_BACKGROUND_NO_PROGRESS_TIMEOUT_MS,
    );
    expect(resolveBackgroundSoftTimeoutCeilingMs()).toBe(
      BACKGROUND_SOFT_TIMEOUT_CEILING_MS,
    );
    expect(resolveBackgroundRunHardTimeoutMs()).toBe(
      BACKGROUND_RUN_HARD_TIMEOUT_MS,
    );
    expect(resolveModelStreamNoProgressTimeoutMs()).toBe(
      MODEL_STREAM_NO_PROGRESS_TIMEOUT_MS,
    );
    expect(resolveActionPreparationNoProgressTimeoutMs()).toBe(
      ACTION_PREPARATION_NO_PROGRESS_TIMEOUT_MS,
    );
    expect(resolveMaxRunLoopContinuations()).toBe(MAX_RUN_LOOP_CONTINUATIONS);
    expect(resolveMaxBackgroundRunLoopContinuations()).toBe(
      MAX_BACKGROUND_RUN_LOOP_CONTINUATIONS,
    );
    expect(resolveMaxBackgroundRunContinuations()).toBe(
      MAX_BACKGROUND_RUN_CONTINUATIONS,
    );
    expect(resolveMaxConsecutiveNoProgressContinuations()).toBe(
      MAX_CONSECUTIVE_NO_PROGRESS_CONTINUATIONS,
    );
    expect(resolveMaxTurnWallClockMs()).toBe(MAX_TURN_WALL_CLOCK_MS);
  });

  it("lets a deployment tune the background backstop without touching the foreground one", () => {
    defineAppConfig({ agent: { backgroundNoProgressTimeoutMs: 300_000 } });
    expect(
      resolveRunNoProgressTimeoutMs({
        softTimeoutMs: BACKGROUND_SOFT_TIMEOUT_CEILING_MS,
        backgroundFunction: true,
      }),
    ).toBe(300_000);
    // Foreground stays clamped to its fraction of the chunk budget.
    expect(resolveRunNoProgressTimeoutMs({ softTimeoutMs: 40_000 })).toBe(
      30_000,
    );
  });

  // A deployment lowering the GLOBAL soft timeout used to shrink the chunk
  // without shrinking the background backstop, so the backstop stopped being
  // reachable inside the chunk it guards — silently, with nothing asserting it.
  it("keeps the background backstop inside a chunk shrunk by global configuration", () => {
    defineAppConfig({ agent: { runSoftTimeoutMs: 20_000 } });
    const soft = resolveRunSoftTimeoutMs(undefined, {
      useHostedDefault: true,
      backgroundFunction: true,
    });
    const backstop = resolveRunNoProgressTimeoutMs({
      softTimeoutMs: soft,
      backgroundFunction: true,
    });
    expect(soft).toBe(20_000);
    expect(backstop).toBeLessThan(soft);
  });

  it("keeps a per-call override above configuration", () => {
    defineAppConfig({ agent: { backgroundNoProgressTimeoutMs: 300_000 } });
    expect(
      resolveRunNoProgressTimeoutMs({
        softTimeoutMs: BACKGROUND_SOFT_TIMEOUT_CEILING_MS,
        backgroundFunction: true,
        backgroundOverrideMs: 0,
      }),
    ).toBe(0);
  });

  it("derives the automation chunk budget from the automation's own hard abort", () => {
    // The pair that shipped violated: a 13-minute chunk budget under a
    // 10-minute hard abort, so the recoverable boundary was unreachable.
    expect(BACKGROUND_SOFT_TIMEOUT_CEILING_MS).toBeGreaterThan(
      BACKGROUND_RUN_HARD_TIMEOUT_MS,
    );
    const budget = resolveBackgroundAutomationSoftTimeoutMs();
    // Local dev has no soft-timeout regime at all; hosted derives from the
    // hard abort. Either way it can never exceed the hard abort.
    expect(budget).toBeLessThan(BACKGROUND_RUN_HARD_TIMEOUT_MS);
  });

  // The chain guard and stale-run recovery used to hold this number twice, kept
  // in step by a comment asking the next editor to remember. One resolver now,
  // and this test is what makes a drift a failure rather than a surprise.
  it("gives the chain guard and stale-run recovery one turn-run budget", () => {
    expect(resolveTurnRunLedgerBudget()).toBe(
      resolveMaxBackgroundRunContinuations() + TURN_RUN_LEDGER_SLACK,
    );
    // The ledger counts run ROWS — chain handoffs plus sweep redispatches and
    // recoveries — so it must sit strictly above the chain bound.
    expect(resolveTurnRunLedgerBudget()).toBeGreaterThan(
      resolveMaxBackgroundRunContinuations(),
    );
  });

  // Both call sites had `turnRunCount > budget` while the current run's row was
  // already counted and the successor's row is inserted after the check, so at
  // equality they allowed one row past the documented ceiling.
  it("refuses the run that would take the turn past its ceiling, not one after", () => {
    const budget = resolveTurnRunLedgerBudget();
    expect(turnRunLedgerExhausted(budget - 1)).toBe(false);
    expect(turnRunLedgerExhausted(budget)).toBe(true);
    expect(turnRunLedgerExhausted(budget + 1)).toBe(true);
  });

  it("moves the turn-run budget with the configured chain bound", () => {
    defineAppConfig({ agent: { maxBackgroundRunContinuations: 8 } });
    expect(resolveTurnRunLedgerBudget()).toBe(8 + TURN_RUN_LEDGER_SLACK);
  });

  it("clamps the derived automation budget when the hard abort is lowered", () => {
    defineAppConfig({ agent: { backgroundRunHardTimeoutMs: 5 * 60_000 } });
    expect(resolveBackgroundAutomationSoftTimeoutMs(9 * 60_000)).toBe(
      5 * 60_000 - BACKGROUND_AUTOMATION_SOFT_TIMEOUT_HEADROOM_MS,
    );
  });
});

describe("run-lifecycle invariants", () => {
  const base = () => ({ ...getAppConfig().agent });

  it("passes on the shipped defaults", () => {
    expect(() => assertRunLifecycleInvariants(base())).not.toThrow();
  });

  it("rejects a backstop that outlives the chunk budget it is meant to fire inside", () => {
    expect(() =>
      assertRunLifecycleInvariants({
        ...base(),
        backgroundNoProgressTimeoutMs: 20 * 60_000,
      }),
    ).toThrow(RunLifecycleInvariantError);
  });

  it("names both constants and the relationship it broke", () => {
    let message = "";
    try {
      assertRunLifecycleInvariants({
        ...base(),
        modelStreamNoProgressTimeoutMs: 200_000,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("agent.modelStreamNoProgressTimeoutMs");
    expect(message).toContain("agent.backgroundNoProgressTimeoutMs");
    expect(message).toContain("must be less than");
  });

  it("rejects a hard abort with no room for a graceful boundary", () => {
    expect(() =>
      assertRunLifecycleInvariants({
        ...base(),
        backgroundRunHardTimeoutMs:
          BACKGROUND_AUTOMATION_SOFT_TIMEOUT_HEADROOM_MS,
      }),
    ).toThrow(RunLifecycleInvariantError);
  });

  it("fails configuration resolution, not the first run that trips the window", () => {
    resetAppConfigForTests();
    expect(() =>
      defineAppConfig({ agent: { maxTurnWallClockMs: 60_000 } }),
    ).not.toThrow();
    // Set-time validation is per layer; the ordering check runs on the merged
    // result, which is what `getAppConfig()` resolves.
    expect(() => getAppConfig()).toThrow(RunLifecycleInvariantError);
  });

  // `backgroundSoftTimeoutCeilingMs` is not just a bound, it IS the clamp
  // `resolveRunSoftTimeoutMs` reduces every background soft timeout to. Making
  // it configurable without this check would have left the one number that
  // keeps a chunk inside the host wall unbounded.
  it("refuses a background ceiling that would outlive the host's function wall", () => {
    expect(() =>
      assertRunLifecycleInvariants({
        ...base(),
        backgroundSoftTimeoutCeilingMs: 20 * 60_000,
      }),
    ).toThrow(RunLifecycleInvariantError);
  });

  it("allows the shipped ceiling, which sits exactly on the headroom margin", () => {
    expect(BACKGROUND_SOFT_TIMEOUT_CEILING_MS).toBe(
      BACKGROUND_FUNCTION_WALL_MS - BACKGROUND_FUNCTION_WALL_HEADROOM_MS,
    );
    expect(() =>
      assertRunLifecycleInvariants({
        ...base(),
        backgroundSoftTimeoutCeilingMs: BACKGROUND_SOFT_TIMEOUT_CEILING_MS,
      }),
    ).not.toThrow();
  });

  // These three used to be pinned only in `agent-chat-adapter.spec.ts`, against
  // the server's module constants. Making those configurable moved the real
  // values out from under that test without moving the test — a deployment
  // could raise any of them past what the shipped client follows and every
  // check still passed. The client bound is static in the bundle; the server
  // bound is not; so the check has to run where the server bound resolves.
  it("refuses a turn ceiling the shipped client would abandon first", () => {
    expect(() =>
      assertRunLifecycleInvariants({
        ...base(),
        maxTurnWallClockMs: MAX_BACKGROUND_FOLLOW_WALL_TIME_MS + 60_000,
      }),
    ).toThrow(RunLifecycleInvariantError);
  });

  it("refuses a chain bound the shipped client would stop following", () => {
    expect(() =>
      assertRunLifecycleInvariants({
        ...base(),
        maxBackgroundRunContinuations: MAX_FOLLOWED_BACKGROUND_RUNS,
      }),
    ).toThrow(RunLifecycleInvariantError);
  });

  it("refuses a chunk budget that leaves no room for a second chunk", () => {
    // The exact inversion that shipped: one legal chunk longer than half the
    // client's whole-turn budget means a turn needing two chunks dies mid-stream
    // while the server is healthy.
    expect(() =>
      assertRunLifecycleInvariants({
        ...base(),
        backgroundSoftTimeoutCeilingMs: Math.floor(
          MAX_BACKGROUND_FOLLOW_WALL_TIME_MS / 2,
        ),
      }),
    ).toThrow(RunLifecycleInvariantError);
  });

  it("skips ordering checks for a disabled backstop", () => {
    expect(() =>
      assertRunLifecycleInvariants({
        ...base(),
        backgroundNoProgressTimeoutMs: 0,
      }),
    ).not.toThrow();
  });
});
