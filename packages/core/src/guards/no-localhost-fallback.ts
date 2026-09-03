/**
 * scanLocalhostFallback — ported from
 * `scripts/guard-no-localhost-fallback.mjs`.
 *
 * Refuse to let production code use the literal `local@localhost` (or the
 * `DEV_MODE_USER_EMAIL` symbolic alias) as a fallback identity when no
 * session is present — that pools every unauthenticated request onto one
 * shared tenant. The right behavior in production is to throw/401 when
 * there's no session, not fall back to a sentinel identity.
 *
 * Conditional guard — per report 005's V1 guard set table: the original
 * hardcodes framework-file exemptions (`packages/core/src/server/auth.ts`,
 * `packages/core/src/org/context.ts`, etc. — files that either define or
 * intentionally handle the dev-mode sentinel). Those live in `node_modules`
 * for a generated app and are already excluded by `SKIP_DIRS`, so they're
 * moved behind an optional `extraExemptPaths` param (default `[]`) instead
 * of hardcoded. The generic allowlist predicates (`*.spec.*`, `*.test.*`,
 * `scripts/**`, `**\/seed(s)/**`) are kept verbatim.
 *
 * Also refuses to let request-handling code answer "who is the caller" with the
 * ambient process identity (`?? process.env.AGENT_USER_EMAIL`,
 * `|| process.env.WORKSPACE_OWNER_EMAIL`, `?? getAmbientUserEmail()`). That
 * shape fails open toward more privilege: an admin gate reading it admits
 * whoever the deploy env names rather than whoever signed in. CLI, cron, seed
 * and test paths are exempt because they have no request by construction.
 *
 * Opt-out (same line, or the line immediately above):
 *   const x = email ?? "local@localhost" // guard:allow-localhost-fallback — short reason
 */

import {
  isCommentLine,
  lineColForOffset,
  readFileSafe,
  relPosix,
  walk,
} from "./scan-utils.js";
import type { GuardFinding, GuardResult, GuardScanOptions } from "./types.js";

export interface LocalhostFallbackOptions extends GuardScanOptions {
  /** Exact repo-relative paths to exempt in addition to the generic
   * predicates (spec/test/scripts/seed). Default `[]`. */
  extraExemptPaths?: string[];
}

const GENERIC_ALLOWED_PATH_PREDICATES: Array<(rel: string) => boolean> = [
  (rel) => /\.spec\.[tj]sx?$/.test(rel),
  (rel) => /\.test\.[tj]sx?$/.test(rel),
  (rel) => /^scripts\//.test(rel),
  (rel) => /\/seed\//.test(rel),
  (rel) => /\/seeds\//.test(rel),
];

const OPT_OUT_MARKER = /\/\/\s*guard:allow-localhost-fallback\b[^\n]*/;
const OPT_OUT_REQUIRES_REASON =
  /\/\/\s*guard:allow-localhost-fallback\s*[—-]\s*\S/;

const LITERAL_RE = /(?:"local@localhost"|'local@localhost'|`local@localhost`)/g;

const SYMBOLIC_FALLBACK_RE = /(?:\?\?|\|\|)\s*DEV_MODE_USER_EMAIL\b/g;

/**
 * Ambient process identity used as a request-scoped fallback:
 *
 *   const email = getRequestUserEmail() ?? process.env.AGENT_USER_EMAIL;
 *   const owner = session?.email || process.env.WORKSPACE_OWNER_EMAIL;
 *
 * These name the identity of the deployment, not the caller, so a request
 * handler reading one authorizes whoever the env names — failing open toward
 * more privilege. Only the `??` / `||` fallback position matches: reading the
 * same env var to build an admin allowlist asks a different, safe question.
 */
const AMBIENT_ENV_FALLBACK_RE =
  /(?:\?\?|\|\|)\s*process\.env\.(?:AGENT_USER_EMAIL|AGENT_ORG_ID|AGENT_USER_NAME|WORKSPACE_OWNER_EMAIL)\b/g;
const AMBIENT_HELPER_FALLBACK_RE =
  /(?:\?\?|\|\|)\s*getAmbient(?:UserEmail|OrgId)\s*\(\s*\)/g;

/** Paths where an ambient identity is correct because no request exists by
 * construction: CLI entrypoints, cron, seed and QA scripts, tests. */
