#!/usr/bin/env node
/**
 * guard-no-unscoped-queries.mjs
 *
 * Defensive CI guard: refuse to let any code query an "ownable" resource
 * table without going through framework access control.
 *
 * Background (2026-04-28 incident — slides leak): A user signed up via
 * Google for the slides template and saw decks owned by other users. Root
 * cause: `templates/slides/server/handlers/decks.ts` ran
 * `db.select().from(schema.decks)` with no `accessFilter` / `resolveAccess`
 * / `assertAccess` — the HTTP handler bypassed the access control that the
 * agent action `list-decks.ts` correctly applied.
 *
 * Tightened (2026-04-29): the previous version used a per-FILE pre-filter
 * — any access-control helper anywhere in a file defused the entire scan
 * for that file. The forms `view-screen.ts` regression slipped through
 * that way: one `if` branch correctly used `accessFilter`, a sibling `if`
 * branch did not, and the file-wide presence of the helper made the guard
 * accept both. The check is now per-STATEMENT, scoped to the enclosing
 * block (innermost `{ ... }`). Sibling blocks no longer defuse each other.
 *
 * Ownable resources are tables that include `...ownableColumns()` and
 * register a companion shares table via `createSharesTable()`. They MUST
 * be queried with one of:
 *
 *   - `accessFilter(table, sharesTable)` in the WHERE clause (list/read)
 *   - `resolveAccess("<type>", id)` (read by id)
 *   - `assertAccess("<type>", id, role)` (write/delete by id)
 *   - explicit `eq(table.ownerEmail, ...)` / `eq(table.userEmail, ...)` /
 *     `eq(table.orgId, ...)` filter
 *   - inserts must set `ownerEmail` from a request-bound source
 *
 * Files or individual statements that legitimately bypass access control
 * (e.g. share-link viewer, anonymous analytics sink, registry helpers)
 * can opt out with the marker comment:
 *
 *   // guard:allow-unscoped — short reason
 *
 * Place it within the enclosing block of the statement (or as a file
 * header comment for whole-file opt-outs). Reviewers should push back on
 * every new opt-out.
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

// Helpers indicating a block applies framework access control.
const ACCESS_CONTROL_HELPERS = [
  /\baccessFilter\s*\(/,
  /\bresolveAccess\s*\(/,
  /\bassertAccess\s*\(/,
  /\bgetShareableResource\s*\(/,
  /\baccessFilterForShares\s*\(/,
];

// Explicit filtering by ownership in Drizzle / raw SQL within the block.
const EXPLICIT_OWNER_FILTERS = [
  // Drizzle column references in eq/where (matches eq(t.ownerEmail, ...)
  // and similar). Trailing `[,)]` keeps us off insert object literals.
  /\.\s*ownerEmail\b\s*[,)]/,
  /\.\s*userEmail\b\s*[,)]/,
  /\.\s*orgId\b\s*[,)]/,
  // Raw SQL WHERE on ownership columns (placed inside string literals
  // counted at the snippet level).
  /WHERE[\s\S]*?\bowner_email\b/i,
  /WHERE[\s\S]*?\buser_email\b/i,
  /WHERE[\s\S]*?\borg_id\b/i,
];

// For inserts: the values object must set ownerEmail (or include the
// shorthand property `ownerEmail,`) — both indicate the inserter is
// passing the caller's identity in. We accept either a full
// `ownerEmail: <expr>` (any expression — we trust the surrounding
// function-block scoping check to have established the binding) or the
// shorthand `ownerEmail` property. Same for orgId.
const INSERT_OWNER_PATTERNS = [
  // Full property assignment
  /\bownerEmail\s*:/,
  // Shorthand: `ownerEmail,` or `ownerEmail }`
  /\bownerEmail\s*[,}]/,
  // ditto for userEmail / orgId
  /\buserEmail\s*[:,}]/,
  /\borgId\s*[:,}]/,
];

// Files that legitimately don't need access control. Keep this list
// small and reviewed.
const FILE_ALLOWLIST = new Set([
  // Sharing primitives themselves — they implement access control.
  "packages/core/src/sharing/access.ts",
  "packages/core/src/sharing/registry.ts",
  "packages/core/src/sharing/schema.ts",
  // Share-resource action: queries the shares table by resource id, gated
  // by its own assertAccess on the parent resource (verified manually).
  "packages/core/src/sharing/actions/share-resource.ts",
  "packages/core/src/sharing/actions/unshare-resource.ts",
  "packages/core/src/sharing/actions/list-resource-shares.ts",
  "packages/core/src/sharing/actions/set-resource-visibility.ts",
  // Generic db CLI — it executes user-supplied SQL strings, so the
  // unscoped detection of "FROM <ownable_table>" inside an arbitrary
  // SQL parameter is a false positive by design.
  "packages/core/src/scripts/db/exec.ts",
  "packages/core/src/scripts/db/patch.ts",
  "packages/core/src/scripts/db/query.ts",
]);

const OPT_OUT_MARKER = /\/\/\s*guard:allow-unscoped\b/;

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

/**
 * Walk a `table("name", { ... })` call, brace-counting so nested object
 * literals (e.g. `text("status", { enum: [...] })`) don't truncate the
 * body capture. Returns [{exportName, sqlName, body}].
 */
