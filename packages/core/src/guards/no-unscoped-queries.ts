/**
 * scanUnscopedQueries — ported from `scripts/guard-no-unscoped-queries.mjs`.
 *
 * Refuse to let any code query an "ownable" resource table (one that
 * spreads `...ownableColumns()`) without going through framework access
 * control: `accessFilter` / `resolveAccess` / `assertAccess`, or an
 * explicit `ownerEmail` / `userEmail` / `orgId` filter. The check is
 * per-STATEMENT, scoped to the enclosing block, so a sibling `if` branch
 * that correctly scopes its query does not defuse an unscoped sibling.
 *
 * Conditional guard — per report 005's V1 guard set table: the original
 * restricts scanning to `templates/[^/]+/(server|actions)/` and
 * `packages/[^/]+/src/`, and hardcodes a `FILE_ALLOWLIST` of this
 * framework's own sharing-primitive implementation files. For a generated
 * app (no `templates/`/`packages/` wrapper — source lives at `actions/`
 * and `server/` under the app root), this port scans `actions/` and
 * `server/` directly and drops the hardcoded allowlist in favor of an
 * optional `extraExemptPaths` param (default `[]`).
 *
 * Opt-out (within the enclosing block, or as a file header for whole-file
 * opt-outs):
 *   // guard:allow-unscoped — short reason
 */

import { readFileSafe, relPosix, walk } from "./scan-utils.js";
import type { GuardFinding, GuardResult, GuardScanOptions } from "./types.js";

export interface UnscopedQueriesOptions extends GuardScanOptions {
  /** Exact repo-relative paths to exempt from the per-statement scan
   * (e.g. this app's own sharing-primitive implementation, if any).
   * Default `[]`. */
  extraExemptPaths?: string[];
}

const ACCESS_CONTROL_HELPERS = [
  /\baccessFilter\s*\(/,
  /\bresolveAccess\s*\(/,
  /\bassertAccess\s*\(/,
  /\bgetShareableResource\s*\(/,
  /\baccessFilterForShares\s*\(/,
];

const EXPLICIT_OWNER_FILTERS = [
  /\.\s*ownerEmail\b\s*[,)]/,
  /\.\s*userEmail\b\s*[,)]/,
  /\.\s*orgId\b\s*[,)]/,
  /WHERE[\s\S]*?\bowner_email\b/i,
  /WHERE[\s\S]*?\buser_email\b/i,
  /WHERE[\s\S]*?\borg_id\b/i,
];

const INSERT_OWNER_PATTERNS = [
  /\bownerEmail\s*:/,
  /\bownerEmail\s*[,}]/,
  /\buserEmail\s*[:,}]/,
  /\borgId\s*[:,}]/,
];

const OPT_OUT_MARKER = /\/\/\s*guard:allow-unscoped\b/;

