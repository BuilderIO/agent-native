#!/usr/bin/env node
/**
 * guard-ssr-cache-shell.mjs
 *
 * Defensive CI guard: make the SSR public-cache-shell contract impossible to
 * regress silently.
 *
 * Background: every SSR HTML response and every React Router `.data` response
 * is ONE impersonal, public, hard-CDN-cached shell served identically to every
 * visitor, logged in or not. `createH3SSRHandler` in
 * packages/core/src/server/ssr-handler.ts deliberately strips cookies/
 * authorization before rendering and pins an anonymous request context, then
 * `applyDefaultSsrCacheHeader` stamps the same `DEFAULT_SSR_CACHE_HEADERS`
 * policy on every response. ALL personalization (who's logged in, private
 * records, access checks) happens CLIENT-SIDE after load. Agents keep
 * regressing this — reading a session/cookie on the SSR path, setting
 * `private`/`no-store`/`Vary: Cookie`, or adding a cache-overwrite escape
 * hatch — which makes the page uncacheable for every logged-in visitor (slow,
 * expensive) or, worse, leaks one user's per-request output into a CDN-shared
 * cache key that other visitors read. See the boxed comment above
 * `applyDefaultSsrCacheHeader` in ssr-handler.ts, the `authentication` and
 * `performance` skills, and packages/core/src/server/ssr-handler.spec.ts
 * (which enforces the same contract at runtime and must not be weakened
 * either).
 *
 * Detection logic:
 *
 *   A. packages/core/src/shared/cache-control.ts — statically resolve the
 *      `DEFAULT_SSR_CACHE_CONTROL` export (following simple
 *      `export const X = Y;` alias chains, e.g. it currently aliases
 *      `DEFAULT_PUBLIC_CACHE_CONTROL`) down to its string literal. FAIL if
 *      the resolved value does not contain both "public" and
 *      "stale-while-revalidate", or if it contains any of "no-store",
 *      "private", "must-revalidate", "max-age=0". This is the "someone
 *      turned browser caching back off" regression.
 *
 *   B. packages/core/src/server/ssr-handler.ts — FAIL on any of:
 *        - a `getSession(`, `getCookie(`, or `parseCookies(` call
 *        - a string literal containing "no-store"
 *        - a string literal containing the word "private"
 *        - the escape-hatch shapes `headers.has("cache-control")` or
 *          `.includes("private" | "no-store")`
 *      Also FAIL if the identifiers `applyDefaultSsrCacheHeader` or
 *      `requestForAnonymousSsr` are missing entirely — those are the
 *      structural enforcement; their absence means someone gutted the
 *      handler rather than adjusted it.
 *
 *   C. packages/core/src/deploy/build.ts — the same forbidden patterns as B.
 *      This file generates the Cloudflare Worker as a big template-literal
 *      string (search for the `return \`` blocks); the forbidden patterns
 *      apply inside those template literals too — that is exactly where the
 *      July 10 regression landed, because it never touched the Nitro/H3 path
 *      that guard B protects. Presence check: `requestForAnonymousSsr` must
 *      still appear in the generated worker source.
 *
 *   D. packages/core/src/server/auth.ts — presence check only: must contain
 *      `...DEFAULT_SSR_CACHE_HEADERS` (the login HTML shell spreads the same
 *      public cache policy as the SSR path).
 *
 *   E. templates/*\/server/routes/[...page].get.ts — every template's SSR
 *      catch-all route (the literal filename `[...page].get.ts`; directories
 *      are walked with `fs.readdirSync`, never shell globs, because the `[`
 *      is a literal character here, not a glob class). After the same
 *      comment-aware scan as B/C, FAIL on:
 *        - a `getSession(`, `getCookie(`, or `parseCookies(` call
 *        - a string literal containing "no-store"
 *        - a line that sets a Cache-Control-ish header AND mentions "private"
 *        - a line that sets a Vary header AND mentions "cookie" or
 *          "authorization"
 *      `packages/core/corpus/` is a generated snapshot mirror of `templates/`
 *      (built for agent retrieval) and is skipped entirely — it is not the
 *      live template source.
 *
 * Comment handling: this guard does not attempt real tokenization or full
 * `/* … *\/` block-comment stripping across a whole file. build.ts embeds a
 * literal Cloudflare Worker source (including its own `/* … *\/`-shaped
 * strings such as glob patterns and `"/* /.netlify/functions/server 200"`)
 * inside template literals, so a naive multi-line block-comment stripper can
 * mispair delimiters and either swallow real code or miss real violations.
 * Instead, each match is checked against its own source line: a match is
 * ignored when that line, trimmed, starts with `//`, `*`, or `/*` (the same
 * `isCommentLine` convention as guard-no-localhost-fallback.mjs). This
 * correctly skips full-line `//` comments and every line of a `/** … *\/`
 * JSDoc-style block (this codebase consistently prefixes continuation lines
 * with `*`, including the boxed warning above `applyDefaultSsrCacheHeader`),
 * at the cost of not catching a forbidden literal hidden inside a trailing
 * `code(); // literal` comment. That trade-off was verified against the
 * current contents of every file this guard reads before shipping.
 *
 * Opt-out pragma (same line OR the line immediately above a flagged match):
 *
 *   headers.set("cache-control", "private") // guard:allow-ssr-shell-exception — reason
 *
 * The marker must include "guard:allow-ssr-shell-exception" and a reason
 * (separated by "—" or "-"). Exceptions to this rule require explicit
 * sign-off from the repo owner — this exact contract (public, anonymous,
 * hard-CDN-cached SSR shell) has been silently regressed multiple times, so
 * treat any opt-out request as something to flag for review, not to grant
 * casually.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const CACHE_CONTROL_FILE = "packages/core/src/shared/cache-control.ts";
const SSR_HANDLER_FILE = "packages/core/src/server/ssr-handler.ts";
const DEPLOY_BUILD_FILE = "packages/core/src/deploy/build.ts";
const AUTH_FILE = "packages/core/src/server/auth.ts";
const TEMPLATES_DIR = "templates";
const CATCH_ALL_FILENAME = "[...page].get.ts";

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
  // Generated package corpus mirrors templates/ for agent retrieval — not
  // the live template source. See the header comment.
  "corpus",
  ".claude",
  "coverage",
]);

const OPT_OUT_MARKER = /\/\/\s*guard:allow-ssr-shell-exception\b[^\n]*/;
const OPT_OUT_REQUIRES_REASON =
  /\/\/\s*guard:allow-ssr-shell-exception\s*[—-]\s*\S/;