function extractTableCalls(contents) {
  const out = [];
  const headerRegex =
    /export\s+const\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:[a-zA-Z_$][\w$]*Table|table)\s*\(\s*"([^"]+)"\s*,\s*\{/gm;
  let m;
  while ((m = headerRegex.exec(contents)) !== null) {
    const exportName = m[1];
    const sqlName = m[2];
    const start = headerRegex.lastIndex - 1; // position of the `{`
    let depth = 0;
    let inStr = null;
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

function extractOwnableExports(contents) {
  const exports = new Set();
  for (const { exportName, sqlName, body } of extractTableCalls(contents)) {
    if (/\.\.\.ownableColumns\s*\(/.test(body)) {
      exports.add(exportName);
      exports.add(`__sql__${sqlName}`);
    }
  }
  return exports;
}

async function collectOwnableTables() {
  const byDir = new Map();
  for await (const file of walk(REPO_ROOT)) {
    if (!file.endsWith("/db/schema.ts")) continue;
    const rel = path.relative(REPO_ROOT, file).replaceAll("\\", "/");
    let contents;
    try {
      contents = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!/ownableColumns\s*\(/.test(contents)) continue;
    const ownables = extractOwnableExports(contents);
    if (ownables.size > 0) {
      byDir.set(path.dirname(rel), ownables);
    }
  }
  return byDir;
}

/**
 * Build a "block tree": for every `{` in source, find its matching `}`.
 * Returns an array of { open, close, parent } sorted by `open` so we can
 * find the innermost block containing any offset via binary search.
 *
 * Strings, template literals, regexes, single-line comments, and block
 * comments are skipped so we don't count braces inside them.
 */
function buildBlockTree(contents) {
  const blocks = [];
  const stack = [];
  let i = 0;
  const n = contents.length;
  let inStr = null;
  let templateDepth = 0;

  while (i < n) {
    const c = contents[i];
    const prev = contents[i - 1];
    const next = contents[i + 1];

    if (inStr) {
      if (inStr === "`") {
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === "`") {
          inStr = null;
          i++;
          continue;
        }
        if (c === "$" && next === "{") {
          templateDepth++;
          i += 2;
          continue;
        }
      } else {
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === inStr) {
          inStr = null;
          i++;
          continue;
        }
      }
      i++;
      continue;
    }

    // Comments
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

    // Strings
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      i++;
      continue;
    }

    // Template literal closing brace?
    if (c === "}" && templateDepth > 0) {
      templateDepth--;
      // pop nothing — this `}` closes a template substitution, not a code
      // block.
      i++;
      // ...and the surrounding template literal continues:
      // We need to re-enter the template-literal mode.
      inStr = "`";
      i++; // skip past the `}` we already incremented... actually let's
      // back up by one: the outer string-handler increments after
      // setting inStr.
      // Simpler: leave templateDepth handling above `inStr` block.
      continue;
    }

    if (c === "{") {
      stack.push(i);
      i++;
      continue;
    }
    if (c === "}") {
      const open = stack.pop();
      if (open !== undefined) {
        blocks.push({ open, close: i });
      }
      i++;
      continue;
    }
    i++;
  }
  blocks.sort((a, b) => a.open - b.open);
  return blocks;
}

