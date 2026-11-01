import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findBarePnpmSpawns,
  isGuardedSourcePath,
} from "./guard-no-bare-pnpm-spawn.js";

const FILE = "scripts/example.ts";

function flagged(source: string, addedLines: ReadonlySet<number> | "all") {
  return findBarePnpmSpawns(FILE, source, addedLines).map(
    (finding) => finding.line,
  );
}

describe("bare pnpm spawn guard", () => {
  it("flags spawners that start pnpm without a shell", () => {
    const source = [
      'spawn("pnpm", ["run", "build"], { stdio: "inherit" });',
      'spawnSync("pnpm", args);',
      'execFileSync("pnpx", ["tsx", "x.ts"], { encoding: "utf8" });',
      'childProcess.execFile("pnpm", ["-v"], () => {});',
    ].join("\n");

    assert.deepEqual(flagged(source, "all"), [1, 2, 3, 4]);
  });

  it("follows a const, a conditional and a local helper to the command", () => {
    const source = [
      'const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";',
      "spawn(pnpm, args);",
      "function pnpmCommand() {",
      '  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";',
      "}",
      "execFileSync(pnpmCommand(), args);",
    ].join("\n");

    assert.deepEqual(flagged(source, "all"), [1, 2, 4, 6]);
  });

  it("flags the helper's command passed without its shell", () => {
    const source = [
      "const pnpm = pnpmCommand(args);",
      'spawn(pnpm.command, pnpm.args, { stdio: "inherit" });',
      "spawn(pnpm.command, pnpm.args, { shell: pnpm.shell });",
      "spawnSync(pnpmCommand(args).command, []);",
      "spawn(task.command, task.args);",
    ].join("\n");

    assert.deepEqual(flagged(source, "all"), [2, 4]);
  });

  it("follows let bindings and later assignments", () => {
    const source = [
      "let pnpm: PnpmCommand;",
      "pnpm = pnpmCommand(args);",
      'spawnSync(pnpm.command, pnpm.args, { encoding: "utf8" });',
      'let bin = "node";',
      'if (usePnpm) bin = "pnpm";',
      "spawn(bin, args);",
      "spawn(pnpm.command, pnpm.args, { shell: pnpm.shell });",
    ].join("\n");

    assert.deepEqual(flagged(source, "all"), [3, 6]);
  });

  it("follows spawners imported under another name", () => {
    const source = [
      'import { spawn as launch, execFileSync as run } from "node:child_process";',
      'const { spawnSync: runSync } = require("child_process");',
      'launch("pnpm", args);',
      'run("pnpm", ["-v"], { encoding: "utf8" });',
      'runSync("pnpm", args, { shell: true });',
      'import { launch as start } from "./launcher";',
      'start("pnpm", args);',
    ].join("\n");

    assert.deepEqual(flagged(source, "all"), [3, 4]);
  });

  it("accepts a call that sets a shell option", () => {
    const source = [
      'spawn("pnpm", args, { shell: process.platform === "win32" });',
      "const options = { cwd, shell: true };",
      'spawnSync("pnpm", args, options);',
      'spawn(windows ? "pnpm run build" : "pnpm", windows ? [] : args, { shell: windows });',
      'spawn("pnpm.cmd", args, { shell: true });',
    ].join("\n");

    assert.deepEqual(flagged(source, "all"), []);
  });

  it("treats shell: false as no shell", () => {
    const source = [
      'spawn("pnpm", args, { shell: false });',
      'spawn("pnpm", args, { shell: false as const });',
      'spawn("pnpm", args, { ...options, shell: windows });',
      "const noShell = false;",
      'spawn("pnpm", args, { shell: noShell });',
      "const shell = undefined;",
      'spawnSync("pnpm", args, { shell });',
      'const useShell = process.platform === "win32";',
      'spawn("pnpm", args, { shell: useShell });',
    ].join("\n");

    assert.deepEqual(flagged(source, "all"), [1, 2, 5, 7]);
  });

  it("reads same-named variables in other scopes conservatively", () => {
    const source = [
      "const shell = true;",
      "function run() {",
      "  const shell = false;",
      '  spawn("pnpm", args, { shell });',
      "}",
      "const options = { shell: true };",
      "function other() {",
      "  const options = { cwd };",
      '  spawn("pnpm", args, options);',
      "}",
    ].join("\n");

    assert.deepEqual(flagged(source, "all"), [4, 9]);
  });

  it("lets a later property or spread override the shell option", () => {
    const source = [
      'spawn("pnpm", args, { shell: true, ...{ shell: false } });',
      'spawn("pnpm", args, { shell: true, ...extra });',
      'spawn("pnpm", args, { shell: true, shell: false });',
      'spawn("pnpm", args, { ...extra, shell: true });',
      'spawn("pnpm", args, { shell: true, ...{ cwd } });',
      "const base = { shell: true };",
      'spawn("pnpm", args, { ...base, cwd });',
    ].join("\n");

    assert.deepEqual(flagged(source, "all"), [1, 2, 3]);
  });

  it("ignores other commands and shells that exec always uses", () => {
    const source = [
      'spawn("git", ["status"]);',
      'execSync("pnpm run build");',
      'exec("pnpm -v", () => {});',
      'spawn("node", ["pnpm"]);',
    ].join("\n");

    assert.deepEqual(flagged(source, "all"), []);
  });

  it("only reports calls that touch the branch's added lines", () => {
    const source = [
      'spawn("pnpm", ["run", "a"]);',
      "spawn(",
      '  "pnpm",',
      '  ["run", "b"],',
      ");",
    ].join("\n");

    assert.deepEqual(flagged(source, new Set([4])), [2]);
    assert.deepEqual(flagged(source, new Set([6])), []);
  });

  it("honours the pragma on the call or the line above it", () => {
    const source = [
      "// guard:allow-bare-pnpm — Linux CI container only",
      'spawn("pnpm", ["run", "a"]);',
      'spawn("pnpm", ["run", "b"]); // guard:allow-bare-pnpm — macOS only',
      'spawn("pnpm", ["run", "c"]);',
    ].join("\n");

    assert.deepEqual(flagged(source, "all"), [4]);
  });

  it("checks script and source files outside build output", () => {
    assert.equal(isGuardedSourcePath("scripts/dev-lazy.ts"), true);
    assert.equal(isGuardedSourcePath("templates/content/scripts/x.mjs"), true);
    assert.equal(isGuardedSourcePath("packages/core/src/cli/create.ts"), true);
    assert.equal(
      isGuardedSourcePath("packages/core/dist/cli/create.js"),
      false,
    );
    assert.equal(isGuardedSourcePath("node_modules/x/index.js"), false);
    assert.equal(isGuardedSourcePath("docs/windows.md"), false);
  });
});
