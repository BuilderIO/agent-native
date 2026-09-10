#!/usr/bin/env node
/**
 * guard-no-drizzle-push.mjs
 *
 * Defensive CI guard: refuse to let `drizzle-kit push` (or `drizzle push`) get
 * wired into any build/deploy path.
 *
 * Background (2026-04-21 incident): `pnpm --filter <tpl> exec drizzle-kit push
 * --force` was added to every `templates/*\/netlify.toml` build command. Each
 * template's drizzle schema only knows about template-domain tables, so push
 * saw every framework table (`user`, `session`, `account`, `organization`,
 * `settings`, `application_state`) as "not in schema" and dropped them in 9
 * template production DBs. PR #252 reverted it. See CLAUDE.md / AGENTS.md
 * "No breaking database changes" for the policy.
 *
 * This script scans:
 *   - every `netlify.toml` in the repo
 *   - every `package.json` `build` / `postinstall` / `prebuild` / `deploy`
 *     / `predeploy` / `start` / `prestart` script
 *
 * ...for the literal strings `drizzle-kit push` or `drizzle push`. If any
 * match is found, exit 1 with a loud message.
 *
 * Allowed escape hatch: a standalone `db:push` / `db:push:*` npm script is
 * fine — that's an explicit, human-invoked command, not a build step. Only
 * build/install/deploy/start hooks are blocked, because those run in CI.
 */

import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".output",
  ".cache",
  ".turbo",
  ".netlify",
  ".vercel",
  ".wrangler",
  "coverage",
]);

// Scripts that run in CI / on deploy / on install. A `drizzle-kit push` in
// any of these effectively runs against production. Standalone `db:push` is
// intentionally NOT in this list — we allow humans to invoke that explicitly.
const DANGEROUS_SCRIPT_HOOKS = new Set([
  "build",
  "prebuild",
  "postbuild",
  "install",
  "preinstall",
  "postinstall",
  "deploy",
  "predeploy",
  "postdeploy",
  "start",
  "prestart",
  "poststart",
  "ci",
  "release",
  "prerelease",
  "postrelease",
]);

const PATTERNS = [/\bdrizzle-kit\s+push\b/, /\bdrizzle\s+push\b/];

function matchesForbidden(str) {
  if (!str || typeof str !== "string") return false;
  return PATTERNS.some((p) => p.test(str));
}

/** Recursively walk the repo, yielding absolute file paths. */
async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

const violations = [];

function recordViolation(file, location, snippet) {
  violations.push({
    file: path.relative(REPO_ROOT, file),
    location,
    snippet: snippet.trim(),
  });
}

async function scan() {
  for await (const file of walk(REPO_ROOT)) {
    const base = path.basename(file);
    if (base === "netlify.toml") {
      scanNetlifyToml(file);
    } else if (base === "package.json") {
      scanPackageJson(file);
    }
  }
}

function scanNetlifyToml(file) {
  let contents;
  try {
    contents = readFileSync(file, "utf8");
  } catch {
    return;
  }
  if (!matchesForbidden(contents)) return;
  // Extract matching lines so the error output is actionable.
  const lines = contents.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (matchesForbidden(lines[i])) {
      recordViolation(file, `line ${i + 1}`, lines[i]);
    }
  }
}

function scanPackageJson(file) {
  let json;
  try {
    json = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return;
  }
  const scripts = json?.scripts;
  if (!scripts || typeof scripts !== "object") return;
  for (const [name, cmd] of Object.entries(scripts)) {
    if (!DANGEROUS_SCRIPT_HOOKS.has(name)) continue;
    if (matchesForbidden(cmd)) {
      recordViolation(file, `scripts.${name}`, String(cmd));
    }
  }
}

await scan();

if (violations.length > 0) {
  const bar = "=".repeat(72);
  console.error(`\n${bar}`);
  console.error(
    "ERROR: forbidden `drizzle-kit push` found in a build/deploy path.",
  );
  console.error(bar);
  console.error("");
  for (const v of violations) {
    console.error(`  ${v.file}  (${v.location})`);
    console.error(`    ${v.snippet}`);
    console.error("");
  }
  console.error(bar);
  console.error("Why this is blocked:");
  console.error("");
  console.error(
    "  On 2026-04-21, `drizzle-kit push --force` was added to every",
  );
  console.error("  template's netlify.toml build command. Template schemas");
  console.error("  only know about domain tables, so push treated framework");
  console.error("  tables (user / session / account / organization /");
  console.error("  application_state / settings) as orphaned and dropped them");
  console.error("  in production. PR #252 reverted it.");
  console.error("");
  console.error("  Schema changes must go through `runMigrations` in each");
  console.error("  template's `server/plugins/db.ts` — additive SQL only.");
  console.error("  See CLAUDE.md / AGENTS.md 'No breaking database changes'.");
  console.error("");
  console.error(
    "  Standalone `db:push` scripts are allowed (human-invoked). This",
  );
  console.error("  guard only blocks `drizzle-kit push` wired into build /");
  console.error("  install / deploy / start hooks, or into netlify.toml.");
  console.error(`${bar}\n`);
  process.exit(1);
}

console.log(
  "guard-no-drizzle-push: clean (no `drizzle-kit push` in any build/deploy path).",
);