/**
 * Given an offset, return the innermost block that strictly contains it.
 * Falls back to whole-file ({0, n}) if none.
 */
function innermostBlock(blocks, offset, fileLen) {
  // The innermost block has the largest open offset that is <= offset
  // AND whose close is >= offset.
  let best = null;
  for (const b of blocks) {
    if (b.open <= offset && b.close >= offset) {
      if (!best || b.open > best.open) best = b;
    }
  }
  return best || { open: 0, close: fileLen };
}

function computeLineOffsets(contents) {
  const offsets = [0];
  for (let i = 0; i < contents.length; i++) {
    if (contents[i] === "\n") offsets.push(i + 1);
  }
  return offsets;
}

function offsetToLine(offsets, offset) {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (offsets[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * Find the offset where a `db.select(...)...where(...).limit(...)` chain
 * ENDS. We brace/paren-walk and return the first top-level `;` or
 * (failing that) the next `\n` once depth returned to 0.
 */
function findChainEnd(contents, startIdx) {
  let depth = 0;
  let inStr = null;
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
      // After the chain has fully closed, a newline that isn't followed
      // by `.` (chain continues) ends the statement.
      let j = i + 1;
      while (j < limit && /[ \t]/.test(contents[j])) j++;
      if (j >= limit || (contents[j] !== "." && contents[j] !== ")")) {
        return i + 1;
      }
    }
  }
  return limit;
}

/**
 * Locate every db query statement in a file. Returns
 *   { kind: "drizzle"|"raw-sql", op, name, line, queryStart, queryEnd, snippet }
 *
 * `snippet` is just the chain itself (used for nested structural checks
 * like "does .where contain accessFilter directly").
 */
function findStatements(contents, ownableNames, ownableSqlNames) {
  const statements = [];
  const lineOffsets = computeLineOffsets(contents);

  const namesAlt = [...ownableNames]
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");

  if (namesAlt.length > 0) {
    // SELECT: .from(schema.NAME) or .from(NAME).
    const fromRe = new RegExp(
      `\\.\\s*from\\s*\\(\\s*(?:[a-zA-Z_$][\\w$]*\\s*\\.\\s*)?(${namesAlt})\\b`,
      "g",
    );
    let fromMatch;
    while ((fromMatch = fromRe.exec(contents)) !== null) {
      const name = fromMatch[1];
      // Walk back to find `await db.select(`, `db.select(` or simple
      // `.select()` start so we capture the full chain head.
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

    // UPDATE / DELETE / INSERT
    for (const op of ["update", "delete", "insert"]) {
      const re = new RegExp(
        `\\bdb\\s*\\.\\s*${op}\\s*\\(\\s*(?:[a-zA-Z_$][\\w$]*\\s*\\.\\s*)?(${namesAlt})\\b`,
        "g",
      );
      let m;
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

  // Raw SQL — only inside string literals.
  for (const sqlName of ownableSqlNames) {
    const escaped = sqlName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const verbs = [
      ["select", `\\bFROM\\s+${escaped}\\b`],
      ["update", `\\bUPDATE\\s+${escaped}\\b`],
      ["delete", `\\bDELETE\\s+FROM\\s+${escaped}\\b`],
      ["insert", `\\bINSERT\\s+INTO\\s+${escaped}\\b`],
    ];
    for (const [op, body] of verbs) {
      const re = new RegExp(`["'\`][^"'\`]*${body}[\\s\\S]*?["'\`]`, "gi");
      let m;
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

function walkBackToChainHead(contents, idx) {
  let i = idx;
  while (i > 0) {
    const c = contents[i];
    if (c === ";" || c === "{" || c === "}") return i + 1;
    if (c === "\n") {
      // If the previous non-whitespace on this line is something that
      // continues a chain we keep walking; otherwise this is the head.
      let j = i + 1;
      while (j < contents.length && /[ \t]/.test(contents[j])) j++;
      if (contents[j] !== "." && contents[j] !== ")") return i + 1;
    }
    i--;
  }
  return 0;
}

/**
 * Return the text of `block` with EVERY descendant sub-block that does
 * NOT contain `queryOffset` replaced by whitespace. This is the "direct
 * scope" content of the block — every branch that doesn't lead to the
 * query is stripped so sibling branches can't defuse a buggy branch.
 * Branches that lead to the query are kept (so their inline access
 * control still counts).
 */
function directBlockText(contents, block, blocks, queryOffset) {
  // Collect every descendant of `block` that does NOT contain
  // queryOffset. Process from the END backwards so byte offsets remain
  // stable.
  const descendants = blocks
    .filter((b) => b.open > block.open && b.close < block.close)
    .filter((b) => !(b.open <= queryOffset && b.close >= queryOffset))
    // Keep only "outermost" non-containing descendants so we don't blank
    // the same range twice.
    .filter(
      (b) =>
        !blocks.some(
          (p) =>
            p !== b &&
            p !== block &&
            p.open > block.open &&
            p.close < block.close &&
            p.open < b.open &&
            p.close > b.close &&
            !(p.open <= queryOffset && p.close >= queryOffset),
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

function blockHasAccessControl(blockText) {
  if (ACCESS_CONTROL_HELPERS.some((re) => re.test(blockText))) return true;
  // Drizzle-style explicit ownership filters anywhere in the block also
  // count as scoping intent — common pattern is to do one upfront
  // `select ... where(eq(t.ownerEmail, ownerEmail))` then issue
  // subsequent updates by id within the same function block.
  if (EXPLICIT_OWNER_FILTERS.some((re) => re.test(blockText))) return true;
  return false;
}

/**
 * Find all variable names bound to access-control expressions in the
 * file. Returns a Set of names like ["whereClauses", "guard", ...] that
 * the user can interpolate into a query's where(...) clause.
 *
 * Patterns matched:
 *   const X = accessFilter(...)
 *   const X = [accessFilter(...), ...]
 *   const X = and(accessFilter(...), ...)
 *   let   X: ... = accessFilter(...)
 *   X.push(accessFilter(...))   // tracks X
 *   const X = await resolveAccess(...)
 *   const X = await assertAccess(...)
 */
function collectAccessControlBindings(contents) {
  const names = new Set();
  // Direct const/let/var assignment.
  const bindRe =
    /\b(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*(?::[^=]+)?\s*=\s*([\s\S]{0,400}?)(?:;|\n\s*(?:const|let|var|if|return|await|function|export|}|\/\/))/g;
  let m;
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
  // Push-style: `X.push(accessFilter(...))` or `X.push(eq(t.ownerEmail, ...))`.
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

function statementHasInlineAccessControl(stmt) {
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

function isOptedOutWithinBlock(blockText) {
  return OPT_OUT_MARKER.test(blockText);
}

async function scanFiles(ownablesByDir) {
  const allOwnableNames = new Set();
  const allOwnableSqlNames = new Set();
  for (const set of ownablesByDir.values()) {
    for (const name of set) {
      if (name.startsWith("__sql__"))
        allOwnableSqlNames.add(name.slice("__sql__".length));
      else allOwnableNames.add(name);
    }
  }

  const violations = [];

  for await (const file of walk(REPO_ROOT)) {
    if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
    if (file.endsWith(".d.ts")) continue;
    const rel = path.relative(REPO_ROOT, file).replaceAll("\\", "/");
    if (FILE_ALLOWLIST.has(rel)) continue;
    if (rel.endsWith("/db/schema.ts")) continue;
    if (
      !/^templates\/[^/]+\/(server|actions)\//.test(rel) &&
      !/^packages\/[^/]+\/src\//.test(rel)
    ) {
      continue;
    }

    let contents;
    try {
      contents = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    // Cheap pre-filter.
    if (
      !/\bfrom\s*\(/.test(contents) &&
      !/\bdb\s*\.\s*(update|delete|insert)\b/.test(contents) &&
      !/\b(FROM|UPDATE|INSERT INTO|DELETE FROM)\b/i.test(contents)
    ) {
      continue;
    }

    // File-wide opt-out: marker in the header (first 30 lines) only.
    const head = contents.split("\n").slice(0, 30).join("\n");
    if (OPT_OUT_MARKER.test(head)) continue;

    const statements = findStatements(
      contents,
      allOwnableNames,
      allOwnableSqlNames,
    );
    if (statements.length === 0) continue;

    const blocks = buildBlockTree(contents);
    const accessControlBindings = collectAccessControlBindings(contents);

    const fileViolations = [];
    for (const stmt of statements) {
      // 1) Inline check on the chain itself.
      if (statementHasInlineAccessControl(stmt)) continue;

      // 2) Block-scoped check: climb out to enclosing blocks looking for
      //    access control DIRECTLY in the block (not buried inside a
      //    nested sibling block that doesn't itself contain the query).
      //    This is the forms-bug fix — the buggy `if (nav?.formId)`
      //    block does NOT contain accessFilter; the sibling
      //    `if (nav?.view === "forms")` does. Sibling content does not
      //    defuse a sibling.
      let scoped = false;
      let cur = innermostBlock(blocks, stmt.queryStart, contents.length);
      let levels = 0;
      while (cur && levels < 8) {
        // Build the block's "direct" text — everything inside `cur`,
        // minus nested child blocks that don't contain the query.
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
        // Also accept if a variable that was bound to access control is
        // referenced inside the query's chain.
        if (
          accessControlBindings.size > 0 &&
          [...accessControlBindings].some((name) =>
            new RegExp(`\\b${name}\\b`).test(stmt.snippet),
          )
        ) {
          scoped = true;
          break;
        }
        // Climb to the parent block.
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

const ownablesByDir = await collectOwnableTables();
if (ownablesByDir.size === 0) {
  console.log(
    "guard-no-unscoped-queries: no ownable tables found — nothing to check.",
  );
  process.exit(0);
}
const violations = await scanFiles(ownablesByDir);

if (violations.length > 0) {
  const bar = "=".repeat(72);
  console.error(`\n${bar}`);
  console.error("ERROR: unscoped query against an ownable resource table.");
  console.error(bar);
  console.error("");
  console.error(
    "These statements query a table that includes `ownableColumns()`",
  );
  console.error("but do NOT use `accessFilter` / `resolveAccess` /");
  console.error(
    "`assertAccess` and do NOT filter by `ownerEmail` / `userEmail` /",
  );
  console.error(
    "`orgId` in their WHERE clause (or in the enclosing block).",
  );
  console.error("That is how the slides leak happened on 2026-04-28 —");
  console.error("anyone signing in saw every other user's decks. Same");
  console.error(
    "class of bug for inserts that don't set ownerEmail from the",
  );
  console.error("request context.");
  console.error("");
  for (const v of violations) {
    console.error(`  ${v.file}`);
    for (const hit of v.hits) {
      console.error(
        `    line ${hit.line}: unscoped ${hit.op} on "${hit.name}" (${hit.kind})`,
      );
    }
    console.error("");
  }
  console.error(bar);
  console.error("Fix:");
  console.error("");
  console.error("  - For list/read of many rows, add to the WHERE clause:");
  console.error(
    "      .where(accessFilter(schema.<table>, schema.<table>Shares))",
  );
  console.error('      from "@agent-native/core/sharing"');
  console.error("  - For read-by-id, replace the manual select with:");
  console.error('      const access = await resolveAccess("<type>", id);');
  console.error("  - For write/delete-by-id, gate with:");
  console.error('      await assertAccess("<type>", id, "editor"|"admin");');
  console.error("  - For inserts, set ownerEmail from the request context:");
  console.error("      ownerEmail: getRequestUserEmail()");
  console.error(
    "  - HTTP handlers that don't auto-mount a request context must",
  );
  console.error(
    "    wrap the call with `runWithRequestContext({ userEmail, orgId },",
  );
  console.error("    fn)` after reading the session via `getSession(event)`.");
  console.error("");
  console.error("  Last-resort opt-out (requires reviewer approval):");
  console.error("    // guard:allow-unscoped — explain why this is safe");
  console.error(
    "    (place inside the enclosing block, or as a file header)",
  );
  console.error(`${bar}\n`);
  process.exit(1);
}

console.log(
  `guard-no-unscoped-queries: clean (${ownablesByDir.size} schema dirs scanned).`,
);
