import { afterEach, describe, expect, it } from "vitest";

import {
  defineAppConfig,
  getAppConfig,
  resetAppConfigForTests,
} from "../app-config/index.js";
import {
  assertRunLifecycleInvariants,
  BACKGROUND_AUTOMATION_SOFT_TIMEOUT_HEADROOM_MS,
  BACKGROUND_FUNCTION_WALL_HEADROOM_MS,
  BACKGROUND_FUNCTION_WALL_MS,
  BACKGROUND_SOFT_TIMEOUT_CEILING_MS,
  MAX_BACKGROUND_FOLLOW_WALL_TIME_MS,
  MAX_BACKGROUND_RUN_CONTINUATIONS,
  MAX_FOLLOWED_BACKGROUND_RUNS,
  MAX_TURN_WALL_CLOCK_MS,
  RunLifecycleInvariantError,
  TURN_RUN_LEDGER_SLACK,
} from "../app-config/run-lifecycle-invariants.js";
import { BACKGROUND_RUN_HARD_TIMEOUT_MS } from "../jobs/background-automation-runner.js";
import {
  resolveBackgroundAutomationSoftTimeoutMs,
  resolveBackgroundRunHardTimeoutMs,
  resolveRunNoProgressTimeoutMs,
  resolveRunSoftTimeoutMs,
} from "./run-manager.js";
import {
  resolveTurnRunLedgerBudget,
  turnRunLedgerExhausted,
} from "./run-store.js";

afterEach(() => {
  resetAppConfigForTests();
});

// Only two run-lifecycle bounds are configuration, because only two are facts
// about the host or the deployment rather than relationships this package owns.
// The rest are constants with one home — which is why there is no parity test
// here any more. There is nothing left to keep in step.
describe("configurable run-lifecycle bounds", () => {
  it("exposes the two a deployment has a real reason to change", () => {
    expect(resolveBackgroundRunHardTimeoutMs()).toBe(
      BACKGROUND_RUN_HARD_TIMEOUT_MS,
    );
    defineAppConfig({ agent: { backgroundRunHardTimeoutMs: 5 * 60_000 } });
    expect(resolveBackgroundRunHardTimeoutMs()).toBe(5 * 60_000);
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

  it("derives the automation chunk budget from the automation's own hard abort", () => {
    // The pair that shipped violated: a 13-minute chunk budget under a
    // 10-minute hard abort, so the recoverable boundary was unreachable.
    expect(BACKGROUND_SOFT_TIMEOUT_CEILING_MS).toBeGreaterThan(
      BACKGROUND_RUN_HARD_TIMEOUT_MS,
    );
    expect(resolveBackgroundAutomationSoftTimeoutMs()).toBeLessThan(
      BACKGROUND_RUN_HARD_TIMEOUT_MS,
    );
  });

  it("clamps the derived automation budget when the hard abort is lowered", () => {
    defineAppConfig({ agent: { backgroundRunHardTimeoutMs: 5 * 60_000 } });
    expect(resolveBackgroundAutomationSoftTimeoutMs(9 * 60_000)).toBe(
      5 * 60_000 - BACKGROUND_AUTOMATION_SOFT_TIMEOUT_HEADROOM_MS,
    );
  });

  // Both call sites had `turnRunCount > budget` while the current run's row was
  // already counted and the successor's row is inserted after the check, so at
  // equality they allowed one row past the documented ceiling.
  it("refuses the run that would take the turn past its ceiling, not one after", () => {
    const budget = resolveTurnRunLedgerBudget();
    expect(budget).toBe(
      MAX_BACKGROUND_RUN_CONTINUATIONS + TURN_RUN_LEDGER_SLACK,
    );
    expect(turnRunLedgerExhausted(budget - 1)).toBe(false);
    expect(turnRunLedgerExhausted(budget)).toBe(true);
  });
});

describe("run-lifecycle invariants", () => {
  const base = () => ({ ...getAppConfig().agent });

  // With one home per number these relationships can no longer be broken by a
  // deployment — only by someone editing a constant. So this is the test that
  // catches that edit, at CI time rather than at deploy time.
  it("holds on the shipped values", () => {
    expect(() => assertRunLifecycleInvariants(base())).not.toThrow();
  });

  it("keeps the shipped background ceiling exactly on the host wall's margin", () => {
    expect(BACKGROUND_SOFT_TIMEOUT_CEILING_MS).toBe(
      BACKGROUND_FUNCTION_WALL_MS - BACKGROUND_FUNCTION_WALL_HEADROOM_MS,
    );
  });

  // CLIENT-ABOVE-SERVER, measured against the EFFECTIVE limits. Comparing the
  // nominal ones hid two real inversions: the turn ceiling is tested at chunk
  // boundaries, so a turn passing it one chunk short still gets a whole further
  // chunk; and the durable ledger allows the chain bound PLUS the recovery
  // slack in run rows, which is what the client counts.
  it("leaves the client following past the server's effective limits", () => {
    expect(
      MAX_TURN_WALL_CLOCK_MS + BACKGROUND_SOFT_TIMEOUT_CEILING_MS,
    ).toBeLessThan(MAX_BACKGROUND_FOLLOW_WALL_TIME_MS);
    expect(
      MAX_BACKGROUND_RUN_CONTINUATIONS + TURN_RUN_LEDGER_SLACK,
    ).toBeLessThan(MAX_FOLLOWED_BACKGROUND_RUNS);
    expect(BACKGROUND_SOFT_TIMEOUT_CEILING_MS * 2).toBeLessThan(
      MAX_BACKGROUND_FOLLOW_WALL_TIME_MS,
    );
  });

  // The two configurable bounds are the ones a deploy can still get wrong, so
  // they are the ones the runtime check still has to cover.
  it("refuses a background backstop that outlives the chunk it guards", () => {
    expect(() =>
      assertRunLifecycleInvariants({
        ...base(),
        backgroundNoProgressTimeoutMs: 20 * 60_000,
      }),
    ).toThrow(RunLifecycleInvariantError);
  });

  it("refuses a hard abort with no room for a graceful boundary", () => {
    expect(() =>
      assertRunLifecycleInvariants({
        ...base(),
        backgroundRunHardTimeoutMs:
          BACKGROUND_AUTOMATION_SOFT_TIMEOUT_HEADROOM_MS,
      }),
    ).toThrow(RunLifecycleInvariantError);
  });

  it("names both bounds and the relationship it broke", () => {
    let message = "";
    try {
      assertRunLifecycleInvariants({
        ...base(),
        backgroundNoProgressTimeoutMs: 20 * 60_000,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("agent.backgroundNoProgressTimeoutMs");
    expect(message).toContain("must be less than");
  });

  it("fails configuration resolution, not the first run that trips the window", () => {
    resetAppConfigForTests();
    expect(() =>
      defineAppConfig({
        agent: { backgroundNoProgressTimeoutMs: 20 * 60_000 },
      }),
    ).not.toThrow();
    // Set-time validation is per layer; the ordering check runs on the merged
    // result, which is what `getAppConfig()` resolves.
    expect(() => getAppConfig()).toThrow(RunLifecycleInvariantError);
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
