#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const cliEntry = path.join(repoRoot, "packages/core/src/cli/index.ts");
const tsxBin = path.join(repoRoot, "node_modules/.bin/tsx");

function runCli(args: string[], cwd: string): string {
  return execFileSync(tsxBin, [cliEntry, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      NO_COLOR: "1",
    },
  });
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-cli-smoke-"));

try {
  const help = runCli(["--help"], repoRoot);
  assert.match(help, /agent-native v/);
  assert.match(help, /agent-native create \[name\]/);
  assert.match(help, /agent-native start/);

  assert.throws(
    () => runCli(["start"], tmpDir),
    /No production build found\. Run "agent-native build" first\./,
    "start must fail clearly when .output/server/index.mjs is missing",
  );

  const createOutput = runCli(
    ["create", "qa-cli-app", "--template=blank", "--standalone"],
    tmpDir,
  );
  assert.doesNotMatch(
    createOutput,
    /Which template would you like to use/,
    "create --template=blank must not open the interactive picker",
  );

  const appDir = path.join(tmpDir, "qa-cli-app");
  const pkg = JSON.parse(
    fs.readFileSync(path.join(appDir, "package.json"), "utf8"),
  );
  assert.equal(pkg.name, "qa-cli-app");
  assert.equal(pkg.dependencies["@agent-native/core"], "latest");
  assert.equal(
    fs.existsSync(path.join(appDir, ".gitignore")),
    true,
    "standalone create must rename _gitignore",
  );
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log("qa-cli-smoke: clean");
