import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
test("the integrate lane includes failure, settings and request guards and keeps the full audit available", () => {
  const selected = execFileSync(
    process.execPath,
    ["--import", "tsx", "scripts/run-guards.ts", "--diff", "--list"],
    { cwd: root, encoding: "utf8" },
  );
  for (const name of [
    "no-silent-coercion",
    "dead-settings-keys",
    "request-storms",
    "no-unobserved-writes",
  ])
    assert.match(selected, new RegExp(`guard:${name}\\n`));
  const full = execFileSync(
    process.execPath,
    ["--import", "tsx", "scripts/run-guards.ts", "--list"],
    { cwd: root, encoding: "utf8" },
  );
  assert.ok(full.split("\n").length > selected.split("\n").length);
  assert.match(full, /guard:agent-native-brand/);
});

test("diff-scoped settings fail on a newly dead key and do not conflate the historical backlog with new declarations", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "settings-diff-"));
  try {
    mkdirSync(path.join(directory, "scripts/lib"), { recursive: true });
    for (const file of [
      "scripts/guard-dead-settings-keys.mjs",
      "scripts/lib/changed-lines.mjs",
    ])
      copyFileSync(path.join(root, file), path.join(directory, file));
    mkdirSync(path.join(directory, "templates/example/shared"), {
      recursive: true,
    });
    writeFileSync(path.join(directory, "templates/example/package.json"), "{}");
    const prefs = path.join(
      directory,
      "templates/example/shared/example-prefs.ts",
    );
    writeFileSync(
      prefs,
      "type Unrelated = {\n  newDead: boolean;\n};\nexport type Prefs = {\n  oldDead: boolean;\n  activeSetting: boolean;\n};\n",
    );
    const reader = path.join(directory, "templates/example/consumer.ts");
    writeFileSync(
      reader,
      "export const read = (prefs: { activeSetting: boolean }) => prefs.activeSetting;\n",
    );
    const git = (args: string[]) =>
      execFileSync("git", args, {
        cwd: directory,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    git(["init"]);
    git(["add", "."]);
    git([
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "base",
    ]);
    const base = git(["rev-parse", "HEAD"]);
    const run = (ref: string) =>
      spawnSync(
        process.execPath,
        ["scripts/guard-dead-settings-keys.mjs", "--diff"],
        {
          cwd: directory,
          encoding: "utf8",
          env: { ...process.env, GUARD_DIFF_BASE: ref },
        },
      );
    assert.equal(run(base).status, 0);
    writeFileSync(
      prefs,
      "type Unrelated = {\n  newDead: boolean;\n};\nexport type Prefs = {\n  oldDead: boolean;\n  activeSetting: boolean;\n  newDead: boolean;\n};\n",
    );
    const red = run(base);
    assert.equal(red.status, 1);
    assert.match(red.stderr, /newDead/);
    assert.doesNotMatch(red.stderr, /oldDead/);
    writeFileSync(
      prefs,
      "type Unrelated = {\n  newDead: boolean;\n};\nexport type Prefs = {\n  oldDead: boolean;\n  activeSetting: boolean;\n};\n",
    );
    rmSync(reader);
    const removed = run(base);
    assert.equal(removed.status, 1);
    assert.match(removed.stderr, /activeSetting/);
    assert.doesNotMatch(removed.stderr, /oldDead/);
    const missing = run("1".repeat(40));
    assert.equal(missing.status, 2);
    assert.match(
      missing.stderr,
      /guard-dead-settings-keys: could not determine/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