// ─── Shared helpers ─────────────────────────────────────────────────────

function readFileSafe(absPath) {
  try {
    return readFileSync(absPath, "utf8");
  } catch {
    return null;
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

function walkForFilename(dir, targetName) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const results = [];
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkForFilename(full, targetName));
    } else if (entry.isFile() && entry.name === targetName) {
      results.push(full);
    }
  }
  return results;
}

// ─── Forbidden-pattern scanning (checks B, C, E) ───────────────────────

const CALL_PATTERNS = [
  { name: "getSession( call on the SSR path", re: /\bgetSession\s*\(/g },
  { name: "getCookie( call on the SSR path", re: /\bgetCookie\s*\(/g },
  { name: "parseCookies( call on the SSR path", re: /\bparseCookies\s*\(/g },
];

// Any quoted/template string literal containing "no-store".
const NO_STORE_LITERAL_RE = /["'`][^"'`]*\bno-store\b[^"'`]*["'`]/g;

// Any quoted/template string literal containing the word "private". Verified
// against the current contents of ssr-handler.ts and deploy/build.ts: the
// only "private" occurrences in either file live inside the boxed JSDoc
// comment above applyDefaultSsrCacheHeader, which isCommentLine already
// skips line-by-line.
const PRIVATE_LITERAL_RE = /["'`][^"'`]*\bprivate\b[^"'`]*["'`]/g;

// Escape hatches seen in past regressions: branching on whether a
// cache-control header was already set, or on a "private"/"no-store"
// substring check, to selectively skip the shared public policy.
const HEADERS_HAS_CACHE_CONTROL_RE =
  /headers\.has\(\s*["'`]cache-control["'`]\s*\)/gi;
const INCLUDES_ESCAPE_RE =
  /\.includes\(\s*["'`](?:private|no-store)["'`]\s*\)/g;

function scanCoreFile(rel, content) {
  const lines = content.split("\n");
  const violations = [];
  const patterns = [
    ...CALL_PATTERNS,
    { name: 'string literal containing "no-store"', re: NO_STORE_LITERAL_RE },
    {
      name: 'string literal containing "private"',
      re: PRIVATE_LITERAL_RE,
    },
    {
      name: 'escape hatch: headers.has("cache-control")',
      re: HEADERS_HAS_CACHE_CONTROL_RE,
    },
    {
      name: 'escape hatch: .includes("private" | "no-store")',
      re: INCLUDES_ESCAPE_RE,
    },
  ];
  for (const { name, re } of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      const { line, col } = lineColForOffset(content, m.index);
      const lineText = lines[line - 1] ?? "";
      if (isCommentLine(lineText)) continue;
      if (!hasValidOptOut(lines, line - 1)) {
        violations.push({
          file: rel,
          line,
          col,
          rule: name,
          snippet: lineText.trim(),
        });
      }
      if (re.lastIndex === m.index) re.lastIndex++;
    }
  }
  return violations;
}

function scanTemplateCatchAll(rel, content) {
  const lines = content.split("\n");
  const violations = [];
  const patterns = [
    ...CALL_PATTERNS,
    { name: 'string literal containing "no-store"', re: NO_STORE_LITERAL_RE },
  ];
  for (const { name, re } of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      const { line, col } = lineColForOffset(content, m.index);
      const lineText = lines[line - 1] ?? "";
      if (isCommentLine(lineText)) continue;
      if (!hasValidOptOut(lines, line - 1)) {
        violations.push({
          file: rel,
          line,
          col,
          rule: name,
          snippet: lineText.trim(),
        });
      }
      if (re.lastIndex === m.index) re.lastIndex++;
    }
  }
  // Line-based heuristics: a Cache-Control-ish header set with "private", or
  // a Vary header whose literal mentions cookie/authorization.
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    if (isCommentLine(lineText)) continue;
    if (/cache-control/i.test(lineText) && /\bprivate\b/i.test(lineText)) {
      if (!hasValidOptOut(lines, i)) {
        violations.push({
          file: rel,
          line: i + 1,
          col: 1,
          rule: "Cache-Control header set with private",
          snippet: lineText.trim(),
        });
      }
    }
    if (
      /\bvary\b/i.test(lineText) &&
      (/\bcookie\b/i.test(lineText) || /\bauthorization\b/i.test(lineText))
    ) {
      if (!hasValidOptOut(lines, i)) {
        violations.push({
          file: rel,
          line: i + 1,
          col: 1,
          rule: "Vary header mentions cookie/authorization",
          snippet: lineText.trim(),
        });
      }
    }
  }
  return violations;
}

function requireIdentifiers(rel, content, identifiers) {
  const violations = [];
  for (const id of identifiers) {
    if (!new RegExp(`\\b${id}\\b`).test(content)) {
      violations.push({
        file: rel,
        message: `missing required identifier "${id}" — this is part of the structural SSR cache-shell enforcement; its absence means the handler was gutted rather than adjusted`,
      });
    }
  }
  return violations;
}

// ─── Check A: cache-control.ts ─────────────────────────────────────────

function extractConstValue(content, name, depth = 0) {
  if (depth > 5) {
    return {
      error: `alias chain resolving "${name}" is too deep (possible cycle)`,
    };
  }
  const re = new RegExp(
    `export const ${name}\\s*=\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|'((?:[^'\\\\]|\\\\.)*)'|\`((?:[^\`\\\\]|\\\\.)*)\`|([A-Za-z_$][\\w$]*))\\s*;`,
  );
  const m = content.match(re);
  if (!m) {
    return {
      error: `could not find "export const ${name} = ...;" (string literal or simple alias) in ${CACHE_CONTROL_FILE}`,
    };
  }
  const [, dq, sq, bt, ident] = m;
  if (dq !== undefined) return { value: dq };
  if (sq !== undefined) return { value: sq };
  if (bt !== undefined) return { value: bt };
  if (ident !== undefined) return extractConstValue(content, ident, depth + 1);
  return { error: `unexpected form for "export const ${name} = ...;"` };
}

function checkCacheControl() {
  const abs = path.join(REPO_ROOT, CACHE_CONTROL_FILE);
  const content = readFileSafe(abs);
  if (content === null) {
    return [{ file: CACHE_CONTROL_FILE, message: "file not found" }];
  }

  const resolved = extractConstValue(content, "DEFAULT_SSR_CACHE_CONTROL");
  if (resolved.error) {
    return [{ file: CACHE_CONTROL_FILE, message: resolved.error }];
  }

  const value = resolved.value;
  const violations = [];
  const mustInclude = ["public", "stale-while-revalidate"];
  const mustExclude = ["no-store", "private", "must-revalidate", "max-age=0"];

  for (const needle of mustInclude) {
    if (!value.includes(needle)) {
      violations.push({
        file: CACHE_CONTROL_FILE,
        message: `DEFAULT_SSR_CACHE_CONTROL resolves to "${value}", which is missing required "${needle}"`,
      });
    }
  }
  for (const needle of mustExclude) {
    if (value.includes(needle)) {
      violations.push({
        file: CACHE_CONTROL_FILE,
        message: `DEFAULT_SSR_CACHE_CONTROL resolves to "${value}", which contains forbidden "${needle}"`,
      });
    }
  }
  return violations;
}

// ─── Check B: ssr-handler.ts ────────────────────────────────────────────

function checkSsrHandler() {
  const abs = path.join(REPO_ROOT, SSR_HANDLER_FILE);
  const content = readFileSafe(abs);
  if (content === null) {
    return [{ file: SSR_HANDLER_FILE, message: "file not found" }];
  }
  return [
    ...scanCoreFile(SSR_HANDLER_FILE, content),
    ...requireIdentifiers(SSR_HANDLER_FILE, content, [
      "applyDefaultSsrCacheHeader",
      "requestForAnonymousSsr",
    ]),
  ];
}

// ─── Check C: deploy/build.ts ────────────────────────────────────────────

function checkDeployBuild() {
  const abs = path.join(REPO_ROOT, DEPLOY_BUILD_FILE);
  const content = readFileSafe(abs);
  if (content === null) {
    return [{ file: DEPLOY_BUILD_FILE, message: "file not found" }];
  }
  return [
    ...scanCoreFile(DEPLOY_BUILD_FILE, content),
    ...requireIdentifiers(DEPLOY_BUILD_FILE, content, [
      "requestForAnonymousSsr",
    ]),
  ];
}

// ─── Check D: auth.ts ─────────────────────────────────────────────────

function checkAuth() {
  const abs = path.join(REPO_ROOT, AUTH_FILE);
  const content = readFileSafe(abs);
  if (content === null) {
    return [{ file: AUTH_FILE, message: "file not found" }];
  }
  if (!/\.\.\.DEFAULT_SSR_CACHE_HEADERS\b/.test(content)) {
    return [
      {
        file: AUTH_FILE,
        message:
          'missing "...DEFAULT_SSR_CACHE_HEADERS" — the login HTML shell must spread the same public SSR cache policy as the main SSR path',
      },
    ];
  }
  return [];
}

// ─── Check E: template SSR catch-alls ──────────────────────────────────

function checkTemplateCatchAlls() {
  const templatesAbs = path.join(REPO_ROOT, TEMPLATES_DIR);
  let templateEntries;
  try {
    templateEntries = readdirSync(templatesAbs, { withFileTypes: true });
  } catch {
    return [];
  }

  const violations = [];
  for (const entry of templateEntries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const routesDir = path.join(templatesAbs, entry.name, "server", "routes");
    const files = walkForFilename(routesDir, CATCH_ALL_FILENAME);
    for (const abs of files) {
      const rel = path.relative(REPO_ROOT, abs).replaceAll("\\", "/");
      const content = readFileSafe(abs);
      if (content === null) continue;
      violations.push(...scanTemplateCatchAll(rel, content));
    }
  }
  return violations;
}

// ─── Main ─────────────────────────────────────────────────────────────

const violations = [
  ...checkCacheControl(),
  ...checkSsrHandler(),
  ...checkDeployBuild(),
  ...checkAuth(),
  ...checkTemplateCatchAlls(),
];

if (violations.length > 0) {
  const bar = "=".repeat(72);
  console.error(`\n${bar}`);
  console.error(
    "ERROR: SSR public-cache-shell contract violation(s) detected.",
  );
  console.error(bar);
  console.error(`
SSR HTML and React Router \`.data\` responses are ONE impersonal, public,
hard-CDN-cached shell served IDENTICALLY to every visitor, logged in or not.
ALL personalization (who's logged in, private records, access checks) is
resolved CLIENT-SIDE after load, never baked into the SSR response.

That means the SSR path must NEVER:
  - read the request's session or cookies (\`getSession(\`, \`getCookie(\`,
    \`parseCookies(\`)
  - set \`private\`, \`no-store\`, or \`Vary: Cookie\` / \`Vary: Authorization\`
  - branch around the shared cache policy with an escape hatch like
    \`headers.has("cache-control")\` or \`.includes("private" | "no-store")\`

This has been silently regressed multiple times — most recently in the
generated Cloudflare Worker template in deploy/build.ts on July 10, which
never touched the Nitro/H3 path and so slipped past manual review. See the
boxed comment above \`applyDefaultSsrCacheHeader\` in
packages/core/src/server/ssr-handler.ts, the \`authentication\` and
\`performance\` skills under .agents/skills/, and
packages/core/src/server/ssr-handler.spec.ts — which enforces this same
contract at runtime and must not be weakened either.

Violations:
`);
  for (const v of violations) {
    if (v.line) {
      console.error(`  ${v.file}:${v.line}:${v.col} — ${v.rule}`);
      if (v.snippet) console.error(`    ${v.snippet}`);
    } else {
      console.error(`  ${v.file} — ${v.message}`);
    }
  }
  console.error(`
Fix: move the per-user logic client-side, or restore the shared public
\`DEFAULT_SSR_CACHE_HEADERS\` policy instead of overriding it.

Last-resort opt-out (same line or the line immediately above a flagged
match) — this requires EXPLICIT SIGN-OFF FROM THE REPO OWNER, because this
exact contract has already been regressed repeatedly:

  headers.set("cache-control", "private") // guard:allow-ssr-shell-exception — explain why
`);
  console.error(bar);
  process.exit(1);
}

console.log(
  "guard-ssr-cache-shell: clean (SSR HTML/.data stays a public, anonymous, hard-CDN-cached shell).",
);
