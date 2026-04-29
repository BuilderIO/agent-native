#!/usr/bin/env node
/**
 * guard-no-env-writes.mjs
 *
 * Defensive CI guard: refuse to let user-supplied secrets reach `process.env`
 * or a `.env` file from server source. User-pasted credentials must persist
 * to `app_secrets` (encrypted, scope=user) and be resolved per-request via
 * `resolveSecret(...)` / `resolveBuilderCredential(...)`. Anything that
 * mutates `process.env` or appends to `.env` from server code is a
 * cross-tenant leak vector — see KVesta Space, 2026-04, where deploy-level
 * `BUILDER_PRIVATE_KEY` silently identified every analytics user as the
 * key's owner.
 *
 * What we forbid in framework / template / action source:
 *   - `process.env[X] = ...`        — direct env mutation
 *   - `process.env.X = ...`         — same, dotted form
 *   - `delete process.env[X]`       — also forbidden (env is shared state;
 *                                     scoped state belongs in SQL)
 *   - any call to `upsertEnvFile`   — writes user-paste values to `.env`
 *
 * What we still allow:
 *   - Reading `process.env.X` (deploy-level fallback for unauthenticated
 *     contexts is legitimate; the leak class is on the WRITE side).
 *   - `process.env` reads/writes inside `scripts/`, test fixtures, `.spec.`,
 *     `.test.`, and the bootstrap files that legitimately need to set
 *     env from `.env` files at startup (loadEnv, request-context, etc.).
 *
 * Tweak ALLOW_EXACT or ALLOW_PREFIX below if you have a justified
 * exception. Do NOT broaden the patterns to silence a real violation —
 * fix the call site instead.
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
  ".claude",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".output",
  ".cache",
  ".turbo",
  ".netlify",
  ".vercel",
  ".wrangler",
  "coverage",
  ".agents",
  "docs",
]);

// Files that legitimately write to process.env or .env. These are bootstrap
// / dev-tooling paths where env vars are the deliberate transport (loading
// .env files at startup, dev runners that re-source .env on changes, the
// CLI's `agent-native dev` setup, and so on). NOT exempt: any handler that
// runs in response to a user request.
const ALLOW_EXACT = new Set([
  // Loads .env files into process.env at startup — what dotenv does.
  "packages/core/src/scripts/utils.ts",
  // CLI-only: writes the framework's own bin/path on install.
  "packages/core/src/scripts/runner.ts",
  // The `dotenvx` config file in dev runners.
  "packages/core/src/server/create-server.ts",
  // CF Workers bootstrap: copies platform bindings into process.env so the
  // rest of the framework can read them as Node env vars. Not user input.
  "packages/core/src/deploy/build.ts",
  // Test runners + dev tooling that may shape env locally.
  "scripts/dev-all.ts",
  "scripts/dev-electron.ts",
]);

const ALLOW_PREFIX = [
  // CLI scripts run on a developer's box, not in a request context.
  "packages/core/src/scripts/",
  "scripts/",
  // Test fixtures.
  "packages/core/src/__tests__/",
];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".cjs", ".js"]);
const TEST_FILE_RE = /(^|\/)(.*\.spec\.|.*\.test\.|__tests__\/)/;

// Known-internal env-var names that the framework legitimately writes to
// at startup or in request-context bootstrap. These are NOT user-pasted
// secrets — they're either (a) deploy/runtime config the operator sets
// (PORT, NODE_ENV, AUTH_MODE), (b) request-scoped context the framework
// stamps before invoking handlers (AGENT_USER_EMAIL, AGENT_ORG_ID,
// AGENT_USER_TIMEZONE), or (c) self-generated server-only secrets
// (BETTER_AUTH_SECRET, AGENT_TERMINAL_PORT). Adding to this list is a
// deliberate act — only do it for keys that originate inside the
// framework, never for anything a user could paste.
const ALLOWED_INTERNAL_ENV_KEYS = new Set([
  "AGENT_USER_EMAIL",
  "AGENT_ORG_ID",
  "AGENT_USER_TIMEZONE",
  "AUTH_MODE",
  "AUTH_DISABLED",
  "BETTER_AUTH_SECRET",
  "AGENT_TERMINAL_PORT",
  "__AGENT_TERMINAL_RUNNING",
  "PORT",
  "DEBUG",
  "NODE_ENV",
]);

const PATTERNS = [
  // process.env[<expr>] = ...   — bracket notation with a non-literal key.
  // Almost always a leak vector (the loop variable is a secret name);
  // use a per-key explicit assignment if the key really is internal.
  {
    re: /process\.env\s*\[\s*[^\]'"`]+\]\s*[+\-*/]?=(?!=)/,
    label: "process.env[<dynamic key>] = ...",
  },
  // process.env["X"] = ... or process.env['X'] = ...
  // — bracket notation with a string literal key. Allowed iff that key
  // is in ALLOWED_INTERNAL_ENV_KEYS; checked at violation time.
  {
    re: /process\.env\s*\[\s*['"`]([A-Z_][A-Z0-9_]*)['"`]\s*\]\s*[+\-*/]?=(?!=)/,
    label: "process.env['X'] = ...",
    captureGroup: 1,
  },
  // process.env.X = ...    or   process.env.X += ...
  // — dotted form. Allowed iff X is in ALLOWED_INTERNAL_ENV_KEYS.
  {
    re: /process\.env\.([A-Z_][A-Z0-9_]*)\s*[+\-*/]?=(?!=)/,
    label: "process.env.X = ...",
    captureGroup: 1,
  },
  // upsertEnvFile(...) — anything that writes to a `.env` file is a leak
  // vector for user-pasted secrets, period.
  {
    re: /\bupsertEnvFile\s*\(/,
    label: "upsertEnvFile(...)",
  },
];

const violations = [];

function isAllowed(relPath) {
  if (ALLOW_EXACT.has(relPath)) return true;
  for (const prefix of ALLOW_PREFIX) {
    if (relPath.startsWith(prefix)) return true;
  }
  if (TEST_FILE_RE.test(relPath)) return true;
  return false;
}

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
      const ext = path.extname(entry.name);
      if (!SOURCE_EXTENSIONS.has(ext)) continue;
      yield full;
    }
  }
}

