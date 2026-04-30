#!/usr/bin/env node
/**
 * guard-no-unscoped-credentials.mjs
 *
 * Defensive CI guard: refuse to let any caller invoke
 * `resolveCredential` / `hasCredential` / `saveCredential` /
 * `deleteCredential` with only one argument. The new contract requires a
 * second argument carrying the per-user / per-org context object —
 * `(key, { userEmail, orgId })` — so the credential lookup is scoped to
 * the requesting principal.
 *
 * Background (2026-04-29 incident — credential leak): the previous one-arg
 * form `resolveCredential(key)` resolved against `process.env[key]` and a
 * global `settings` row, both of which are deployment-wide. Every signed-in
 * user inherited the deployment's credentials. The fix is twofold:
 *
 *   1. Change the API to require a context object.
 *   2. Add this guard so the ban is enforced in CI for every call site —
 *      both old call sites that pre-date the API change, AND any new code
 *      that forgets to pass the context.
 *
 * Last-resort opt-out (requires reviewer approval and a reason):
 *
 *   resolveCredential(key) // guard:allow-unscoped-credential — short reason
 *
 * The marker must be on the same line as the call.
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
  "coverage",
]);

const FUNCTIONS = [
  "resolveCredential",
  "hasCredential",
  "saveCredential",
  "deleteCredential",
];

// Match a call to one of the functions where the parens contain ONLY a
// single argument (no comma at the top level). Allow optional whitespace
// and newlines inside the parens.
//
// We balance parens / braces / brackets / quotes manually below to handle
// arguments like template strings, object literals, nested calls.
const FUNC_NAME_RE = new RegExp(
  `(?<![\\w$.])(${FUNCTIONS.join("|")})\\s*\\(`,
  "g",
);

const OPT_OUT_MARKER =
  /\/\/\s*guard:allow-unscoped-credential\b[^\n]*[—-]\s*\S/;

// Files that legitimately use the one-arg form because they ARE the
// implementation under guard. These are never call-site offenders.
const FILE_ALLOWLIST = new Set([
  "packages/core/src/credentials/index.ts",
  "scripts/guard-no-unscoped-credentials.mjs",
]);

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

/**
 * Starting at openParenIdx (the index of the `(` after the function name),
 * walk forward, balancing nested parens / braces / brackets / strings, and
 * return:
 *   { topLevelCommaCount, endIdx }
 *
 * If the parens never close (truncated file), returns null.
 */
function analyzeArgs(contents, openParenIdx) {
  let depth = 0;
  let topLevelCommas = 0;
  let i = openParenIdx;
  // Track string / template / regex / comment state minimally.
  let mode = "code";
  let templateDepth = 0; // ${ ... } depth inside a template literal
  while (i < contents.length) {
    const ch = contents[i];
    const next = contents[i + 1];
    if (mode === "code") {
      if (ch === "/" && next === "/") {
        // line comment
        while (i < contents.length && contents[i] !== "\n") i++;
        continue;
      }
      if (ch === "/" && next === "*") {
        i += 2;
        while (
          i < contents.length - 1 &&
          !(contents[i] === "*" && contents[i + 1] === "/")
        )
          i++;
        i += 2;
        continue;
      }
      if (ch === '"' || ch === "'") {
        mode = ch;
        i++;
        continue;
      }
      if (ch === "`") {
        mode = "tmpl";
        i++;
        continue;
      }
      if (ch === "(" || ch === "[" || ch === "{") {
        depth++;
        i++;
        continue;
      }
      if (ch === ")" || ch === "]" || ch === "}") {
        depth--;
        if (depth === 0 && ch === ")") {
          return { topLevelCommas, endIdx: i };
        }
        i++;
        continue;
      }
      if (ch === "," && depth === 1) {
        topLevelCommas++;
        i++;
        continue;
      }
      i++;
      continue;
    }
    if (mode === '"' || mode === "'") {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === mode) {
        mode = "code";
        i++;
        continue;
      }
      i++;
      continue;
    }
    if (mode === "tmpl") {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "`" && templateDepth === 0) {
        mode = "code";
        i++;
        continue;
      }
      if (ch === "$" && next === "{") {
        templateDepth++;
        // Treat the inside of ${} as code by re-entering the main loop
        // tracking. Simplest: bump i past `${` and stay in "tmpl"; we
        // approximate by counting matching braces in tmpl mode.
        i += 2;
        continue;
      }
      if (ch === "}" && templateDepth > 0) {
        templateDepth--;
        i++;
        continue;
      }
      i++;
      continue;
    }
    i++;
  }
  return null;
}