const AMBIENT_ALLOWED_PATH_PREDICATES: Array<(rel: string) => boolean> = [
  (rel) => /(?:^|\/)scripts\//.test(rel),
  (rel) => /(?:^|\/)src\/cli\//.test(rel),
  (rel) => /(?:^|\/)src\/scripts\//.test(rel),
  (rel) => /(?:^|\/)script-(?:helpers|entries)\.ts$/.test(rel),
  (rel) => /\.spec\.[tj]sx?$/.test(rel),
  (rel) => /\.test\.[tj]sx?$/.test(rel),
  (rel) => /\/seed\//.test(rel),
  (rel) => /\/seeds\//.test(rel),
];

const SQL_DEFAULT_RE = /\bDEFAULT\s+['"`]local@localhost['"`]/i;
const DRIZZLE_DEFAULT_RE = /\.default\s*\(\s*['"`]local@localhost['"`]\s*\)/;

function isAllowedPath(rel: string, extraExemptPaths?: string[]): boolean {
  if (extraExemptPaths?.includes(rel)) return true;
  return GENERIC_ALLOWED_PATH_PREDICATES.some((p) => p(rel));
}

function hasValidOptOut(lines: string[], lineIdx: number): boolean {
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

export function scanLocalhostFallback(
  options: LocalhostFallbackOptions,
): GuardResult {
  const { root, extraExemptPaths } = options;
  const findings: GuardFinding[] = [];

  for (const file of walk(root)) {
    if (!/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(file)) continue;
    if (file.endsWith(".d.ts")) continue;
    const rel = relPosix(root, file);
    const literalAllowed = isAllowedPath(rel, extraExemptPaths);
    const ambientAllowed = AMBIENT_ALLOWED_PATH_PREDICATES.some((p) => p(rel));
    if (literalAllowed && ambientAllowed) continue;

    const contents = readFileSafe(file);
    if (contents === null) continue;

    const lines = contents.split("\n");

    if (!ambientAllowed) {
      for (const re of [AMBIENT_ENV_FALLBACK_RE, AMBIENT_HELPER_FALLBACK_RE]) {
        re.lastIndex = 0;
        let a: RegExpExecArray | null;
        while ((a = re.exec(contents)) !== null) {
          const { line } = lineColForOffset(contents, a.index);
          const lineText = lines[line - 1] ?? "";
          if (isCommentLine(lineText)) continue;
          if (hasValidOptOut(lines, line - 1)) continue;
          findings.push({
            file: rel,
            line,
            message: `Ambient process identity used as a request-scoped fallback: ${lineText.trim()}. This authorizes whoever the deploy env names, not the signed-in user — fail closed on a missing caller, or call getAmbientUserEmail() from a CLI/cron path.`,
          });
        }
      }
    }

    if (literalAllowed) continue;

    // Scanned before the literal bail-out below: aliasing is exactly how this
    // shape hides in a file that never spells out the literal itself.
    SYMBOLIC_FALLBACK_RE.lastIndex = 0;
    let symbolicMatch: RegExpExecArray | null;
    while ((symbolicMatch = SYMBOLIC_FALLBACK_RE.exec(contents)) !== null) {
      const { line } = lineColForOffset(contents, symbolicMatch.index);
      const lineText = lines[line - 1] ?? "";
      if (isCommentLine(lineText)) continue;
      if (hasValidOptOut(lines, line - 1)) continue;
      findings.push({
        file: rel,
        line,
        message: `DEV_MODE_USER_EMAIL used as a fallback identity: ${lineText.trim()}. Throw/401 on missing session instead.`,
      });
    }

    if (!contents.includes("local@localhost")) continue;

    LITERAL_RE.lastIndex = 0;
    let literalMatch: RegExpExecArray | null;
    while ((literalMatch = LITERAL_RE.exec(contents)) !== null) {
      const { line } = lineColForOffset(contents, literalMatch.index);
      const lineText = lines[line - 1] ?? "";
      if (isCommentLine(lineText)) continue;
      if (SQL_DEFAULT_RE.test(lineText)) continue;
      if (DRIZZLE_DEFAULT_RE.test(lineText)) continue;
      if (hasValidOptOut(lines, line - 1)) continue;
      findings.push({
        file: rel,
        line,
        message: `"local@localhost" used as a fallback identity: ${lineText.trim()}. Throw/401 on missing session instead — this pools every unauthenticated request onto one shared tenant.`,
      });
    }
  }

  return { name: "no-localhost-fallback", findings };
}
