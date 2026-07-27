/**
 * scanUnscopedCredentials — ported from
 * `scripts/guard-no-unscoped-credentials.mjs`.
 *
 * Refuse to let any caller invoke `resolveCredential` / `hasCredential` /
 * `saveCredential` / `deleteCredential` with only one argument. The
 * contract requires a second argument carrying the per-user / per-org
 * context object — `(key, { userEmail, orgId })` — so the credential
 * lookup is scoped to the requesting principal.
 *
 * Generic guard, shipped as-is: the detection regex, arg-balancing parser,
 * and marker semantics are unchanged from the monorepo original. The one
 * difference from the monorepo script is scan scope: the original restricts
 * its walk to `packages/`, `templates/`, `app/` — a monorepo-specific
 * optimization that also happens to exclude its own dotfile/doc trees. A
 * generated app's source lives at `actions/`, `app/`, `server/` (no
 * `packages/`/`templates/` wrapper — see report 005's "Path resolution"),
 * so keeping that literal subtree filter would silently skip `actions/`
 * and `server/`. This port scans the whole app root (still respecting
 * `SKIP_DIRS`) instead, which is a superset of the original's coverage and
 * has no false-negative risk for a single-app tree.
 *
 * Opt-out (same line only):
 *   resolveCredential(key) // guard:allow-unscoped-credential — short reason
 */

import {
  lineColForOffset,
  readFileSafe,
  relPosix,
  walk,
} from "./scan-utils.js";
import type { GuardFinding, GuardResult, GuardScanOptions } from "./types.js";

const FUNCTIONS = [
  "resolveCredential",
  "hasCredential",
  "saveCredential",
  "deleteCredential",
];

const FUNC_NAME_RE = new RegExp(
  `(?<![\\w$.])(${FUNCTIONS.join("|")})\\s*\\(`,
  "g",
);

const OPT_OUT_MARKER =
  /\/\/\s*guard:allow-unscoped-credential\b[^\n]*[—-]\s*\S/;

/** Files that legitimately use the one-arg form because they ARE the
 * implementation under guard — the definition file itself. In an app this
 * file only ever exists inside `node_modules`, already excluded by
 * SKIP_DIRS, so this allowlist is effectively a no-op for app mode; kept
 * for parity with the source guard. */
const FILE_ALLOWLIST = new Set(["packages/core/src/credentials/index.ts"]);

interface ArgAnalysis {
  topLevelCommas: number;
  endIdx: number;
}

/**
 * Starting at openParenIdx (the index of the `(` after the function name),
 * walk forward, balancing nested parens / braces / brackets / strings, and
 * return the top-level comma count. Ported verbatim.
 */
function analyzeArgs(
  contents: string,
  openParenIdx: number,
): ArgAnalysis | null {
  let depth = 0;
  let topLevelCommas = 0;
  let i = openParenIdx;
  let mode: "code" | '"' | "'" | "tmpl" = "code";
  let templateDepth = 0;
  while (i < contents.length) {
    const ch = contents[i];
    const next = contents[i + 1];
    if (mode === "code") {
      if (ch === "/" && next === "/") {
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

export function scanUnscopedCredentials(
  options: GuardScanOptions,
): GuardResult {
  const { root } = options;
  const findings: GuardFinding[] = [];

  for (const file of walk(root)) {
    if (!/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(file)) continue;
    if (file.endsWith(".d.ts")) continue;
    const rel = relPosix(root, file);
    if (FILE_ALLOWLIST.has(rel)) continue;

    const contents = readFileSafe(file);
    if (contents === null) continue;

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
    let m: RegExpExecArray | null;
    while ((m = FUNC_NAME_RE.exec(contents)) !== null) {
      const fnName = m[1];
      const openParenIdx = m.index + m[0].length - 1;
      const before = contents.slice(Math.max(0, m.index - 30), m.index);
      if (
        /\bfunction\s+$/.test(before) ||
        /\bexport\s+(default\s+)?(async\s+)?function\s+$/.test(before) ||
        /\b(const|let|var)\s+$/.test(before)
      ) {
        continue;
      }
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
      if (analysis.topLevelCommas >= 1) continue;
      if (OPT_OUT_MARKER.test(lineText)) continue;
      findings.push({
        file: rel,
        line,
        message: `${fnName}(...) called with only one argument — must pass a context object: ${fnName}(key, { userEmail, orgId })`,
      });
    }
  }

  return { name: "no-unscoped-credentials", findings };
}
