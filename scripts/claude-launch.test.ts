import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.resolve(import.meta.dirname, "..");

function dryRun(...flags: string[]): { databaseUrl: string } {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/claude-launch.ts",
      "--dry-run",
      "--dir",
      "templates/design",
      ...flags,
      "--",
      "dev",
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as { databaseUrl: string };
}

describe("claude-launch", () => {
  it("keeps a named preview's database in .tmp across restarts", () => {
    const first = dryRun("--name", "Design Preview");
    assert.equal(
      first.databaseUrl,
      `pglite:${path.join(root, ".tmp", "claude-launch", "design-preview-pglite")}`,
    );
    assert.deepEqual(dryRun("--name", "Design Preview"), first);
  });

  it("gives --ephemeral runs a fresh scratch database it removes", () => {
    const first = dryRun("--ephemeral").databaseUrl;
    const second = dryRun("--ephemeral").databaseUrl;
    assert.notEqual(first, second);
    assert.ok(!first.includes(`${path.sep}.tmp${path.sep}claude-launch`));
    assert.ok(!existsSync(first.slice("pglite:".length)));
  });

  it("uses an explicit DATABASE_URL as given", () => {
    assert.equal(
      dryRun("--ephemeral", "--env", "DATABASE_URL=pglite:.tmp/mine")
        .databaseUrl,
      "pglite:.tmp/mine",
    );
  });
});
