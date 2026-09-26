#!/usr/bin/env node
/**
 * guard-no-localhost-fallback.mjs
 *
 * Defensive CI guard: refuse to let production code use the literal
 * `local@localhost` as a fallback identity when no session is present.
 *
 * Background: the framework used to ship a dev-mode auth shim that
 * returned `{ email: "local@localhost" }` for unauthenticated requests
 * in development. The shim itself was removed in favour of forcing the
 * same Better Auth signup flow locally and in production, but the rule
 * about not pooling unauthenticated requests onto a shared sentinel
 * identity is permanent. Patterns like
 *
 *   const owner = session?.email ?? "local@localhost";
 *   const userEmail = getRequestUserEmail() || "local@localhost";
 *
 * silently redirect every unauthenticated request into a single shared
 * "local@localhost" tenant. Every user without a session — or every
 * code path where the request context wasn't populated — would read and
 * write the SAME data. The 2026-04-29 KVesta-Space credentials leak
 * traced back to exactly this pattern.
 *
 * The right behavior in production is to throw or 401 when there's no
 * session, NOT to fall back to a sentinel identity.
 *
 * Allowlist of paths where the literal is OK:
 *   - `**\/*.spec.ts`, `**\/*.test.ts`, `**\/*.spec.tsx`, `**\/*.test.tsx`
 *     (tests use the literal as a fixture / regression marker for the
 *     historic shim; those tests should never reach production.)
 *   - `scripts/**`
 *     (this guard, ad-hoc migration scripts, etc.)
 *   - `**\/seed/**`, `**\/seeds/**`
 *     (seed data that explicitly wants to plant a dev fixture row.)
 *
 * Per-line opt-out (same line OR the line immediately above):
 *
 *   const x = email ?? "local@localhost" // guard:allow-localhost-fallback — short reason
 *
 * The marker must include "guard:allow-localhost-fallback" and a reason
 * (separated by `—` or `-`).
 *
 * Forms caught:
 *
 *   "local@localhost"     (double-quoted)
 *   'local@localhost'     (single-quoted)
 *   `local@localhost`     (backtick / template literal)
 *
 * Symbolic alias caught:
 *
 *   ?? DEV_MODE_USER_EMAIL
 *   || DEV_MODE_USER_EMAIL
 *
 * The audit (02 — getCurrentRunOwner) found that hiding the literal
 * behind a symbolic alias slipped past the regex above. Use the same
 * "no fallback to dev sentinel" rule for symbolic references on `??` /
 * `||` chains. Imports and other reads of the constant are fine — only
 * the fallback shape is dangerous.
 *
 * Comments (lines starting with `*`, `//`, or `/*`) are skipped — the
 * literal often appears in JSDoc explaining historical dev-mode behavior.
 *
 * SQL DDL `DEFAULT 'local@localhost'` (and the Drizzle helper
 * `.default('local@localhost')`) is also skipped — schema column defaults
 * are intentional dev fixtures: they let dev-mode inserts succeed before
 * a session is established, and they're shadowed in production by the
 * framework's per-request `owner_email` injection. Those are not the
 * dangerous fallback pattern.
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
  ".react-router",
  ".generated",
  "corpus",
  ".claude",
  ".tmp",
  ".video-bakeoff",
  ".video-bakeoff-recording",
  ".vscode-test",
  "out",
  "coverage",
]);

const ALLOWED_PATH_PREDICATES = [
  (rel) => rel === "packages/core/src/server/auth.ts",
  (rel) => /^packages\/core\/src\/dev/.test(rel),
  (rel) => rel === "packages/core/src/guards/no-localhost-fallback.ts",
  (rel) => /^packages\/core\/corpus\//.test(rel),
  (rel) => /\.spec\.[tj]sx?$/.test(rel),
  (rel) => /\.test\.[tj]sx?$/.test(rel),
  (rel) => /^scripts\//.test(rel),
  (rel) => /\/seed\//.test(rel),
  (rel) => /\/seeds\//.test(rel),
  // Framework's own dev-mode-aware helpers — they read/write the literal
  // intentionally because that IS the dev-mode identity, and the migration
  // helpers explicitly need to find rows owned by it.
  (rel) => rel === "packages/core/src/org/context.ts",
  (rel) => rel === "packages/core/src/server/local-migration.ts",
  (rel) => rel === "packages/core/src/server/google-oauth.ts",
  (rel) => rel === "packages/core/src/oauth-tokens/store.ts",
];

const OPT_OUT_MARKER = /\/\/\s*guard:allow-localhost-fallback\b[^\n]*/;
const OPT_OUT_REQUIRES_REASON =
  /\/\/\s*guard:allow-localhost-fallback\s*[—-]\s*\S/;

const LITERAL_RE = /(?:"local@localhost"|'local@localhost'|`local@localhost`)/g;

const SYMBOLIC_FALLBACK_RE = /(?:\?\?|\|\|)\s*DEV_MODE_USER_EMAIL\b/g;

