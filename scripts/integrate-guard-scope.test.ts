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
await test("the integrate lane includes failure, settings and request guards and keeps the full audit available", () => {
  const selected = execFileSync(
    process.execPath,
    ["--import", "tsx", "scripts/run-guards.ts", "--diff", "--list"],
    { cwd: root, encoding: "utf8" },
  );
  for (const name of [
    "no-silent-coercion",
    "dead-settings-keys",
    "request-storms",
    "no-legacy-config",
    "e2e-harness",
    "new-prose-comments",
    "no-unobserved-writes",
    "no-new-mcp-parity-gaps",
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

await test("diff-scoped settings fail on a newly dead key and do not conflate the historical backlog with new declarations", () => {
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

await test("diff-scoped request storms detect removed exemptions without charging historical backlog", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "request-storm-diff-"));
  try {
    mkdirSync(path.join(directory, "scripts/lib"), { recursive: true });
    for (const file of [
      "scripts/guard-request-storms.ts",
      "scripts/lib/changed-lines.mjs",
    ])
      copyFileSync(path.join(root, file), path.join(directory, file));
    mkdirSync(path.join(directory, "templates/example"), { recursive: true });
    writeFileSync(path.join(directory, "package.json"), '{"type":"module"}');
    const source = path.join(directory, "templates/example/client.ts");
    const marker =
      "// request-storm-allow: a bounded user-triggered provider refresh";
    const waived = "const query = { refetchOnWindowFocus: true };";
    const historical = "const old = { refetchIntervalInBackground: true };";
    const secondMarker =
      "// request-storm-allow: a second bounded user-triggered refresh";
    const baseline = `${marker}\n${secondMarker}\n${waived}\n\n${historical}\n`;
    writeFileSync(source, baseline);
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
    const run = (ref = base) =>
      spawnSync(
        process.execPath,
        [
          "--import",
          path.join(root, "node_modules/tsx/dist/loader.mjs"),
          "scripts/guard-request-storms.ts",
          "--diff",
        ],
        {
          cwd: directory,
          encoding: "utf8",
          env: { ...process.env, GUARD_DIFF_BASE: ref },
        },
      );
    const unchanged = run();
    assert.equal(unchanged.status, 0, unchanged.stderr);
    for (const prefix of ["", "// added comment\n".repeat(8)]) {
      writeFileSync(source, `${prefix}${waived}\n\n${historical}\n`);
      const removed = run();
      assert.equal(removed.status, 1, removed.stderr);
      assert.match(removed.stderr, /focus-refetch/);
      assert.doesNotMatch(removed.stderr, /background-refetch/);
    }
    writeFileSync(
      source,
      `${marker}\n${"// inserted context\n".repeat(8)}${waived}\n\n${historical}\n`,
    );
    const partiallyRemoved = run();
    assert.equal(partiallyRemoved.status, 1, partiallyRemoved.stderr);
    assert.match(partiallyRemoved.stderr, /focus-refetch/);
    assert.doesNotMatch(partiallyRemoved.stderr, /background-refetch/);
    writeFileSync(source, `// edited context\n${baseline}`);
    assert.equal(run().status, 0);
    writeFileSync(source, `${historical}\n`);
    assert.equal(run().status, 0);
    const missing = run("1".repeat(40));
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /could not determine/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

await test("diff-scoped settings detect removed exemptions without charging unchanged dead keys", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "settings-waiver-"));
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
    const baseline =
      "export type Prefs = {\n  // settings-key-unused-ok - reserved preference\n  waived: boolean;\n  oldDead: boolean;\n};\n";
    writeFileSync(prefs, baseline);
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
    const run = () =>
      spawnSync(
        process.execPath,
        ["scripts/guard-dead-settings-keys.mjs", "--diff"],
        {
          cwd: directory,
          encoding: "utf8",
          env: { ...process.env, GUARD_DIFF_BASE: base },
        },
      );
    assert.equal(run().status, 0);
    for (const prefix of ["", "// new context\n".repeat(8)]) {
      writeFileSync(
        prefs,
        prefix +
          baseline.replace(
            "  // settings-key-unused-ok - reserved preference\n",
            "",
          ),
      );
      const red = run();
      assert.equal(red.status, 1, red.stderr);
      assert.match(red.stderr, /waived/);
      assert.doesNotMatch(red.stderr, /oldDead/);
    }
    writeFileSync(prefs, baseline.replace("  waived: boolean;\n", ""));
    assert.equal(run().status, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

await test("diff-scoped settings reject stale exemptions when their declarations are removed", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "settings-stale-"));
  try {
    mkdirSync(path.join(directory, "scripts/lib"), { recursive: true });
    for (const file of [
      "scripts/guard-dead-settings-keys.mjs",
      "scripts/lib/changed-lines.mjs",
    ])
      copyFileSync(path.join(root, file), path.join(directory, file));
    mkdirSync(path.join(directory, "templates/brain/shared"), {
      recursive: true,
    });
    writeFileSync(path.join(directory, "templates/brain/package.json"), "{}");
    const prefs = path.join(directory, "templates/brain/shared/brain-prefs.ts");
    writeFileSync(
      prefs,
      "export type Prefs = {\n  autoArchiveResolved: boolean;\n};\n",
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
    const run = () =>
      spawnSync(
        process.execPath,
        ["scripts/guard-dead-settings-keys.mjs", "--diff"],
        {
          cwd: directory,
          encoding: "utf8",
          env: { ...process.env, GUARD_DIFF_BASE: base },
        },
      );
    assert.equal(run().status, 0);
    writeFileSync(prefs, "export type Prefs = {\n};\n");
    for (const removeFile of [false, true]) {
      if (removeFile) rmSync(prefs);
      const red = run();
      assert.equal(red.status, 1, red.stderr);
      assert.match(red.stderr, /KNOWN_DEAD_KEYS/);
      assert.match(red.stderr, /autoArchiveResolved/);
      assert.doesNotMatch(red.stderr, /notifyOnSourceErrors/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