const BLOCK_OWNERSHIP_SIGNALS = [
  /\bgetRequestUserEmail\s*\(/,
  /\bgetRequestOrgId\s*\(/,
  /\bgetCurrentUserEmail\s*\(/,
  /\bgetCurrentOwnerEmail\s*\(/,
  /\brunWithRequestContext\s*\(/,
];

interface TableCall {
  exportName: string;
  sqlName: string;
  body: string;
}

function extractTableCalls(contents: string): TableCall[] {
  const out: TableCall[] = [];
  const headerRegex =
    /export\s+const\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:[a-zA-Z_$][\w$]*Table|table)\s*\(\s*"([^"]+)"\s*,\s*\{/gm;
  let m: RegExpExecArray | null;
  while ((m = headerRegex.exec(contents)) !== null) {
    const exportName = m[1];
    const sqlName = m[2];
    const start = headerRegex.lastIndex - 1;
    let depth = 0;
    let inStr: string | null = null;
    let i = start;
    let bodyEnd = -1;
    for (; i < contents.length; i++) {
      const c = contents[i];
      const prev = contents[i - 1];
      if (inStr) {
        if (c === inStr && prev !== "\\") inStr = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        inStr = c;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          bodyEnd = i;
          break;
        }
      }
    }
    if (bodyEnd === -1) continue;
    const body = contents.slice(start + 1, bodyEnd);
    out.push({ exportName, sqlName, body });
  }
  return out;
}

function extractOwnableExports(contents: string): Set<string> {
  const exports = new Set<string>();
  for (const { exportName, sqlName, body } of extractTableCalls(contents)) {
    if (/\.\.\.ownableColumns\s*\(/.test(body)) {
      exports.add(exportName);
      exports.add(`__sql__${sqlName}`);
    }
  }
  return exports;
}

function collectOwnableTables(root: string): Map<string, Set<string>> {
  const byDir = new Map<string, Set<string>>();
  for (const file of walk(root)) {
    if (!file.endsWith("/db/schema.ts")) continue;
    const contents = readFileSafe(file);
    if (contents === null || !/ownableColumns\s*\(/.test(contents)) continue;
    const ownables = extractOwnableExports(contents);
    if (ownables.size > 0) {
      byDir.set(relPosix(root, file), ownables);
    }
  }
  return byDir;
}

interface Block {
  open: number;
  close: number;
}

function buildBlockTree(contents: string): Block[] {
  const blocks: Block[] = [];
  const stack: number[] = [];
  let i = 0;
  const n = contents.length;
  let inStr: string | null = null;
  const templateStack: string[] = [];

  while (i < n) {
    const c = contents[i];
    const next = contents[i + 1];

    if (inStr) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (inStr === "`") {
        if (c === "`") {
          inStr = null;
          i++;
          continue;
        }
        if (c === "$" && next === "{") {
          templateStack.push("`");
          inStr = null;
          stack.push(-1 - templateStack.length);
          i += 2;
          continue;
        }
      } else if (c === inStr) {
        inStr = null;
        i++;
        continue;
      }
      i++;
      continue;
    }

    if (c === "/" && next === "/") {
      while (i < n && contents[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n - 1 && !(contents[i] === "*" && contents[i + 1] === "/"))
        i++;
      i += 2;
      continue;
    }

    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      i++;
      continue;
    }

    if (c === "{") {
      stack.push(i);
      i++;
      continue;
    }
    if (c === "}") {
      const open = stack.pop();
      if (open !== undefined && open >= 0) {
        blocks.push({ open, close: i });
      } else if (open !== undefined && open < 0) {
        const kind = templateStack.pop();
        inStr = kind ?? null;
      }
      i++;
      continue;
    }
    i++;
  }
  blocks.sort((a, b) => a.open - b.open);
  return blocks;
}

function innermostBlock(
  blocks: Block[],
  offset: number,
  fileLen: number,
): Block {
  let best: Block | null = null;
  for (const b of blocks) {
    if (b.open <= offset && b.close >= offset) {
      if (!best || b.open > best.open) best = b;
    }
  }
  return best || { open: 0, close: fileLen };
}

function computeLineOffsets(contents: string): number[] {
  const offsets = [0];
  for (let i = 0; i < contents.length; i++) {
    if (contents[i] === "\n") offsets.push(i + 1);
  }
  return offsets;
}

function offsetToLine(offsets: number[], offset: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (offsets[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function findChainEnd(contents: string, startIdx: number): number {
  let depth = 0;
  let inStr: string | null = null;
  let templateDepth = 0;
  const limit = Math.min(contents.length, startIdx + 10000);
  let sawOpen = false;
  for (let i = startIdx; i < limit; i++) {
    const c = contents[i];
    const prev = contents[i - 1];
    if (inStr) {
      if (inStr === "`") {
        if (c === "`") inStr = null;
        else if (c === "$" && contents[i + 1] === "{") {
          templateDepth++;
          i++;
        }
      } else if (c === inStr && prev !== "\\") {
        inStr = null;
      }
      continue;
    }
    if (templateDepth > 0 && c === "}") {
      templateDepth--;
      inStr = "`";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      continue;
    }
    if (c === "(" || c === "{" || c === "[") {
      depth++;
      sawOpen = true;
    } else if (c === ")" || c === "}" || c === "]") {
      depth--;
    } else if (c === ";" && depth <= 0) {
      return i + 1;
    } else if (c === "\n" && sawOpen && depth <= 0) {
      let j = i + 1;
      while (j < limit && /[ \t]/.test(contents[j])) j++;
      if (j >= limit || (contents[j] !== "." && contents[j] !== ")")) {
        return i + 1;
      }
    }
  }
  return limit;
}

interface Statement {
  kind: "drizzle" | "raw-sql";
  op: string;
  name: string;
  line: number;
  queryStart: number;
  queryEnd: number;
  snippet: string;
}

function walkBackToChainHead(contents: string, idx: number): number {
  let i = idx;
  while (i > 0) {
    const c = contents[i];
    if (c === ";" || c === "{" || c === "}") return i + 1;
    if (c === "\n") {
      let j = i + 1;
      while (j < contents.length && /[ \t]/.test(contents[j])) j++;
      if (contents[j] !== "." && contents[j] !== ")") return i + 1;
    }
    i--;
  }
  return 0;
}

function findStatements(
  contents: string,
  ownableNames: Set<string>,
  ownableSqlNames: Set<string>,
): Statement[] {
  const statements: Statement[] = [];
  const lineOffsets = computeLineOffsets(contents);

  const namesAlt = [...ownableNames]
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");

  if (namesAlt.length > 0) {
    const fromRe = new RegExp(
      `\\.\\s*from\\s*\\(\\s*(?:[a-zA-Z_$][\\w$]*\\s*\\.\\s*)?(${namesAlt})\\b`,
      "g",
    );
    let fromMatch: RegExpExecArray | null;
    while ((fromMatch = fromRe.exec(contents)) !== null) {
      const name = fromMatch[1];
      const queryStart = walkBackToChainHead(contents, fromMatch.index);
      const queryEnd = findChainEnd(contents, fromMatch.index);
      const snippet = contents.slice(queryStart, queryEnd);
      statements.push({
        kind: "drizzle",
        op: "select",
        name,
        line: offsetToLine(lineOffsets, fromMatch.index),
        queryStart,
        queryEnd,
        snippet,
      });
    }

    for (const op of ["update", "delete", "insert"]) {
      const re = new RegExp(
        `\\bdb\\s*\\.\\s*${op}\\s*\\(\\s*(?:[a-zA-Z_$][\\w$]*\\s*\\.\\s*)?(${namesAlt})\\b`,
        "g",
      );
      let m: RegExpExecArray | null;
      while ((m = re.exec(contents)) !== null) {
        const name = m[1];
        const queryStart = walkBackToChainHead(contents, m.index);
        const queryEnd = findChainEnd(contents, m.index);
        const snippet = contents.slice(queryStart, queryEnd);
        statements.push({
          kind: "drizzle",
          op,
          name,
          line: offsetToLine(lineOffsets, m.index),
          queryStart,
          queryEnd,
          snippet,
        });
      }
    }
  }

  for (const sqlName of ownableSqlNames) {
    const escaped = sqlName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const verbs: Array<[string, string]> = [
      ["select", `\\bFROM\\s+${escaped}\\b`],
      ["update", `\\bUPDATE\\s+${escaped}\\b`],
      ["delete", `\\bDELETE\\s+FROM\\s+${escaped}\\b`],
      ["insert", `\\bINSERT\\s+INTO\\s+${escaped}\\b`],
    ];
    for (const [op, body] of verbs) {
      const re = new RegExp(`["'\`][^"'\`]*${body}[\\s\\S]*?["'\`]`, "gi");
      let m: RegExpExecArray | null;
      while ((m = re.exec(contents)) !== null) {
        const matchStart = m.index;
        statements.push({
          kind: "raw-sql",
          op,
          name: sqlName,
          line: offsetToLine(lineOffsets, matchStart),
          queryStart: matchStart,
          queryEnd: matchStart + m[0].length,
          snippet: m[0],
        });
      }
    }
  }

  return statements;
}

function isControlFlowBlock(contents: string, block: Block): boolean {
  let i = block.open - 1;
  while (i > 0 && /[ \t\n\r]/.test(contents[i])) i--;
  if (contents[i] === ")") {
    let depth = 1;
    let j = i - 1;
    while (j > 0 && depth > 0) {
      if (contents[j] === ")") depth++;
      else if (contents[j] === "(") depth--;
      if (depth === 0) break;
      j--;
    }
    j--;
    while (j > 0 && /[ \t\n\r]/.test(contents[j])) j--;
    let end = j + 1;
    while (j > 0 && /[a-zA-Z_$]/.test(contents[j])) j--;
    const word = contents.slice(j + 1, end);
    return ["if", "for", "while", "switch", "catch"].includes(word);
  }
  let end = i + 1;
  while (i > 0 && /[a-zA-Z_$]/.test(contents[i])) i--;
  const word = contents.slice(i + 1, end);
  return ["else", "try", "do", "finally"].includes(word);
}

function directBlockText(
  contents: string,
  block: Block,
  blocks: Block[],
  queryOffset: number,
): string {
  const candidates = blocks.filter(
    (b) =>
      b.open > block.open &&
      b.close < block.close &&
      !(b.open <= queryOffset && b.close >= queryOffset) &&
      isControlFlowBlock(contents, b),
  );
  const descendants = candidates
    .filter(
      (b) =>
        !candidates.some(
          (p) => p !== b && p.open < b.open && p.close > b.close,
        ),
    )
    .sort((a, b) => b.open - a.open);

  let result = contents.slice(block.open, block.close + 1);
  for (const child of descendants) {
    const start = child.open - block.open;
    const end = child.close - block.open;
    if (start < 0 || end >= result.length) continue;
    const inner = result.slice(start + 1, end);
    const blanked = inner.replace(/[^\n]/g, " ");
    result = result.slice(0, start + 1) + blanked + result.slice(end);
  }
  return result;
}

function blockHasAccessControl(blockText: string): boolean {
  if (ACCESS_CONTROL_HELPERS.some((re) => re.test(blockText))) return true;
  if (EXPLICIT_OWNER_FILTERS.some((re) => re.test(blockText))) return true;
  if (BLOCK_OWNERSHIP_SIGNALS.some((re) => re.test(blockText))) return true;
  return false;
}

function collectAccessControlBindings(contents: string): Set<string> {
  const names = new Set<string>();
  const bindRe =
    /\b(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*(?::[^=]+)?\s*=\s*([\s\S]{0,400}?)(?:;|\n\s*(?:const|let|var|if|return|await|function|export|}|\/\/))/g;
  let m: RegExpExecArray | null;
  while ((m = bindRe.exec(contents)) !== null) {
    const name = m[1];
    const rhs = m[2];
    if (
      ACCESS_CONTROL_HELPERS.some((re) => re.test(rhs)) ||
      EXPLICIT_OWNER_FILTERS.some((re) => re.test(rhs))
    ) {
      names.add(name);
    }
  }
  const pushRe = /\b([a-zA-Z_$][\w$]*)\.push\s*\(([^;]{0,400})\)/g;
  while ((m = pushRe.exec(contents)) !== null) {
    const name = m[1];
    const arg = m[2];
    if (
      ACCESS_CONTROL_HELPERS.some((re) => re.test(arg)) ||
      EXPLICIT_OWNER_FILTERS.some((re) => re.test(arg))
    ) {
      names.add(name);
    }
  }
  return names;
}

function statementHasInlineAccessControl(stmt: Statement): boolean {
  const snippet = stmt.snippet;
  if (ACCESS_CONTROL_HELPERS.some((re) => re.test(snippet))) return true;
  if (
    stmt.kind === "drizzle" &&
    EXPLICIT_OWNER_FILTERS.some((re) => re.test(snippet))
  )
    return true;
  if (stmt.op === "insert") {
    if (INSERT_OWNER_PATTERNS.some((re) => re.test(snippet))) return true;
  }
  if (stmt.kind === "raw-sql") {
    if (
      /\bowner_email\b/i.test(snippet) ||
      /\buser_email\b/i.test(snippet) ||
      /\borg_id\b/i.test(snippet)
    ) {
      return true;
    }
  }
  return false;
}

function isOptedOutWithinBlock(blockText: string): boolean {
  return OPT_OUT_MARKER.test(blockText);
}

function isEligibleScanPath(rel: string): boolean {
  return /^actions\//.test(rel) || /^server\//.test(rel);
}

function scanFiles(
  root: string,
  ownablesByDir: Map<string, Set<string>>,
  extraExemptPaths: string[],
): Array<{ file: string; hits: Statement[] }> {
  const allOwnableNames = new Set<string>();
  const allOwnableSqlNames = new Set<string>();
  for (const set of ownablesByDir.values()) {
    for (const name of set) {
      if (name.startsWith("__sql__")) allOwnableSqlNames.add(name.slice(7));
      else allOwnableNames.add(name);
    }
  }

  const violations: Array<{ file: string; hits: Statement[] }> = [];

  for (const file of walk(root)) {
    if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
    if (file.endsWith(".d.ts")) continue;
    const rel = relPosix(root, file);
    if (extraExemptPaths.includes(rel)) continue;
    if (rel.endsWith("/db/schema.ts")) continue;
    if (!isEligibleScanPath(rel)) continue;

    const contents = readFileSafe(file);
    if (contents === null) continue;

    if (
      !/\bfrom\s*\(/.test(contents) &&
      !/\bdb\s*\.\s*(update|delete|insert)\b/.test(contents) &&
      !/\b(FROM|UPDATE|INSERT INTO|DELETE FROM)\b/i.test(contents)
    ) {
      continue;
    }

    const head = contents.split("\n").slice(0, 30).join("\n");
    if (OPT_OUT_MARKER.test(head)) continue;

    const statements = findStatements(
      contents,
      allOwnableNames,
      allOwnableSqlNames,
    );
    if (statements.length === 0) continue;

    const fileHasAccessControl =
      ACCESS_CONTROL_HELPERS.some((re) => re.test(contents)) ||
      EXPLICIT_OWNER_FILTERS.some((re) => re.test(contents));
    if (!fileHasAccessControl) continue;

    const blocks = buildBlockTree(contents);
    const accessControlBindings = collectAccessControlBindings(contents);

    const fileViolations: Statement[] = [];
    for (const stmt of statements) {
      if (statementHasInlineAccessControl(stmt)) continue;

      let scoped = false;
      let cur = innermostBlock(blocks, stmt.queryStart, contents.length);
      let levels = 0;
      while (cur && levels < 8) {
        const directText = directBlockText(
          contents,
          cur,
          blocks,
          stmt.queryStart,
        );
        if (isOptedOutWithinBlock(directText)) {
          scoped = true;
          break;
        }
        if (blockHasAccessControl(directText)) {
          scoped = true;
          break;
        }
        if (
          accessControlBindings.size > 0 &&
          [...accessControlBindings].some((name) =>
            new RegExp(`\\b${name}\\b`).test(stmt.snippet),
          )
        ) {
          scoped = true;
          break;
        }
        const parents = blocks.filter(
          (b) => b.open < cur.open && b.close > cur.close,
        );
        const parent =
          parents.length > 0
            ? parents.reduce((a, b) => (a.open > b.open ? a : b))
            : null;
        if (!parent) break;
        cur = parent;
        levels++;
      }
      if (scoped) continue;

      fileViolations.push(stmt);
    }
    if (fileViolations.length > 0) {
      violations.push({ file: rel, hits: fileViolations });
    }
  }

  return violations;
}

interface MentionViolation {
  file: string;
  line: number;
  table: string;
}

function scanMentionProviders(
  root: string,
  ownablesByDir: Map<string, Set<string>>,
  extraExemptPaths: string[],
): MentionViolation[] {
  const allOwnableNames = new Set<string>();
  for (const set of ownablesByDir.values()) {
    for (const name of set) {
      if (!name.startsWith("__sql__")) allOwnableNames.add(name);
    }
  }
  if (allOwnableNames.size === 0) return [];

  const namesAlt = [...allOwnableNames]
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");

  const fromOwnableRe = new RegExp(
    `\\.\\s*from\\s*\\(\\s*(?:[a-zA-Z_$][\\w$]*\\s*\\.\\s*)?(${namesAlt})\\b`,
    "g",
  );

  const CLOSURE_ACCESS_PATTERNS = [
    ...ACCESS_CONTROL_HELPERS,
    ...EXPLICIT_OWNER_FILTERS,
    ...BLOCK_OWNERSHIP_SIGNALS,
  ];

  const violations: MentionViolation[] = [];

  for (const file of walk(root)) {
    if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
    if (file.endsWith(".d.ts")) continue;
    const rel = relPosix(root, file);
    if (extraExemptPaths.includes(rel)) continue;
    if (!/^server\//.test(rel)) continue;

    const contents = readFileSafe(file);
    if (contents === null) continue;
    if (
      !/\bmentionProviders\b/.test(contents) ||
      !/\bfrom\s*\(/.test(contents)
    ) {
      continue;
    }

    const head = contents.split("\n").slice(0, 30).join("\n");
    if (OPT_OUT_MARKER.test(head)) continue;

    const lineOffsets = computeLineOffsets(contents);

    const mpHeaderRe = /\bmentionProviders\s*:/g;
    while (mpHeaderRe.exec(contents) !== null) {
      let i = mpHeaderRe.lastIndex;
      while (i < contents.length && contents[i] !== "{" && contents[i] !== "\n")
        i++;
      if (i >= contents.length || contents[i] !== "{") continue;

      let depth = 0;
      let inStr: string | null = null;
      const mpStart = i;
      let mpEnd = -1;
      for (let j = i; j < contents.length; j++) {
        const c = contents[j];
        if (inStr) {
          if (c === "\\" && inStr !== "`") {
            j++;
            continue;
          }
          if (c === inStr) inStr = null;
          continue;
        }
        if (c === '"' || c === "'" || c === "`") {
          inStr = c;
          continue;
        }
        if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) {
            mpEnd = j;
            break;
          }
        }
      }
      if (mpEnd === -1) continue;

      const mpBody = contents.slice(mpStart, mpEnd + 1);

      const searchRe = /\bsearch\s*:\s*async\s*\([^)]*\)\s*=>\s*\{/g;
      let searchMatch: RegExpExecArray | null;
      while ((searchMatch = searchRe.exec(mpBody)) !== null) {
        const closureStart =
          mpStart + searchMatch.index + searchMatch[0].length - 1;
        let closureDepth = 0;
        let closureEnd = -1;
        let closureInStr: string | null = null;
        for (let j = closureStart; j < mpEnd; j++) {
          const c = contents[j];
          if (closureInStr) {
            if (c === "\\" && closureInStr !== "`") {
              j++;
              continue;
            }
            if (c === closureInStr) closureInStr = null;
            continue;
          }
          if (c === '"' || c === "'" || c === "`") {
            closureInStr = c;
            continue;
          }
          if (c === "{") closureDepth++;
          else if (c === "}") {
            closureDepth--;
            if (closureDepth === 0) {
              closureEnd = j;
              break;
            }
          }
        }
        if (closureEnd === -1) continue;

        const closureBody = contents.slice(closureStart, closureEnd + 1);
        if (OPT_OUT_MARKER.test(closureBody)) continue;

        fromOwnableRe.lastIndex = 0;
        let fromMatch: RegExpExecArray | null;
        while ((fromMatch = fromOwnableRe.exec(closureBody)) !== null) {
          const tableName = fromMatch[1];
          if (CLOSURE_ACCESS_PATTERNS.some((re) => re.test(closureBody)))
            continue;
          const absOffset = closureStart + fromMatch.index;
          const line = offsetToLine(lineOffsets, absOffset);
          violations.push({ file: rel, line, table: tableName });
        }
      }
    }
  }

  return violations;
}

export function scanUnscopedQueries(
  options: UnscopedQueriesOptions,
): GuardResult {
  const { root, extraExemptPaths = [] } = options;
  const findings: GuardFinding[] = [];

  const ownablesByDir = collectOwnableTables(root);
  if (ownablesByDir.size === 0) {
    return { name: "no-unscoped-queries", findings };
  }

  const violations = scanFiles(root, ownablesByDir, extraExemptPaths);
  for (const v of violations) {
    for (const hit of v.hits) {
      findings.push({
        file: v.file,
        line: hit.line,
        message: `unscoped ${hit.op} on "${hit.name}" (${hit.kind}) — add accessFilter/resolveAccess/assertAccess or an explicit ownerEmail/userEmail/orgId filter.`,
      });
    }
  }

  const mentionViolations = scanMentionProviders(
    root,
    ownablesByDir,
    extraExemptPaths,
  );
  for (const v of mentionViolations) {
    findings.push({
      file: v.file,
      line: v.line,
      message: `mentionProviders search closure queries "${v.table}" without access control — every user who types @ in chat would see rows owned by other users.`,
    });
  }

  return { name: "no-unscoped-queries", findings };
}
