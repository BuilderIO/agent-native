/**
 * scanDbToolScoping — ported from `scripts/guard-db-tool-scoping.mjs`.
 *
 * The agent's raw DB tools (`db-query`, `db-exec`, `db-patch`) can only
 * safely expose tables with an explicit tenant scope (`owner_email` and/or
 * `org_id`) or a documented, reviewed exception. This guard keeps schema
 * drift visible: any table without raw-DB scope must either add
 * `owner_email`/`org_id`, or be added to the denylist with a
 * reviewer-readable reason.
 *
 * Conditional guard — per report 005's V1 guard set table: the original
 * walks every `templates/*\/server/db/schema.ts` and keys its denylist
 * `"<template>:<table>"`. A generated app has exactly one
 * `server/db/schema.ts` (confirmed convention), so this port scans that
 * single file and uses bare `"<table>"` denylist keys. The denylist itself
 * comes from `agent-native.json`'s `doctor.dbToolScopingDenylist` (see
 * `../cli/doctor.ts`) — empty by default; app authors add entries with the
 * same reviewer-readable-reason convention as the original constant.
 *
 * Not ported: the original also resolves `export * from
 * "@agent-native/<pkg>/schema"` re-exports back to that package's
 * `packages/<pkg>/src/schema/*.ts` monorepo source, so template schemas
 * that re-export scheduling/dispatch tables get scanned too. In a
 * generated app those packages are compiled `node_modules` output (no
 * `.ts` source to brace-parse), and report 005's parameterization note
 * doesn't cover that case, so re-export resolution is intentionally
 * dropped for app mode: a re-exported table from an `@agent-native/*`
 * package is not scanned here (false-negative, not false-positive) — see
 * the plan's STOP-condition guidance ("report rather than invent new
 * detection logic").
 */

import { readFileSafe, relPosix, walk } from "./scan-utils.js";
import type { GuardFinding, GuardResult, GuardScanOptions } from "./types.js";

export interface DbToolScopingOptions extends GuardScanOptions {
  /** Table name -> reviewer-readable reason. Default `{}`. */
  denylist?: Record<string, string>;
}

interface TableCall {
  exportName: string;
  sqlName: string;
  body: string;
}

function extractTableCalls(contents: string): TableCall[] {
  const out: TableCall[] = [];
  const headerRegex =
    /export\s+const\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:[a-zA-Z_$][\w$]*Table|table)\s*\(\s*"([^"]+)"\s*,\s*\{/gm;
  let match: RegExpExecArray | null;
  while ((match = headerRegex.exec(contents)) !== null) {
    const exportName = match[1];
    const sqlName = match[2];
    const start = headerRegex.lastIndex - 1;
    let depth = 0;
    let inStr: string | null = null;
    let bodyEnd = -1;
    for (let i = start; i < contents.length; i++) {
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
    out.push({ exportName, sqlName, body: contents.slice(start + 1, bodyEnd) });
  }
  return out;
}

function hasRawDbScope(tableBody: string): boolean {
  return (
    /\.\.\.ownableColumns\s*\(/.test(tableBody) ||
    /\b[\w$]+\s*:\s*text\s*\(\s*["']owner_email["']/.test(tableBody) ||
    /\b[\w$]+\s*:\s*text\s*\(\s*["']org_id["']/.test(tableBody)
  );
}

export function scanDbToolScoping(options: DbToolScopingOptions): GuardResult {
  const { root, denylist = {} } = options;
  const findings: GuardFinding[] = [];
  const seenAllowed = new Set<string>();

  for (const file of walk(root)) {
    if (!file.endsWith("/server/db/schema.ts")) continue;
    const contents = readFileSafe(file);
    if (contents === null) continue;
    const rel = relPosix(root, file);
    const tables = extractTableCalls(contents);
    for (const table of tables) {
      if (hasRawDbScope(table.body)) continue;
      if (Object.hasOwn(denylist, table.sqlName)) {
        seenAllowed.add(table.sqlName);
        continue;
      }
      findings.push({
        file: rel,
        line: 1,
        message: `Table "${table.sqlName}" (export ${table.exportName}) has no owner_email/org_id scope and is not on the doctor.dbToolScopingDenylist — add tenant scope, or add it to agent-native.json's "doctor.dbToolScopingDenylist" with a reason.`,
      });
    }
  }

  for (const key of Object.keys(denylist)) {
    if (!seenAllowed.has(key)) {
      findings.push({
        file: "agent-native.json",
        line: 1,
        message: `Stale doctor.dbToolScopingDenylist entry "${key}" — no matching table found in server/db/schema.ts. Remove it.`,
      });
    }
  }

  return { name: "db-tool-scoping", findings };
}
