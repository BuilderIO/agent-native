/**
 * How a guard run reports itself.
 *
 * The runner used to have two states for three outcomes: exit 0 meant PASS and
 * anything else meant FAIL, so a guard that could not scope itself (no
 * origin/main, shallow clone) exited 0 and `pnpm guards` printed "All checks
 * passed" over checks that had inspected zero lines. That is the same shape
 * CLAUDE.md's flagship rule bans — a failure coerced into a value callers
 * cannot tell apart from success — living in the scripts that enforce it.
 */

import { GUARD_EXIT_COULD_NOT_RUN } from "./changed-lines.mjs";

export type GuardStatus = "PASS" | "FAIL" | "SKIPPED";

export interface GuardOutcome {
  name: string;
  code: number | null;
  signal: NodeJS.Signals | null;
}

export function resultStatus(result: GuardOutcome): GuardStatus {
  if (result.signal) return "FAIL";
  if (result.code === 0) return "PASS";
  if (result.code === GUARD_EXIT_COULD_NOT_RUN) return "SKIPPED";
  return "FAIL";
}

export function summarizeGuardRun(
  results: readonly GuardOutcome[],
  { strictSkips }: { strictSkips: boolean },
): { exitCode: number; message: string } {
  const withStatus = (status: GuardStatus) =>
    results.filter((result) => resultStatus(result) === status);
  const failed = withStatus("FAIL");
  const skipped = withStatus("SKIPPED");
  const names = (subset: readonly GuardOutcome[]) =>
    subset.map((result) => result.name).join(", ");

  if (failed.length > 0) {
    return {
      exitCode: 1,
      message: `[guards] ${failed.length} check(s) failed: ${names(failed)}`,
    };
  }

  if (skipped.length > 0) {
    const detail = `${skipped.length} check(s) could not run: ${names(skipped)}`;
    if (strictSkips) {
      return {
        exitCode: 1,
        message:
          `[guards] ${detail}\n` +
          "[guards] Refusing to report a pass. Fetch the base ref " +
          "(git fetch origin main) or set GUARD_DIFF_BASE, then re-run. " +
          "Set GUARD_ALLOW_SKIPS=1 to downgrade to a warning.",
      };
    }
    return {
      exitCode: 0,
      message: `[guards] ${results.length - skipped.length} check(s) passed, ${detail}`,
    };
  }

  return {
    exitCode: 0,
    message: `[guards] All ${results.length} checks passed`,
  };
}
