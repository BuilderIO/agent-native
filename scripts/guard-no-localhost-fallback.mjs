#!/usr/bin/env node
/**
 * guard-no-localhost-fallback.mjs
 *
 * Defensive CI guard: refuse to let production code use the literal
 * `local@localhost` as a fallback identity when no session is present.
 *
 * Background (cross-tenant data pooling): the framework's dev-mode auth
 * shim defines the bypass session as `{ email: "local@localhost" }`. That
 * identity is fine in dev — there's only one user. But in production,
 * patterns like
 *
 *   const owner = session?.email ?? "local@localhost";
 *   const userEmail = getRequestUserEmail() || "local@localhost";
 *
 * silently redirect every unauthenticated/missing-session request into a
 * single shared "local@localhost" tenant. Every user without a session —
 * or every code path where the request context wasn't populated — reads
 * and writes the SAME data. We've already seen this leak credentials,
 * tools, application_state rows, and per-user resources between accounts.
 *
 * The right behavior in production is to throw or 401 when there's no
 * session, NOT to fall back to a sentinel identity. A handful of dev-mode
 * helpers and the auth shim itself legitimately need to know about the
 * literal — those are allowlisted.
 *
 * Allowlist of paths where the literal is OK:
 *   - `packages/core/src/server/auth.ts`
 *     (the dev-mode auth shim itself defines local@localhost as the dev
 *     session — that's the source of truth.)
 *   - `packages/core/src/dev**\/`
 *   - `**\/*.spec.ts`, `**\/*.test.ts`, `**\/*.spec.tsx`, `**\/*.test.tsx`
 *   - `scripts/**`
 *   - `**\/seed/**`, `**\/seeds/**`
 *   - `packages/core/src/org/context.ts`
 *     (intentionally reads the dev-mode email when migrating dev-mode
 *     resources to a real account.)
 *   - `packages/core/src/server/local-migration.ts`
 *     (migrates data owned by local@localhost to a real account.)
 *   - `packages/core/src/server/google-oauth.ts`
 *     (explicitly checks for and refuses to use the literal as a token
 *     owner — that's a *protective* check, not a fallback.)
 *   - `packages/core/src/oauth-tokens/store.ts`
 *     (sanitizes incoming `local@localhost` owners — again, protective.)
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
 * Comments (lines starting with `*`, `//`, or `/*`) are skipped — the
 * literal often appears in JSDoc explaining the dev-mode behavior.
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
  ".claude",
  "out",
  "coverage",
]);

/**
 * Path patterns where the literal "local@localhost" is allowed.
 * Each predicate takes a repo-relative posix path.
 */
const ALLOWED_PATH_PREDICATES = [
  // The dev-mode auth shim — source of truth for the literal.
  (rel) => rel === "packages/core/src/server/auth.ts",
  // Dev-only framework code.
  (rel) => /^packages\/core\/src\/dev/.test(rel),
  // Tests.
  (rel) => /\.spec\.[tj]sx?$/.test(rel),
  (rel) => /\.test\.[tj]sx?$/.test(rel),
  // Build / dev / CI scripts.
  (rel) => /^scripts\//.test(rel),
  // Seed scripts.
  (rel) => /\/seed\//.test(rel),
  (rel) => /\/seeds\//.test(rel),
  // Framework's own dev-mode-aware helpers — they read/write the literal
  // intentionally because that IS the dev-mode identity, and the migration
  // helpers explicitly need to find rows owned by it.
  (rel) => rel === "packages/core/src/org/context.ts",
  (rel) => rel === "packages/core/src/server/local-migration.ts",
  // These two files contain *protective* checks (refusing to use the
  // literal as a token owner / sanitizing incoming owners). Keeping them
  // out of the guard lets the protections live alongside the values they
  // protect against.
  (rel) => rel === "packages/core/src/server/google-oauth.ts",
  (rel) => rel === "packages/core/src/oauth-tokens/store.ts",
];

const OPT_OUT_MARKER =
  /\/\/\s*guard:allow-localhost-fallback\b[^\n]*/;
const OPT_OUT_REQUIRES_REASON =
  /\/\/\s*guard:allow-localhost-fallback\s*[—-]\s*\S/;

// Match any of the three quoted forms. The flag `g` so we can iterate;
// the offset gives us the line.
const LITERAL_RE = /(?:"local@localhost"|'local@localhost'|`local@localhost`)/g;

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
    if (isAllowedPath(rel)) continue;

    let contents;
    try {
      contents = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!contents.includes("local@localhost")) continue;

    const lines = contents.split("\n");

    LITERAL_RE.lastIndex = 0;
    let m;
    while ((m = LITERAL_RE.exec(contents)) !== null) {
      const { line, col } = lineColForOffset(contents, m.index);
      const lineText = lines[line - 1] ?? "";
      // Skip matches inside comments.
      if (isCommentLine(lineText)) continue;
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

if (violations.length > 0) {
  const bar = "=".repeat(72);
  console.error(`\n${bar}`);
  console.error(
    'ERROR: forbidden `"local@localhost"` literal in production code.',
  );
  console.error(bar);
  console.error("");
  console.error(
    "`local@localhost` is the framework's DEV-mode bypass identity. Using",
  );
  console.error(
    "it as a fallback in production paths — patterns like",
  );
  console.error("");
  console.error("    const owner = session?.email ?? \"local@localhost\";");
  console.error(
    "    const userEmail = getRequestUserEmail() || \"local@localhost\";",
  );
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
  console.error("      if (!session?.email) throw createError({ statusCode: 401 });");
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
  process.exit(1);
}

console.log(
  'guard-no-localhost-fallback: clean (no "local@localhost" literals in production code).',
);
