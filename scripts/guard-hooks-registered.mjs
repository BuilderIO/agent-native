#!/usr/bin/env node
/**
 * guard-hooks-registered.mjs
 *
 * CLAUDE.md documents exactly one behavioral mechanism — the file-lease hook —
 * and describes it as "registered in .claude/settings.json". For most of this
 * repo's life that file was gitignored, so the claim could not be checked by
 * anyone: a fresh checkout got no hook, a removed hook left no diff, and an
 * instruction-surface audit on 2026-08-11 found a documented-but-unregistered
 * hook exactly once this had become possible.
 *
 * This guard closes the loop in both directions:
 *   - every `scripts/hooks/*.mjs` that CLAUDE.md names must be wired into
 *     .claude/settings.json
 *   - every hook command wired into settings.json must point at a script that
 *     exists on disk
 *
 * It deliberately does not check *which* event a hook is registered on. That
 * is a design choice a reviewer should make; this only stops the two failures
 * that are invisible without it — documented-but-absent, and wired-but-gone.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const SETTINGS_PATH = path.join(REPO_ROOT, ".claude", "settings.json");
const HOOKS_DIR = path.join(REPO_ROOT, "scripts", "hooks");
const CLAUDE_MD = path.join(REPO_ROOT, "CLAUDE.md");

function fail(lines) {
  console.error(`guard-hooks-registered: ${lines.length} problem(s).\n`);
  for (const line of lines) console.error(`  ${line}`);
  console.error(
    "\nCLAUDE.md's Checks section is the source of truth for which hooks exist.\n" +
      "Either wire the hook into .claude/settings.json, or stop documenting it.\n",
  );
  process.exit(1);
}

if (!existsSync(SETTINGS_PATH)) {
  fail([
    ".claude/settings.json is missing — the hooks CLAUDE.md documents are not registered anywhere.",
  ]);
}

let settings;
try {
  settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
} catch (error) {
  fail([`.claude/settings.json is not valid JSON: ${error.message}`]);
}

/** Every `command` string across every event/matcher group. */
const registeredCommands = Object.values(settings.hooks ?? {})
  .flat()
  .flatMap((group) => group?.hooks ?? [])
  .map((hook) => hook?.command)
  .filter((command) => typeof command === "string");

const claudeMd = readFileSync(CLAUDE_MD, "utf8");
const hookScripts = existsSync(HOOKS_DIR)
  ? readdirSync(HOOKS_DIR).filter((name) => /\.(mjs|js|ts)$/.test(name))
  : [];

const problems = [];

for (const script of hookScripts) {
  const relative = `scripts/hooks/${script}`;
  const documented = claudeMd.includes(relative);
  const registered = registeredCommands.some((command) =>
    command.includes(relative),
  );
  if (documented && !registered) {
    problems.push(
      `${relative} is documented in CLAUDE.md but not registered in .claude/settings.json.`,
    );
  }
}

for (const command of registeredCommands) {
  const match = /scripts\/hooks\/[\w.-]+/.exec(command);
  if (!match) continue;
  if (!existsSync(path.join(REPO_ROOT, match[0]))) {
    problems.push(
      `.claude/settings.json registers ${match[0]}, which does not exist.`,
    );
  }
}

if (problems.length > 0) fail(problems);

console.log(
  `guard-hooks-registered: OK (${registeredCommands.length} hook command(s) registered, ${hookScripts.length} hook script(s) on disk).`,
);
