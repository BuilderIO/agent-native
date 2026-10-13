import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

for (const profile of ["test", "typecheck"]) {
  test(`GitHub Actions ${profile} excludes the workspace root`, () => {
    const dryRun = spawnSync(
      "pnpm",
      ["exec", "tsx", "scripts/workspace-run.ts", profile, "--dry-run"],
      {
        encoding: "utf8",
        env: { ...process.env, GITHUB_ACTIONS: "true" },
      },
    );
    assert.equal(dryRun.status, 0, dryRun.stderr);

    const filters = Array.from(
      dryRun.stdout.matchAll(/--filter\s+"?([^"\s]+)"?/gu),
      (match) => match[1]!,
    );
    const selected = spawnSync(
      "pnpm",
      [
        "-r",
        ...filters.flatMap((filter) => ["--filter", filter]),
        "list",
        "--depth",
        "-1",
      ],
      { encoding: "utf8" },
    );

    assert.equal(selected.status, 0, selected.stderr);
    assert.doesNotMatch(selected.stdout, /^agentnative@/mu);
  });
}
