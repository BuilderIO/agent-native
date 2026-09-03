import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { GUARD_EXIT_COULD_NOT_RUN } from "./changed-lines.mjs";
import { resultStatus, summarizeGuardRun } from "./guard-run-summary";

const outcome = (
  name: string,
  code: number | null,
  signal: NodeJS.Signals | null = null,
) => ({ name, code, signal });

describe("resultStatus", () => {
  it("separates could-not-run from pass and fail", () => {
    expect(resultStatus(outcome("a", 0))).toBe("PASS");
    expect(resultStatus(outcome("b", 1))).toBe("FAIL");
    expect(resultStatus(outcome("c", GUARD_EXIT_COULD_NOT_RUN))).toBe(
      "SKIPPED",
    );
    expect(resultStatus(outcome("d", null, "SIGKILL"))).toBe("FAIL");
  });

  it("reports truncated guard output as could-not-run", () => {
    const helper = new URL("./changed-lines.mjs", import.meta.url).href;
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { execGuardCommand } from ${JSON.stringify(helper)}; execGuardCommand(process.execPath, ["-e", "process.stdout.write('x'.repeat(1024))"], { encoding: "utf8", maxBuffer: 16 });`,
      ],
      { encoding: "utf8" },
    );

    expect(child.status).toBe(GUARD_EXIT_COULD_NOT_RUN);
    expect(child.stderr).toContain("guard command could not run");
  });
});

describe("summarizeGuardRun", () => {
  const skip = outcome("guard:scoped", GUARD_EXIT_COULD_NOT_RUN);

  it("never reports a pass over a guard that could not run", () => {
    const summary = summarizeGuardRun([outcome("guard:ok", 0), skip], {
      strictSkips: false,
    });
    expect(summary.exitCode).toBe(0);
    expect(summary.message).not.toContain("All ");
    expect(summary.message).toContain("could not run: guard:scoped");
  });

  it("fails the run when skips are strict", () => {
    const summary = summarizeGuardRun([outcome("guard:ok", 0), skip], {
      strictSkips: true,
    });
    expect(summary.exitCode).toBe(1);
    expect(summary.message).toContain("Refusing to report a pass");
  });

  it("reports real failures ahead of skips", () => {
    const summary = summarizeGuardRun([outcome("guard:bad", 1), skip], {
      strictSkips: false,
    });
    expect(summary.exitCode).toBe(1);
    expect(summary.message).toContain("guard:bad");
    expect(summary.message).not.toContain("could not run");
  });

  it("passes only when every guard actually ran", () => {
    const summary = summarizeGuardRun(
      [outcome("guard:a", 0), outcome("guard:b", 0)],
      { strictSkips: true },
    );
    expect(summary).toEqual({
      exitCode: 0,
      message: "[guards] All 2 checks passed",
    });
  });
});
