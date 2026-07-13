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
    if (isAllowedPath(rel, extraExemptPaths)) continue;

    const contents = readFileSafe(file);
    if (contents === null || !contents.includes("local@localhost")) continue;

    const lines = contents.split("\n");

    LITERAL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LITERAL_RE.exec(contents)) !== null) {
      const { line } = lineColForOffset(contents, m.index);
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

    SYMBOLIC_FALLBACK_RE.lastIndex = 0;
    let s: RegExpExecArray | null;
    while ((s = SYMBOLIC_FALLBACK_RE.exec(contents)) !== null) {
      const { line } = lineColForOffset(contents, s.index);
      const lineText = lines[line - 1] ?? "";
      if (isCommentLine(lineText)) continue;
      if (hasValidOptOut(lines, line - 1)) continue;
      findings.push({
        file: rel,
        line,
        message: `DEV_MODE_USER_EMAIL used as a fallback identity: ${lineText.trim()}. Throw/401 on missing session instead.`,
      });
    }
  }

  return { name: "no-localhost-fallback", findings };
}