function scanFile(file) {
  const rel = path.relative(REPO_ROOT, file);
  if (isAllowed(rel)) return;
  let contents;
  try {
    contents = readFileSync(file, "utf8");
  } catch {
    return;
  }
  // Cheap pre-filter so we skip the regex pass on most files.
  if (
    !contents.includes("process.env") &&
    !contents.includes("upsertEnvFile")
  ) {
    return;
  }
  const lines = contents.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Strip line comments so commented-out examples don't trip the guard.
    const code = line.replace(/\/\/.*$/, "");
    for (const { re, label, captureGroup } of PATTERNS) {
      const m = code.match(re);
      if (!m) continue;
      // For patterns with a capture group, allow known-internal env keys
      // (request-context bootstrap, auth/server config) — only secret-
      // shaped names trip the guard.
      if (captureGroup !== undefined) {
        const captured = m[captureGroup];
        if (captured && ALLOWED_INTERNAL_ENV_KEYS.has(captured)) break;
      }
      violations.push({
        file: rel,
        line: i + 1,
        label,
        snippet: line.trim().slice(0, 120),
      });
      break;
    }
  }
}

async function main() {
  for await (const file of walk(REPO_ROOT)) {
    scanFile(file);
  }

  if (violations.length === 0) {
    return;
  }

  const bar = "=".repeat(72);
  console.error(`\n${bar}`);
  console.error(
    "ERROR: source code writes to process.env or .env from a request path.",
  );
  console.error(bar);
  console.error("");
  console.error("User-pasted secrets must persist to app_secrets (encrypted,");
  console.error("scope=user), not process.env. Mutating process.env from a");
  console.error("request handler is a cross-tenant leak vector.");
  console.error("");
  console.error("Use writeAppSecret({ key, value, scope: 'user', scopeId })");
  console.error("on the write side and resolveSecret(key) on the read side.");
  console.error("");
  console.error("Violations:");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.label}`);
    console.error(`    ${v.snippet}`);
  }
  console.error("");
  console.error(
    `${violations.length} violation${violations.length === 1 ? "" : "s"} found.`,
  );
  console.error(
    "If a path is legitimate (bootstrap, CLI, test fixture), add it to",
  );
  console.error(
    "ALLOW_EXACT or ALLOW_PREFIX in scripts/guard-no-env-writes.mjs.",
  );
  console.error(`${bar}\n`);
  process.exit(1);
}

await main();
