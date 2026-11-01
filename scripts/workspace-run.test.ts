import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { pnpmCommand } from "./lib/pnpm-command.ts";

function runPnpm(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const pnpm = pnpmCommand(args);
  return spawnSync(pnpm.command, pnpm.args, {
    encoding: "utf8",
    env,
    shell: pnpm.shell,
  });
}

for (const profile of ["test", "typecheck"]) {
  test(`GitHub Actions ${profile} excludes the workspace root`, () => {
    const dryRun = runPnpm(
      ["exec", "tsx", "scripts/workspace-run.ts", profile, "--dry-run"],
      { ...process.env, GITHUB_ACTIONS: "true" },
    );
    assert.equal(dryRun.status, 0, dryRun.stderr);

    const filters = Array.from(
      dryRun.stdout.matchAll(/--filter\s+"?([^"\s]+)"?/gu),
      (match) => match[1]!,
    );
    const selected = runPnpm([
      "-r",
      ...filters.flatMap((filter) => ["--filter", filter]),
      "list",
      "--depth",
      "-1",
    ]);

    assert.equal(selected.status, 0, selected.stderr);
    assert.doesNotMatch(selected.stdout, /^agentnative@/mu);
  });
}