const AMBIENT_ENV_FALLBACK_RE =
  /(?:\?\?|\|\|)\s*process\.env\.(?:AGENT_USER_EMAIL|AGENT_ORG_ID|AGENT_USER_NAME|WORKSPACE_OWNER_EMAIL)\b/g;
const AMBIENT_HELPER_FALLBACK_RE =
  /(?:\?\?|\|\|)\s*getAmbient(?:UserEmail|OrgId)\s*\(\s*\)/g;

const AMBIENT_ALLOWED_PATH_PREDICATES = [
  (rel) => /(?:^|\/)scripts\//.test(rel),
  (rel) => /(?:^|\/)src\/cli\//.test(rel),
  (rel) => /(?:^|\/)src\/scripts\//.test(rel),
  (rel) => /(?:^|\/)script-(?:helpers|entries)\.ts$/.test(rel),
  (rel) => rel === "packages/core/src/server/request-context.ts",
  (rel) => rel === "packages/core/src/guards/no-localhost-fallback.ts",
  (rel) => /^packages\/core\/corpus\//.test(rel),
  (rel) => /\.spec\.[tj]sx?$/.test(rel),
  (rel) => /\.test\.[tj]sx?$/.test(rel),
  (rel) => /\/seed\//.test(rel),
  (rel) => /\/seeds\//.test(rel),
];

