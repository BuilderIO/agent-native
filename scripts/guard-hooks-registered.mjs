#!/usr/bin/env node
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

const claudeMdHookRefs = [
  ...claudeMd.matchAll(/scripts\/hooks\/([\w.-]+\.(?:mjs|js|ts))/g),
].map((match) => match[1]);

for (const name of new Set(claudeMdHookRefs)) {
  const wired = registeredCommands.some((command) => command.includes(name));
  if (!wired) {
    problems.push(
      `CLAUDE.md documents \`scripts/hooks/${name}\` but no hook command in .claude/settings.json references it.`,
    );
  }
}

for (const command of registeredCommands) {
  const match = command.match(/scripts\/hooks\/([\w.-]+\.(?:mjs|js|ts))/);
  if (!match) continue;
  const name = match[1];
  if (!hookScripts.includes(name)) {
    problems.push(
      `.claude/settings.json registers \`scripts/hooks/${name}\` but that file does not exist.`,
    );
  }
}

if (problems.length > 0) fail(problems);

console.log(
  `guard-hooks-registered: OK (${registeredCommands.length} hook command(s) registered, ${hookScripts.length} hook script(s) on disk).`,
);
