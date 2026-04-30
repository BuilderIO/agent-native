#!/usr/bin/env node
/**
 * guard-no-env-credentials.mjs
 *
 * Defensive CI guard: refuse to let user-credential code paths read
 * `process.env.<KEY>` for any key other than an explicit allowlist of
 * deployment-level (host / framework) env vars.
 *
 * Background (2026-04-29 incident — credential leak): `resolveCredential(key)`
 * in `packages/core/src/credentials/index.ts` first read `process.env[key]`
 * and then fell back to a global `settings` row. Both sources were
 * unscoped, so every signed-in user inherited the deployment's credentials
 * (BigQuery, Apollo, Amplitude, etc.). Steve's directive: make sure this
 * NEVER HAPPENS AGAIN — catch it in CI before it lands.
 *
 * The principle: user credentials are per-user (or per-org) data. They
 * MUST live in SQL, scoped by `userEmail` / `orgId`, never in process.env.
 * Deploy-level env vars (DATABASE_URL, BETTER_AUTH_SECRET, etc.) are not
 * user credentials and remain fine — the allowlist captures that
 * distinction.
 *
 * This script scans the credentials / secrets / vault code paths for any
 * `process.env.<KEY>` / `process.env["KEY"]` read whose key is NOT in
 * the allowlist, plus any dynamic `process.env[key]` read. Dynamic reads
 * cannot be allowlisted safely because the key is only known at runtime.
 * Any non-allowlisted hit is a violation.
 *
 * Last-resort opt-out (requires reviewer approval):
 *
 *   process.env.SOMETHING // guard:allow-env-credential — short reason
 *
 * The marker may be on the same line, or on the line immediately above.
 */

import { readFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
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

/**
 * Allowlist of env var names that are deployment-level config, NOT user
 * credentials. These may continue to be read via process.env in any
 * credential code path.
 *
 * Patterns: an entry is either an exact name or a prefix string ending in
 * `_` (treated as `STARTSWITH`).
 */
const ALLOWLIST_EXACT = new Set([
  // Database
  "DATABASE_URL",
  "DATABASE_AUTH_TOKEN",
  // Node / CI runtime
  "NODE_ENV",
  "CI",
  "DEBUG",
  // Better-auth
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  // Framework auth gate
  "ACCESS_TOKEN",
  // Server bind
  "PORT",
  "HOST",
  // Deploy-level master key for the per-user secrets vault.
  // NOT a user credential — it's the symmetric key the vault uses to
  // encrypt user secrets at rest. Rotating it invalidates the entire
  // vault, so it lives at deployment scope.
  "SECRETS_ENCRYPTION_KEY",
]);

const ALLOWLIST_PREFIX = [
  "npm_",
  "AGENT_NATIVE_",
  "AGENT_",
  "NETLIFY_",
  "VERCEL_",
  "CF_",
];

/**
 * Dev-only paths where ANTHROPIC_API_KEY etc. may legitimately be read
 * from env (local dev tooling, scripts, tests). The guard only honors the
 * `// guard:allow-env-credential — dev-only` marker inside these paths.
 */
const DEV_ONLY_PATH_PATTERNS = [
  /^packages\/core\/src\/dev/,
  /\.spec\.[tj]sx?$/,
  /\.test\.[tj]sx?$/,
  /^scripts\//,
];

const DEV_ONLY_KEYS = new Set(["ANTHROPIC_API_KEY"]);

/**
 * Globs of files / directories the guard scans. A path matches if any
 * predicate returns true.
 */
const FORBIDDEN_PATH_PREDICATES = [
  // packages/core credentials/secrets/vault subtrees
  (rel) => /^packages\/core\/src\/credentials\//.test(rel),
  (rel) => /^packages\/core\/src\/secrets\//.test(rel),
  (rel) => /^packages\/core\/src\/vault\//.test(rel),
  // packages/core agent subtree — `getOwnerActiveApiKey` resolves the
  // current user's provider API key and historically fell back to
  // `process.env[envVar]` (dynamic key). On a multi-tenant deploy that
  // silently substituted the deploy-level key for every user, exactly
  // the prior-incident pattern. The fix in production-agent.ts gates
  // the env-fallback on `isMultiTenantDeploy()`, but the guard catches
  // any future regression at CI time.
  (rel) => /^packages\/core\/src\/agent\//.test(rel),
  // template credential libs
  (rel) => /^templates\/[^/]+\/server\/lib\/credential[^/]*\.ts$/.test(rel),
  // template credential routes (single + plural)
  (rel) =>
    /^templates\/[^/]+\/server\/routes\/api\/credential[^/]*$/.test(rel) ||
    /^templates\/[^/]+\/server\/routes\/api\/credential[^/]*\.[tj]sx?$/.test(
      rel,
    ),
  (rel) =>
    /^templates\/[^/]+\/server\/routes\/api\/credentials[^/]*$/.test(rel) ||
    /^templates\/[^/]+\/server\/routes\/api\/credentials[^/]*\.[tj]sx?$/.test(
      rel,
    ),
];

const OPT_OUT_MARKER = /\/\/\s*guard:allow-env-credential\b[^\n]*/;
const OPT_OUT_REQUIRES_REASON = /\/\/\s*guard:allow-env-credential\s*[—-]\s*\S/;

// process.env.FOO  or  process.env["FOO"]  or  process.env['FOO']
// Captures the upper-cased key. We deliberately ignore lowercase / mixed
// case names — env vars are conventionally upper case and the credential
// keys we care about (BIGQUERY_*, AMPLITUDE_*, ANTHROPIC_API_KEY, etc.)
// are all upper case.
const ENV_READ_REGEX =
  /process\.env(?:\.([A-Z][A-Z0-9_]*)|\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\])/g;