async function scan() {
  const violations = [];
  for await (const file of walk(REPO_ROOT)) {
    if (!/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(file)) continue;
    if (file.endsWith(".d.ts")) continue;
    const rel = path.relative(REPO_ROOT, file).replaceAll("\\", "/");
    if (FILE_ALLOWLIST.has(rel)) continue;
    // Only scan source code: packages, templates, app, server, actions,
    // scripts. Skip generated and build outputs (handled by SKIP_DIRS).
    if (
      !/^packages\//.test(rel) &&
      !/^templates\//.test(rel) &&
      !/^app\//.test(rel)
    ) {
      continue;
    }
    let contents;
    try {
      contents = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    // Cheap pre-filter
    let anyHit = false;
    for (const fn of FUNCTIONS) {
      if (contents.includes(fn + "(") || contents.includes(fn + " (")) {
        anyHit = true;
        break;
      }
    }
    if (!anyHit) continue;

    const lines = contents.split("\n");

    FUNC_NAME_RE.lastIndex = 0;
    let m;
    while ((m = FUNC_NAME_RE.exec(contents)) !== null) {
      const fnName = m[1];
      // m.index points to the start of the function name; the `(` is at
      // m.index + match length - 1.
      const openParenIdx = m.index + m[0].length - 1;
      // Skip if this is the function declaration itself (e.g. `export
      // async function resolveCredential(`) — those have `function ` or
      // `async function ` immediately before the name.
      const before = contents.slice(Math.max(0, m.index - 30), m.index);
      if (
        /\bfunction\s+$/.test(before) ||
        /\bexport\s+(default\s+)?(async\s+)?function\s+$/.test(before) ||
        /\b(const|let|var)\s+$/.test(before) // assignment to a local
      ) {
        continue;
      }
      // Skip if the call appears inside a comment (line or block).
      // Cheap check: if the line begins with `*` or `//`, it's a comment.
      const { line } = lineColForOffset(contents, m.index);
      const lineText = lines[line - 1] ?? "";
      const trimmed = lineText.trimStart();
      if (
        trimmed.startsWith("*") ||
        trimmed.startsWith("//") ||
        trimmed.startsWith("/*")
      ) {
        continue;
      }
      const analysis = analyzeArgs(contents, openParenIdx);
      if (!analysis) continue;
      // One-arg call has zero top-level commas. Zero args also has zero
      // commas — but zero args is also broken (no key), so we count it as a
      // violation too.
      if (analysis.topLevelCommas >= 1) continue;
      const { col } = lineColForOffset(contents, m.index);
      if (OPT_OUT_MARKER.test(lineText)) continue;
      violations.push({
        file: rel,
        line,
        col,
        fn: fnName,
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
    "ERROR: unscoped credential call (one-arg form) — must pass context.",
  );
  console.error(bar);
  console.error("");
  console.error("On 2026-04-29 `resolveCredential(key)` was found to read");
  console.error("`process.env[key]` and a global `settings` row, leaking the");
  console.error(
    "deployment's credentials to every signed-in user. The API now",
  );
  console.error("requires a per-user / per-org context object.");
  console.error("");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}:${v.col}  ${v.fn}(...)  one-arg form`);
    if (v.snippet) console.error(`    ${v.snippet}`);
  }
  console.error("");
  console.error(bar);
  console.error("Fix:");
  console.error("");
  console.error("  - Pass the request context as the second argument:");
  console.error("      resolveCredential(key, { userEmail, orgId })");
  console.error(
    "  - Inside an action / auto-mounted route the framework already",
  );
  console.error("    has the request context — read userEmail / orgId from");
  console.error(
    "    `getRequestContext()` (or destructure from the action context).",
  );
  console.error(
    "  - Inside a custom Nitro `/api/*` route, read the session via",
  );
  console.error(
    "    `getSession(event)` and run inside `runWithRequestContext({...})`,",
  );
  console.error(
    "    then call resolveCredential — or pass the context object directly.",
  );
  console.error("");
  console.error("  Last-resort opt-out (requires reviewer approval):");
  console.error(
    "    resolveCredential(key) // guard:allow-unscoped-credential — explain why",
  );
  console.error(`${bar}\n`);
  process.exit(1);
}

console.log(
  "guard-no-unscoped-credentials: clean (every credential call passes context).",
);
