/**
 * scanEnvMutation — ported from `scripts/guard-no-env-mutation.mjs`.
 *
 * Refuse to let production code MUTATE `process.env` (e.g.
 * `process.env.AGENT_USER_EMAIL = userEmail`). `process.env` is
 * process-scoped, not request-scoped — on serverless, every warm container
 * handles many concurrent requests in one Node process, so mutating
 * `process.env` in a request handler leaks state across requests. Use
 * `runWithRequestContext` instead.
 *
 * Conditional guard — per report 005's V1 guard set table: the original
 * has 9 `ALLOWED_PATH_PREDICATES`; 4 are monorepo-only
 * (`packages/core/src/dev`, `templates/*\/test(s)/`, `packages/cli/`,
 * `packages/create-agent-native/`) and dropped here. The 5 portable ones
 * (`scripts/**`, `*.spec.*`, `*.test.*`, `/cli/`, `/scaffold/`) are kept
 * verbatim — they already work unmodified for a generated app.
 *
 * Opt-out (same line, or the line immediately above):
 *   process.env.X = y // guard:allow-env-mutation — short reason
 */

import {
  isCommentLine,
  lineColForOffset,
  readFileSafe,
  relPosix,
  walk,
} from "./scan-utils.js";
import type { GuardFinding, GuardResult, GuardScanOptions } from "./types.js";

const ALLOWED_PATH_PREDICATES: Array<(rel: string) => boolean> = [
  (rel) => /^scripts\//.test(rel),
  (rel) => /\.spec\.[tj]sx?$/.test(rel),
  (rel) => /\.test\.[tj]sx?$/.test(rel),
  (rel) => /\/cli\//.test(rel),
  (rel) => /\/scaffold\//.test(rel),
];

const OPT_OUT_MARKER = /\/\/\s*guard:allow-env-mutation\b[^\n]*/;
const OPT_OUT_REQUIRES_REASON = /\/\/\s*guard:allow-env-mutation\s*[—-]\s*\S/;

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

function isAllowedPath(rel: string): boolean {
  return ALLOWED_PATH_PREDICATES.some((p) => p(rel));
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

export function scanEnvMutation(options: GuardScanOptions): GuardResult {
  const { root } = options;
  const findings: GuardFinding[] = [];

  for (const file of walk(root)) {
    if (!/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(file)) continue;
    if (file.endsWith(".d.ts")) continue;
    const rel = relPosix(root, file);
    if (isAllowedPath(rel)) continue;

    const contents = readFileSafe(file);
    if (contents === null || !contents.includes("process.env")) continue;

    const lines = contents.split("\n");

    for (const re of [
      MEMBER_FORM,
      BRACKET_FORM,
      DELETE_MEMBER_FORM,
      DELETE_BRACKET_FORM,
    ]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(contents)) !== null) {
        const { line } = lineColForOffset(contents, m.index);
        const lineText = lines[line - 1] ?? "";
        if (isCommentLine(lineText)) continue;
        if (hasValidOptOut(lines, line - 1)) continue;
        findings.push({
          file: rel,
          line,
          message: `process.env mutated in production code: ${lineText.trim()}. process.env is process-scoped, not request-scoped — use runWithRequestContext instead.`,
        });
      }
    }
  }

  return { name: "no-env-mutation", findings };
}
