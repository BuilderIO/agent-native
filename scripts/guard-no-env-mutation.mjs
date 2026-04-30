#!/usr/bin/env node
/**
 * guard-no-env-mutation.mjs
 *
 * Defensive CI guard: refuse to let production code MUTATE `process.env`
 * (e.g. `process.env.AGENT_USER_EMAIL = userEmail`).
 *
 * Background (2026-04 incident class — cross-tenant request leakage on
 * serverless): every Lambda/Netlify Function/Cloudflare Worker invocation
 * shares ONE Node process with every other concurrent invocation hitting
 * the same warm container. `process.env` is process-scoped, NOT
 * request-scoped — so when a webhook handler does
 *
 *   process.env.AGENT_USER_EMAIL = hostEmail; // run agent…
 *   process.env.AGENT_USER_EMAIL = originalEmail; // restore
 *
 * any *other* request that reads `process.env.AGENT_USER_EMAIL` while the
 * handler is mid-flight sees the wrong identity. The "restore" line never
 * helps: a second request races between the set and the restore. The most
 * recent example was `templates/calls/server/routes/api/webhooks/zoom.post.ts`
 * doing exactly that to thread the host's email through legacy CLI scripts.
 *
 * The framework already has the right primitive — `runWithRequestContext`
 * (AsyncLocalStorage) — which IS per-request safe. Production code must
 * use it instead of poking `process.env`. This guard catches new mutations
 * before they land.
 *
 * Allowlist of paths where mutation is OK:
 *   - `scripts/**`  (CLI / build scripts run as their own short-lived process)
 *   - `**\/*.spec.ts`, `**\/*.test.ts`, `**\/*.spec.tsx`, `**\/*.test.tsx`
 *     (tests routinely set env vars, then restore in afterEach)
 *   - `packages/core/src/dev**\/`  (dev-only tooling, single-tenant)
 *   - `templates/<tpl>/test/**`
 *   - any path containing `/cli/` or `/scaffold/`
 *
 * The framework itself has a few legitimate `process.env.AGENT_USER_EMAIL =
 * userEmail` writes (action-routes, agent-chat-plugin, jobs/scheduler) for
 * back-compat with legacy CLI scripts that still read process.env directly.
 * Those have to opt out per-line with a reason — they should be migrated
 * to `runWithRequestContext` over time.
 *
 * Per-line opt-out (same line OR the line immediately above):
 *
 *   process.env.X = y // guard:allow-env-mutation — short reason
 *
 * The marker must include "guard:allow-env-mutation" and a reason
 * (separated by `—` or `-`).
 *
 * Patterns caught:
 *
 *   process.env.FOO = …            // member-assignment form
 *   process.env["FOO"] = …          // bracket-assignment form
 *   process.env.FOO += …            // any compound assignment
 *   delete process.env.FOO          // member-delete form
 *
 * Lines inside string literals or comments are NOT flagged — the regex
 * requires the assignment to start the matched substring, and we skip any
 * line whose trimmed prefix is `*`, `//`, or `/*` (a doc comment line).
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
 * Path patterns where mutating process.env is allowed unconditionally.
 * Each predicate takes a repo-relative posix path.
 */
const ALLOWED_PATH_PREDICATES = [
  // Build / dev / CI scripts.
  (rel) => /^scripts\//.test(rel),
  // Tests.
  (rel) => /\.spec\.[tj]sx?$/.test(rel),
  (rel) => /\.test\.[tj]sx?$/.test(rel),
  // Per-template test fixtures / e2e directories.
  (rel) => /^templates\/[^/]+\/test\//.test(rel),
  (rel) => /^templates\/[^/]+\/tests\//.test(rel),
  // Dev-only framework code (single-tenant by definition).
  (rel) => /^packages\/core\/src\/dev/.test(rel),
  // CLI tools and scaffolders that boot their own short-lived process.
  (rel) => /\/cli\//.test(rel),
  (rel) => /\/scaffold\//.test(rel),
  // The CLI package itself.
  (rel) => /^packages\/cli\//.test(rel),
  (rel) => /^packages\/create-agent-native\//.test(rel),
];

