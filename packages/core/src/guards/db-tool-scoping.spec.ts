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
