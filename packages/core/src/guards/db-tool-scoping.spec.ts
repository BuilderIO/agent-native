import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scanDbToolScoping } from "./db-tool-scoping.js";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTempAppRoot(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-doctor-"));
  tmpRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

describe("scanDbToolScoping", () => {
  it("flags a table with no owner_email/org_id and no denylist entry", () => {
    const root = makeTempAppRoot({
      "server/db/schema.ts": [
        'import { table, text } from "@agent-native/core/db/schema";',
        "",
        'export const bigqueryCache = table("bigquery_cache", {',
        '  id: text("id").primaryKey(),',
        '  payload: text("payload"),',
        "});",
        "",
      ].join("\n"),
    });
    const result = scanDbToolScoping({ root });
    expect(result.name).toBe("db-tool-scoping");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].message).toMatch(/bigquery_cache/);
  });

  it("does not flag a table covered by the config denylist", () => {
    const root = makeTempAppRoot({
      "server/db/schema.ts": [
        'import { table, text } from "@agent-native/core/db/schema";',
        "",
        'export const bigqueryCache = table("bigquery_cache", {',
        '  id: text("id").primaryKey(),',
        '  payload: text("payload"),',
        "});",
        "",
      ].join("\n"),
    });
    const result = scanDbToolScoping({
      root,
      denylist: {
        bigquery_cache: "provider cache, not a user-facing resource",
      },
    });
    expect(result.findings).toHaveLength(0);
  });

  it("passes clean when the table has owner_email", () => {
    const root = makeTempAppRoot({
      "server/db/schema.ts": [
        'import { table, text } from "@agent-native/core/db/schema";',
        "",
        'export const decks = table("decks", {',
        '  id: text("id").primaryKey(),',
        '  ownerEmail: text("owner_email"),',
        "});",
        "",
      ].join("\n"),
    });
    const result = scanDbToolScoping({ root });
    expect(result.findings).toHaveLength(0);
  });

  it("flags a stale denylist entry with no matching table", () => {
    const root = makeTempAppRoot({
      "server/db/schema.ts": [
        'import { table, text } from "@agent-native/core/db/schema";',
        "",
        'export const decks = table("decks", {',
        '  id: text("id").primaryKey(),',
        '  ownerEmail: text("owner_email"),',
        "});",
        "",
      ].join("\n"),
    });
    const result = scanDbToolScoping({
      root,
      denylist: { nonexistent_table: "stale" },
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].message).toMatch(/Stale/);
  });
});

describe("composed table scope", () => {
  const scan = (
    helper: string,
    columns = "...pageColumns()",
    imports = 'import { ownableColumns } from "@agent-native/core/db/schema";',
  ) => {
    const root = makeTempAppRoot({
      "server/db/schema.ts": `${imports}\n${helper}\nexport const pages = pgTable("content_2_pages", { ${columns} });`,
    });
    return scanDbToolScoping({ root }).findings;
  };
  it("recognizes the actual parameterless composition and imported alias", () => {
    expect(
      scan(
        'export function pageColumns() { return { id: text("id"), ...ownableColumns() }; }',
      ),
    ).toHaveLength(0);
    expect(
      scan(
        "function pageColumns() { return { ...tenantColumns() }; }",
        "...pageColumns()",
        'import { ownableColumns as tenantColumns } from "@agent-native/core/db/schema";',
      ),
    ).toHaveLength(0);
  });
  it.each([
    [
      "unscoped helper",
      'function pageColumns() { return { id: text("id") }; }',
      "...pageColumns()",
    ],
    [
      "unused scoped decoy",
      'function decoy() { return { ...ownableColumns() }; } function pageColumns() { return { id: text("id") }; }',
      "...pageColumns()",
    ],
    [
      "conditional return",
      "function pageColumns() { if (flag) return { ...ownableColumns() }; return {}; }",
      "...pageColumns()",
    ],
    [
      "conditional object",
      "function pageColumns() { return flag ? { ...ownableColumns() } : {}; }",
      "...pageColumns()",
    ],
    [
      "cycle",
      "function pageColumns() { return { ...other() }; } function other() { return { ...pageColumns() }; }",
      "...pageColumns()",
    ],
    [
      "reassigned helper",
      "function pageColumns() { return { ...ownableColumns() }; } pageColumns = other;",
      "...pageColumns()",
    ],
    [
      "destructuring reassignment",
      "function pageColumns() { return { ...ownableColumns() }; } ({pageColumns} = other);",
      "...pageColumns()",
    ],
    [
      "for-of reassignment",
      "function pageColumns() { return { ...ownableColumns() }; } for (pageColumns of [() => ({})]) {}",
      "...pageColumns()",
    ],
    [
      "for-in reassignment",
      "function pageColumns() { return { ...ownableColumns() }; } for (pageColumns in other) {}",
      "...pageColumns()",
    ],
    [
      "for-of destructuring",
      "function pageColumns() { return { ...ownableColumns() }; } for ({pageColumns} of other) {}",
      "...pageColumns()",
    ],
    [
      "destructured shadow",
      "function pageColumns() { return { ...ownableColumns() }; } function other() { const {pageColumns} = source; }",
      "...pageColumns()",
    ],
    [
      "parameter shadow",
      "function pageColumns() { return { ...ownableColumns() }; } function other({pageColumns}) {}",
      "...pageColumns()",
    ],
    [
      "for-of declaration shadow",
      "function pageColumns() { return { ...ownableColumns() }; } for (const {pageColumns} of other) {}",
      "...pageColumns()",
    ],
    [
      "helper arguments",
      "function pageColumns() { return { ...ownableColumns() }; }",
      "...pageColumns(1)",
    ],
    [
      "scope override",
      'function pageColumns() { return { ...ownableColumns(), ownerEmail: text("wrong") }; }',
      "...pageColumns()",
    ],
    [
      "table scope override",
      "function pageColumns() { return { ...ownableColumns() }; }",
      '...pageColumns(), orgId: text("wrong")',
    ],
    [
      "unknown late spread",
      "function pageColumns() { return { ...ownableColumns() }; }",
      "...pageColumns(), ...unknown()",
    ],
    [
      "computed override",
      'function pageColumns() { return { ...ownableColumns(), [key]: text("wrong") }; }',
      "...pageColumns()",
    ],
    [
      "foreign import",
      "function pageColumns() { return { ...ownableColumns() }; }",
      "...pageColumns()",
      'import { ownableColumns } from "other";',
    ],
    [
      "shadowed framework import",
      "function pageColumns() { return { ...ownableColumns() }; } function another() { const ownableColumns = evil; }",
      "...pageColumns()",
    ],
  ])("rejects %s", (_label, helper, columns, imports) => {
    expect(scan(helper, columns, imports)).toHaveLength(1);
  });
  it("keeps direct org scope and stale denylist checks", () => {
    expect(
      scan("function pageColumns() { return {}; }", 'orgId: text("org_id")'),
    ).toHaveLength(0);
    const root = makeTempAppRoot({
      "server/db/schema.ts":
        'export const pages = pgTable("pages", { orgId: text("org_id") });',
    });
    expect(
      scanDbToolScoping({ root, denylist: { pages: "stale" } }).findings[0]
        .message,
    ).toMatch(/Stale/);
  });
});
