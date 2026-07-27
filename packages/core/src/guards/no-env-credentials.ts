/**
 * scanEnvCredentials — ported from `scripts/guard-no-env-credentials.mjs`.
 *
 * User credentials are per-user (or per-org) data. They MUST live in SQL,
 * scoped by `userEmail` / `orgId`, never in `process.env` — a deployment's
 * env vars are shared by every signed-in user. This guard flags any
 * `process.env.<KEY>` / `process.env["KEY"]` read whose key is not on the
 * deploy-level allowlist (`DATABASE_URL`, `BETTER_AUTH_SECRET`, etc.), plus
 * any dynamic `process.env[key]` read (the key is only known at runtime, so
 * it can never be allowlisted safely).
 *
 * Conditional guard — per report 005's V1 guard set table, this is "the big
 * one": the original only scans a curated set of monorepo subtrees
 * (`packages/core/src/{credentials,secrets,vault,agent}/`, template
 * credential libs/routes) via `FORBIDDEN_PATH_PREDICATES` — none of which
 * exist in a generated app, so nothing would ever be scanned. This port
 * replaces that default-allow-outside-a-curated-subtree behavior with
 * default-deny across the whole app source tree: every `process.env.<KEY>`
 * read anywhere in app source must be on the deploy-var allowlist (kept
 * verbatim) or carry the opt-out marker. `HIGH_RISK_ENV_KEY_ALLOWLIST`,
 * `HIGH_RISK_PROCESS_ENV_ALLOWLIST`, and `HIGH_RISK_ENV_VARS_WRITE_ALLOWLIST`
 * — the three monorepo-file-keyed exception maps for specific template
 * platform-adapter files — are dropped entirely per the report; with
 * default-deny scanning already covering every `process.env` read
 * everywhere, the narrower `env-config.ts`/`core-routes.ts`-specific
 * registration checks those maps supported become redundant (any
 * high-risk key would already be caught by the general scan) and are
 * dropped along with them. The per-line `// guard:allow-env-credential`
 * marker remains the only escape hatch.
 *
 * Opt-out (same line, or the line immediately above):
 *   process.env.SOMETHING // guard:allow-env-credential — short reason
 */

import {
  lineColForOffset,
  readFileSafe,
  relPosix,
  walk,
} from "./scan-utils.js";
import type { GuardFinding, GuardResult, GuardScanOptions } from "./types.js";

const ALLOWLIST_EXACT = new Set([
  "DATABASE_URL",
  "DATABASE_AUTH_TOKEN",
  "NODE_ENV",
  "CI",
  "DEBUG",
  "NETLIFY",
  "VERCEL",
  "RENDER",
  "FLY_APP_NAME",
  "K_SERVICE",
  "AWS_LAMBDA_FUNCTION_NAME",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "NOTION_CLIENT_ID",
  "NOTION_CLIENT_SECRET",
  "NOTION_STATE_SECRET",
  "GOOGLE_SIGN_IN_CLIENT_ID",
  "GOOGLE_SIGN_IN_CLIENT_SECRET",
  "AUTH_SECRET",
  "A2A_SECRET",
  "ACCESS_TOKEN",
  "PORT",
  "HOST",
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

/** Dev-only paths where ANTHROPIC_API_KEY etc. may legitimately be read
 * from env (local dev tooling, scripts, tests). Portable subset of the
 * original — the monorepo-only `packages/core/src/dev` predicate is
 * dropped (see report 005's V1 guard set table). */
const DEV_ONLY_PATH_PATTERNS = [
  /\.spec\.[tj]sx?$/,
  /\.test\.[tj]sx?$/,
  /^scripts\//,
];

const DEV_ONLY_KEYS = new Set(["ANTHROPIC_API_KEY"]);

const OPT_OUT_MARKER = /\/\/\s*guard:allow-env-credential\b[^\n]*/;
const OPT_OUT_REQUIRES_REASON = /\/\/\s*guard:allow-env-credential\s*[—-]\s*\S/;

const ENV_READ_REGEX =
  /process\.env(?:\.([A-Z][A-Z0-9_]*)|\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\])/g;

const ENV_DYNAMIC_READ_REGEX =
  /process\.env(?:\?\.)?\s*\[\s*(?!["'])([^\]\n]+?)\s*\]/g;

function isAllowlistedKey(key: string): boolean {
  if (ALLOWLIST_EXACT.has(key)) return true;
  return ALLOWLIST_PREFIX.some((prefix) => key.startsWith(prefix));
}

function isDevOnlyPath(rel: string): boolean {
  return DEV_ONLY_PATH_PATTERNS.some((re) => re.test(rel));
}

function hasOptOutOnLine(lines: string[], lineIdx: number): boolean {
  const cur = lines[lineIdx] ?? "";
  if (OPT_OUT_MARKER.test(cur)) return true;
  const prev = lines[lineIdx - 1] ?? "";
  if (/^\s*\/\//.test(prev) && OPT_OUT_MARKER.test(prev)) return true;
  return false;
}

function optOutOnLineIsValid(
  lines: string[],
  lineIdx: number,
  key: string,
  rel: string,
): { ok: boolean; why?: string } {
  const cur = lines[lineIdx] ?? "";
  const prev = lines[lineIdx - 1] ?? "";
  const candidate = OPT_OUT_REQUIRES_REASON.test(cur)
    ? cur
    : OPT_OUT_REQUIRES_REASON.test(prev)
      ? prev
      : null;
  if (!candidate) return { ok: false, why: "missing or empty reason" };

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

export function scanEnvCredentials(options: GuardScanOptions): GuardResult {
  const { root } = options;
  const findings: GuardFinding[] = [];

  for (const file of walk(root)) {
    if (!/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(file)) continue;
    if (file.endsWith(".d.ts")) continue;
    const rel = relPosix(root, file);

    const contents = readFileSafe(file);
    if (contents === null || !contents.includes("process.env")) continue;

    const lines = contents.split("\n");

    ENV_READ_REGEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ENV_READ_REGEX.exec(contents)) !== null) {
      const key = m[1] ?? m[2];
      if (!key) continue;
      const { line } = lineColForOffset(contents, m.index);
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
      if (isAllowlistedKey(key)) continue;
      if (hasOptOutOnLine(lines, lineIdx)) {
        const verdict = optOutOnLineIsValid(lines, lineIdx, key, rel);
        if (verdict.ok) continue;
        findings.push({
          file: rel,
          line,
          message: `process.env.${key} opt-out invalid: ${verdict.why}`,
        });
        continue;
      }
      findings.push({
        file: rel,
        line,
        message: `process.env.${key} read — not a deploy-level allowlisted key. User credentials must be read via resolveCredential(key, { userEmail, orgId }), never process.env.`,
      });
    }

    ENV_DYNAMIC_READ_REGEX.lastIndex = 0;
    while ((m = ENV_DYNAMIC_READ_REGEX.exec(contents)) !== null) {
      const { line } = lineColForOffset(contents, m.index);
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
        findings.push({
          file: rel,
          line,
          message: `process.env[<dynamic>] opt-out invalid: ${verdict.why}`,
        });
        continue;
      }
      findings.push({
        file: rel,
        line,
        message: `process.env[<dynamic key>] read — dynamic keys can never be allowlisted safely.`,
      });
    }
  }

  return { name: "no-env-credentials", findings };
}