const OPT_OUT_MARKER = /\/\/\s*guard:allow-env-mutation\b[^\n]*/;
const OPT_OUT_REQUIRES_REASON = /\/\/\s*guard:allow-env-mutation\s*[—-]\s*\S/;

// Mutation forms:
//   process.env.NAME =
//   process.env.NAME +=  -=  *=  /=  ??=  ||=  &&=
//   process.env["NAME"] = …  (single or double quotes, optional whitespace)
//
// Crucially, exclude `==` and `===` (comparisons) — we require either
// (a) a single `=` not followed by another `=`, OR (b) a compound assign
// like `+=`, `??=`, etc.
//
// The negative-lookahead `(?!=)` after the bare `=` rules out `==` / `===`.
const ASSIGN_TAIL = String.raw`(?:\s*(?:=(?!=)|\+=|-=|\*=|/=|\?\?=|\|\|=|&&=))`;
const MEMBER_FORM = new RegExp(
  String.raw`process\.env\.[A-Z_][A-Z0-9_]*${ASSIGN_TAIL}`,
  "g",
);
const BRACKET_FORM = new RegExp(
  String.raw`process\.env\[\s*["'][A-Z_][A-Z0-9_]+["']\s*\]${ASSIGN_TAIL}`,
  "g",
);
const DELETE_MEMBER_FORM = new RegExp(
  String.raw`\bdelete\s+process\.env\.[A-Z_][A-Z0-9_]*\b`,
  "g",
);
const DELETE_BRACKET_FORM = new RegExp(
  String.raw`\bdelete\s+process\.env\[\s*["'][A-Z_][A-Z0-9_]+["']\s*\]`,
  "g",
);

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
  // Allow opt-out on the immediately preceding line if it's a comment.
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
    if (!contents.includes("process.env")) continue;

    const lines = contents.split("\n");

    for (const re of [
      MEMBER_FORM,
      BRACKET_FORM,
      DELETE_MEMBER_FORM,
      DELETE_BRACKET_FORM,
    ]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(contents)) !== null) {
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
  }
  return violations;
}

const violations = await scan();

if (violations.length > 0) {
  const bar = "=".repeat(72);
  console.error(`\n${bar}`);
  console.error("ERROR: forbidden process.env mutation in production code.");
  console.error(bar);
  console.error("");
  console.error(
    "process.env is process-scoped, NOT request-scoped. On serverless",
  );
  console.error(
    "(Lambda / Netlify Functions / Cloudflare Workers / Vercel) every",
  );
  console.error("warm container handles many concurrent requests in ONE Node");
  console.error(
    "process. Mutating process.env in a request handler leaks state to",
  );
  console.error(
    "every other in-flight request. The 'restore' line at the end of a",
  );
  console.error(
    "handler does not help — a second request races between the set and",
  );
  console.error("the restore.");
  console.error("");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}:${v.col}`);
    if (v.snippet) console.error(`    ${v.snippet}`);
  }
  console.error("");
  console.error(bar);
  console.error("Fix:");
  console.error("");
  console.error(
    "  - Use `runWithRequestContext({ userEmail, orgId, timezone }, fn)`",
  );
  console.error(
    "    from `@agent-native/core/server`. Inside `fn`, the framework",
  );
  console.error("    helpers (`getRequestUserEmail`, `getRequestOrgId`,");
  console.error(
    "    `accessFilter`, `assertAccess`, …) read from AsyncLocalStorage,",
  );
  console.error("    which IS per-request safe.");
  console.error(
    "  - For test setup, move env mutations into `*.spec.ts` / `*.test.ts`",
  );
  console.error("    files (those are allowlisted by this guard).");
  console.error(
    "  - For CLI / build / scaffold scripts, put the file under `scripts/`,",
  );
  console.error("    `packages/cli/`, or a `/cli/` subdirectory.");
  console.error("");
  console.error("  Last-resort opt-out (requires reviewer approval):");
  console.error(
    "    process.env.X = y // guard:allow-env-mutation — explain why",
  );
  console.error(`${bar}\n`);
  process.exit(1);
}

console.log(
  "guard-no-env-mutation: clean (no process.env mutations/deletions in production code).",
);