// process.env[key] or process.env?.[key]
// Dynamic keys were the original leak shape (`process.env[key]` inside
// resolveCredential), and literal-only regexes miss them entirely.
const ENV_DYNAMIC_READ_REGEX =
  /process\.env(?:\?\.)?\s*\[\s*(?!["'])([^\]\n]+?)\s*\]/g;

function isAllowlistedKey(key) {
  if (ALLOWLIST_EXACT.has(key)) return true;
  for (const prefix of ALLOWLIST_PREFIX) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

function isDevOnlyPath(rel) {
  return DEV_ONLY_PATH_PATTERNS.some((re) => re.test(rel));
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
      yield full;
    }
  }
}

function pathIsForbidden(rel) {
  return FORBIDDEN_PATH_PREDICATES.some((p) => p(rel));
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

function hasOptOutOnLine(lines, lineIdx) {
  const cur = lines[lineIdx] ?? "";
  if (OPT_OUT_MARKER.test(cur)) return true;
  const prev = lines[lineIdx - 1] ?? "";
  // Opt-out is only valid on the same line OR the line immediately above
  // (and the line above must be a comment).
  if (/^\s*\/\//.test(prev) && OPT_OUT_MARKER.test(prev)) return true;
  return false;
}

function optOutOnLineIsValid(lines, lineIdx, key, rel) {
  const cur = lines[lineIdx] ?? "";
  const prev = lines[lineIdx - 1] ?? "";
  const candidate = OPT_OUT_REQUIRES_REASON.test(cur)
    ? cur
    : OPT_OUT_REQUIRES_REASON.test(prev)
      ? prev
      : null;
  if (!candidate) return { ok: false, why: "missing or empty reason" };

  // Dev-only opt-out: only valid in DEV_ONLY_PATH_PATTERNS for DEV_ONLY_KEYS.
  if (/dev-only\b/i.test(candidate)) {
    if (!DEV_ONLY_KEYS.has(key)) {
      return {
        ok: false,
        why: `key "${key}" is not in the dev-only credential allowlist`,
      };
    }
    if (!isDevOnlyPath(rel)) {
      return {
        ok: false,
        why: "dev-only opt-out used outside dev / scripts / test paths",
      };
    }
  }
  return { ok: true };
}

async function scan() {
  const violations = [];
  for await (const file of walk(REPO_ROOT)) {
    if (!/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(file)) continue;
    if (file.endsWith(".d.ts")) continue;
    const rel = path.relative(REPO_ROOT, file).replaceAll("\\", "/");
    if (!pathIsForbidden(rel)) continue;

    let contents;
    try {
      contents = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!contents.includes("process.env")) continue;

    const lines = contents.split("\n");
    ENV_READ_REGEX.lastIndex = 0;
    let m;
    while ((m = ENV_READ_REGEX.exec(contents)) !== null) {
      const key = m[1] ?? m[2];
      if (!key) continue;
      if (isAllowlistedKey(key)) continue;
      const { line, col } = lineColForOffset(contents, m.index);
      const lineIdx = line - 1;
      // Skip matches inside comment lines so docstrings explaining a
      // dangerous pattern (e.g. "do NOT do `process.env.X`") don't
      // trip the guard. Same posture the dynamic-regex pass below uses.
      const lineText = lines[lineIdx] ?? "";
      const trimmedLine = lineText.trimStart();
      if (
        trimmedLine.startsWith("*") ||
        trimmedLine.startsWith("//") ||
        trimmedLine.startsWith("/*")
      ) {
        continue;
      }
      if (hasOptOutOnLine(lines, lineIdx)) {
        const verdict = optOutOnLineIsValid(lines, lineIdx, key, rel);
        if (verdict.ok) continue;
        violations.push({
          file: rel,
          line,
          col,
          key,
          reason: `opt-out invalid: ${verdict.why}`,
          snippet: lines[lineIdx]?.trim() ?? "",
        });
        continue;
      }
      violations.push({
        file: rel,
        line,
        col,
        key,
        reason: "not in allowlist",
        snippet: lines[lineIdx]?.trim() ?? "",
      });
    }

    ENV_DYNAMIC_READ_REGEX.lastIndex = 0;
    while ((m = ENV_DYNAMIC_READ_REGEX.exec(contents)) !== null) {
      const { line, col } = lineColForOffset(contents, m.index);
      const lineIdx = line - 1;
      const lineText = lines[lineIdx] ?? "";
      const trimmed = lineText.trimStart();
      if (
        trimmed.startsWith("*") ||
        trimmed.startsWith("//") ||
        trimmed.startsWith("/*")
      ) {
        continue;
      }
      if (hasOptOutOnLine(lines, lineIdx)) {
        const verdict = optOutOnLineIsValid(lines, lineIdx, "<dynamic>", rel);
        if (verdict.ok) continue;
        violations.push({
          file: rel,
          line,
          col,
          key: "<dynamic>",
          reason: `opt-out invalid: ${verdict.why}`,
          snippet: lineText.trim(),
        });
        continue;
      }
      violations.push({
        file: rel,
        line,
        col,
        key: "<dynamic>",
        reason: "dynamic process.env key in credential path",
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
    "ERROR: forbidden process.env.<KEY> read in a credential code path.",
  );
  console.error(bar);
  console.error("");
  console.error(
    "User credentials must NEVER come from process.env in production.",
  );
  console.error(
    "On 2026-04-29, `resolveCredential(key)` read `process.env[key]`",
  );
  console.error(
    "unscoped, leaking the deployment's API keys to every signed-in",
  );
  console.error("user. User credentials live in SQL, scoped per-user");
  console.error("(`u:<email>:credential:KEY`) or per-org");
  console.error("(`o:<orgId>:credential:KEY`).");
  console.error("");
  for (const v of violations) {
    console.error(
      `  ${v.file}:${v.line}:${v.col}  process.env.${v.key} — reason: ${v.reason}`,
    );
    if (v.snippet) console.error(`    ${v.snippet}`);
  }
  console.error("");
  console.error(bar);
  console.error("Fix:");
  console.error("");
  console.error(
    "  - Read credentials via `resolveCredential(key, { userEmail, orgId })`",
  );
  console.error("    from `@agent-native/core/credentials`.");
  console.error(
    "  - If a value is genuinely deploy-level config (host secret,",
  );
  console.error("    framework token, CI flag), it does not belong in the");
  console.error(
    "    credentials/secrets/vault paths — move the read elsewhere.",
  );
  console.error("");
  console.error("  Allowlisted env keys (still ok to read here):");
  console.error(
    `    ${[...ALLOWLIST_EXACT].sort().join(", ")}, ` +
      `${ALLOWLIST_PREFIX.map((p) => p + "*").join(", ")}`,
  );
  console.error("");
  console.error("  Last-resort opt-out (requires reviewer approval):");
  console.error(
    "    process.env.X // guard:allow-env-credential — explain why",
  );
  console.error(`${bar}\n`);
  process.exit(1);
}

console.log(
  "guard-no-env-credentials: clean (no forbidden process.env reads in credential paths).",
);
