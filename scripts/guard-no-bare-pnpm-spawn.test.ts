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