const SQL_DEFAULT_RE = /\bDEFAULT\s+['"`]local@localhost['"`]/i;
const DRIZZLE_DEFAULT_RE = /\.default\s*\(\s*['"`]local@localhost['"`]\s*\)/;

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

function isAllowedPath(rel) {
  return ALLOWED_PATH_PREDICATES.some((p) => p(rel));
}

function isAmbientAllowedPath(rel) {
  return AMBIENT_ALLOWED_PATH_PREDICATES.some((p) => p(rel));
}

function lineColForOffset(contents, offset) {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset; i++) {
    if (contents.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, col: offset - lineStart + 1 };
}

function isCommentLine(lineText) {
  const trimmed = lineText.trimStart();
  return (
    trimmed.startsWith("*") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*")
  );
}

function hasValidOptOut(lines, lineIdx) {
  const cur = lines[lineIdx] ?? "";
  if (OPT_OUT_MARKER.test(cur)) {
    return OPT_OUT_REQUIRES_REASON.test(cur);
  }
  const prev = lines[lineIdx - 1] ?? "";
  if (/^\s*\/\//.test(prev) && OPT_OUT_MARKER.test(prev)) {
    return OPT_OUT_REQUIRES_REASON.test(prev);
  }
  return false;
}

async function scan() {
  const violations = [];
  for await (const file of walk(REPO_ROOT)) {
    if (!/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(file)) continue;
    if (file.endsWith(".d.ts")) continue;
    const rel = path.relative(REPO_ROOT, file).replaceAll("\\", "/");
    const literalAllowed = isAllowedPath(rel);
    const ambientAllowed = isAmbientAllowedPath(rel);
    if (literalAllowed && ambientAllowed) continue;

    let contents;
    try {
      contents = readFileSync(file, "utf8");
    } catch {
      continue;
    }

    const lines = contents.split("\n");

    if (!ambientAllowed) {
      for (const [re, kind] of [
        [AMBIENT_ENV_FALLBACK_RE, "env"],
        [AMBIENT_HELPER_FALLBACK_RE, "helper"],
      ]) {
        re.lastIndex = 0;
        let a;
        while ((a = re.exec(contents)) !== null) {
          const { line, col } = lineColForOffset(contents, a.index);
          const lineText = lines[line - 1] ?? "";
          if (isCommentLine(lineText)) continue;
          if (hasValidOptOut(lines, line - 1)) continue;
          violations.push({
            file: rel,
            line,
            col,
            snippet: lineText.trim(),
            ambient: kind,
          });
        }
      }
    }

    if (literalAllowed) continue;

    SYMBOLIC_FALLBACK_RE.lastIndex = 0;
    let s;
    while ((s = SYMBOLIC_FALLBACK_RE.exec(contents)) !== null) {
      const { line, col } = lineColForOffset(contents, s.index);
      const lineText = lines[line - 1] ?? "";
      if (isCommentLine(lineText)) continue;
      if (hasValidOptOut(lines, line - 1)) continue;
      violations.push({
        file: rel,
        line,
        col,
        snippet: lineText.trim(),
      });
    }

    if (!contents.includes("local@localhost")) continue;

    LITERAL_RE.lastIndex = 0;
    let m;
    while ((m = LITERAL_RE.exec(contents)) !== null) {
      const { line, col } = lineColForOffset(contents, m.index);
      const lineText = lines[line - 1] ?? "";
      if (isCommentLine(lineText)) continue;
      if (SQL_DEFAULT_RE.test(lineText)) continue;
      if (DRIZZLE_DEFAULT_RE.test(lineText)) continue;
      if (hasValidOptOut(lines, line - 1)) continue;
      violations.push({
        file: rel,
        line,
        col,
        snippet: lineText.trim(),
      });
    }
  }
  return violations;
}

const violations = await scan();

const ambientViolations = violations.filter((v) => v.ambient);
const literalViolations = violations.filter((v) => !v.ambient);

if (ambientViolations.length > 0) {
  const bar = "=".repeat(72);
  console.error(`\n${bar}`);
  console.error(
    "ERROR: ambient process identity used as a request-scoped fallback.",
  );
  console.error(bar);
  console.error("");
  console.error(
    "`AGENT_USER_EMAIL` / `WORKSPACE_OWNER_EMAIL` (and `getAmbientUserEmail()`)",
  );
  console.error(
    "name the identity of the DEPLOYMENT, not the identity of the caller.",
  );
  console.error("Using one as a fallback — patterns like");
  console.error("");
  console.error(
    "    const email = getRequestUserEmail() ?? process.env.AGENT_USER_EMAIL;",
  );
  console.error(
    "    const owner = session?.email || process.env.WORKSPACE_OWNER_EMAIL;",
  );
  console.error("");
  console.error(
    "— means an admin gate admits whoever the deploy env names rather than",
  );
  console.error(
    "whoever signed in. It fails OPEN toward more privilege. This is the shape",
  );
  console.error(
    "that made every authenticated user an admin across 24 hand-written routes.",
  );
  console.error("");
  for (const v of ambientViolations) {
    console.error(`  ${v.file}:${v.line}:${v.col}`);
    if (v.snippet) console.error(`    ${v.snippet}`);
  }
  console.error("");
  console.error(bar);
  console.error("Fix:");
  console.error("");
  console.error(
    "  - In a request handler, fail closed when there's no caller:",
  );
  console.error("      const email = getRequestUserEmail();");
  console.error("      if (!email) throw createError({ statusCode: 401 });");
  console.error(
    "  - If this really is a CLI / cron / seed entrypoint with no request",
  );
  console.error(
    "    behind it, call `getAmbientUserEmail()` from a script path so the",
  );
  console.error("    intent is stated rather than inherited.");
  console.error("");
  console.error("  Last-resort opt-out (requires reviewer approval):");
  console.error(
    "    const x = a ?? process.env.AGENT_USER_EMAIL // guard:allow-localhost-fallback — explain why",
  );
  console.error(`${bar}\n`);
}

if (literalViolations.length > 0) {
  const violations = literalViolations;
  const bar = "=".repeat(72);
  console.error(`\n${bar}`);
  console.error(
    'ERROR: forbidden `"local@localhost"` (or DEV_MODE_USER_EMAIL alias) ' +
      "fallback in production code.",
  );
  console.error(bar);
  console.error("");
  console.error(
    "`local@localhost` is the framework's DEV-mode bypass identity. Using",
  );
  console.error("it as a fallback in production paths — patterns like");
  console.error("");
  console.error('    const owner = session?.email ?? "local@localhost";');
  console.error(
    '    const userEmail = getRequestUserEmail() || "local@localhost";',
  );
  console.error("    const owner = ctx?.owner ?? DEV_MODE_USER_EMAIL;");
  console.error("");
  console.error(
    "— silently pools every unauthenticated request into a single shared",
  );
  console.error(
    'tenant. Anyone without a session reads/writes the same "local@localhost"',
  );
  console.error("data. That has already leaked credentials, tools,");
  console.error("application_state rows, and resources between accounts.");
  console.error("");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}:${v.col}`);
    if (v.snippet) console.error(`    ${v.snippet}`);
  }
  console.error("");
  console.error(bar);
  console.error("Fix:");
  console.error("");
  console.error("  - In production paths, throw/401 when there's no session:");
  console.error("      const session = await getSession(event);");
  console.error(
    "      if (!session?.email) throw createError({ statusCode: 401 });",
  );
  console.error("      const owner = session.email;");
  console.error(
    "  - Inside an action / auto-mounted route the framework already",
  );
  console.error("    populates the request context — read userEmail / orgId");
  console.error(
    "    from `getRequestUserEmail()` / `getRequestOrgId()` and treat",
  );
  console.error("    `undefined` as 'no session' (don't backfill a sentinel).");
  console.error(
    "  - For dev-mode-only flows, gate on `AUTH_MODE === 'local'` or the",
  );
  console.error("    dev-only path allowlist; do NOT smuggle the literal");
  console.error("    into shared production code.");
  console.error("");
  console.error("  Last-resort opt-out (requires reviewer approval):");
  console.error(
    '    const x = email ?? "local@localhost" // guard:allow-localhost-fallback — explain why',
  );
  console.error(`${bar}\n`);
}

if (violations.length > 0) {
  process.exit(1);
}

console.log(
  'guard-no-localhost-fallback: clean (no "local@localhost" literals and no ' +
    "ambient-identity fallbacks in production code).",
);
