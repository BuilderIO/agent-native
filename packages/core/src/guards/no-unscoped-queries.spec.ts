import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scanUnscopedQueries } from "./no-unscoped-queries.js";

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

const SCHEMA_TS = [
  'import { table, text } from "@agent-native/core/db/schema";',
  "",
  'export const decks = table("decks", {',
  '  id: text("id").primaryKey(),',
  "  ...ownableColumns(),",
  "});",
  "",
].join("\n");

describe("scanUnscopedQueries", () => {
  it("flags an unscoped statement in a file that uses access control elsewhere", () => {
    const root = makeTempAppRoot({
      "server/db/schema.ts": SCHEMA_TS,
      "actions/list-decks.ts": [
        'import { accessFilter } from "@agent-native/core/sharing";',
        'import { db } from "../server/db";',
        'import { decks, decksShares } from "../server/db/schema";',
        "",
        "export async function listDecksSafe() {",
        "  return db.select().from(decks).where(accessFilter(decks, decksShares));",
        "}",
        "",
        "export async function listDecksUnsafe() {",
        "  return db.select().from(decks);",
        "}",
        "",
      ].join("\n"),
    });
    const result = scanUnscopedQueries({ root });
    expect(result.name).toBe("no-unscoped-queries");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].file).toBe("actions/list-decks.ts");
    expect(result.findings[0].message).toMatch(/unscoped select on "decks"/);
  });

  it("does not flag an unscoped statement opted out within its block", () => {
    const root = makeTempAppRoot({
      "server/db/schema.ts": SCHEMA_TS,
      "actions/list-decks.ts": [
        'import { accessFilter } from "@agent-native/core/sharing";',
        'import { db } from "../server/db";',
        'import { decks, decksShares } from "../server/db/schema";',
        "",
        "export async function listDecksSafe() {",
        "  return db.select().from(decks).where(accessFilter(decks, decksShares));",
        "}",
        "",
        "export async function listDecksUnsafe() {",
        "  // guard:allow-unscoped — test fixture, anonymous read intentional",
        "  return db.select().from(decks);",
        "}",
        "",
      ].join("\n"),
    });
    const result = scanUnscopedQueries({ root });
    expect(result.findings).toHaveLength(0);
  });

  it("passes clean when every statement is scoped", () => {
    const root = makeTempAppRoot({
      "server/db/schema.ts": SCHEMA_TS,
      "actions/list-decks.ts": [
        'import { accessFilter } from "@agent-native/core/sharing";',
        'import { db } from "../server/db";',
        'import { decks, decksShares } from "../server/db/schema";',
        "",
        "export async function listDecksSafe() {",
        "  return db.select().from(decks).where(accessFilter(decks, decksShares));",
        "}",
        "",
      ].join("\n"),
    });
    const result = scanUnscopedQueries({ root });
    expect(result.findings).toHaveLength(0);
  });
});
