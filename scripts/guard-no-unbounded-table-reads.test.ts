import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findUnboundedTableReadViolations } from "./guard-no-unbounded-table-reads.mjs";

const FILE = "packages/core/src/settings/store.ts";

function allLines(source: string) {
  return new Set(source.split("\n").map((_, index) => index + 1));
}

function kinds(source: string, file = FILE, added = allLines(source)) {
  return findUnboundedTableReadViolations(file, source, added).map(
    (violation: { kind: string; snippet: string }) =>
      `${violation.kind}: ${violation.snippet}`,
  );
}

describe("unbounded table read guard", () => {
  it("rejects the whole-table reads that caused the transfer bills", () => {
    const source = `
      export async function load(client, idColumn, contentColumn, table) {
        const all = await getAllSettings().catch(() => ({}));
        await client.execute("SELECT key, value FROM public.settings");
        await client.execute('SELECT doc_id FROM _collab_docs');
        await client.execute(\`SELECT id, data FROM decks\`);
        await client.execute(
          \`SELECT \${idColumn}, \${contentColumn} FROM \${table}\`,
        );
        return all;
      }
    `;

    assert.deepEqual(kinds(source), [
      "getAllSettings: getAllSettings()",
      "sql: SELECT key, value FROM public.settings",
      "sql: SELECT doc_id FROM _collab_docs",
      "sql: SELECT id, data FROM decks",
      "sql: SELECT ${idColumn}, ${contentColumn} FROM ${table}",
    ]);
  });

  it("allows single-row aggregates and filtered or limited SQL", () => {
    const source = `
      await client.execute("SELECT MAX(version) as max_version FROM sync_events");
      await client.execute("SELECT version FROM sync_events WHERE id = ?");
      await client.execute("SELECT id, title FROM decks ORDER BY updated_at DESC LIMIT 20");
      await client.execute(\`
        SELECT COUNT(*) AS total, EXISTS (SELECT 1 FROM decks) AS any
        FROM decks
      \`);
      await client.execute("SELECT COUNT(*) AS total FROM decks GROUP BY owner_email");
      throw new Error("Select a file from your computer");
    `;

    assert.deepEqual(kinds(source), [
      "sql: SELECT COUNT(*) AS total FROM decks",
    ]);
  });

  it("does not let SQL keywords in literals or later statements bound a scan", () => {
    const source = `
      await client.execute("SELECT 'WHERE' AS label, id FROM first_table; SELECT id FROM second_table WHERE id = 1");
    `;

    assert.deepEqual(kinds(source), [
      "sql: SELECT 'WHERE' AS label, id FROM first_table",
    ]);
  });

  it("checks each SELECT branch independently across CTEs and subqueries", () => {
    const source = `
      await client.execute("WITH page AS (SELECT id FROM small_table LIMIT 1) SELECT * FROM large_table");
      await client.execute("SELECT id FROM first_table WHERE id = 1 UNION SELECT id FROM second_table");
      await client.execute("SELECT id, (SELECT id FROM tiny_table LIMIT 1) FROM large_table");
    `;

    assert.deepEqual(kinds(source), [
      "sql: SELECT * FROM large_table",
      "sql: SELECT id FROM second_table",
      "sql: SELECT id, (SELECT id FROM tiny_table LIMIT 1) FROM large_table",
    ]);
  });

  it("judges a Drizzle chain by its whole statement, not by line", () => {
    const source = [
      "const rows = await db",
      "  .select({ id: schema.decks.id })",
      "  .from(schema.decks)",
      "  .orderBy(schema.decks.updatedAt);",
      "const owned = await db",
      "  .select({ id: schema.decks.id })",
      "  .from(schema.decks)",
      "  .where(eq(schema.decks.ownerEmail, email));",
      "const page = await db.select().from(schema.decks).limit(20);",
      "let query = db.select().from(schema.decks).$dynamic();",
    ].join("\n");

    assert.deepEqual(kinds(source, FILE, new Set([4, 7, 9, 10])), [
      "drizzle: db .select({ id: schema.decks.id }) .from(schema.decks)",
      "drizzle: db.select().from(schema.decks)",
    ]);
  });

  it("checks each Drizzle query when one statement contains multiple chains", () => {
    const source = `
      const rows = await Promise.all([
        db.select().from(schema.decks).where(eq(schema.decks.ownerEmail, email)),
        db.select().from(schema.decks),
      ]);
    `;

    assert.deepEqual(kinds(source), [
      "drizzle: db.select().from(schema.decks)",
    ]);
  });

  it("only reports lines this branch added, in server code, without a pragma", () => {
    const source = [
      'await client.execute("SELECT id, data FROM decks");',
      "// guard:allow-unbounded-read — bounded config table, read once per job run.",
      'await client.execute("SELECT key, value FROM app_config");',
      'await client.execute("SELECT key, value FROM app_config"); // guard:allow-unbounded-read — same',
    ].join("\n");

    assert.deepEqual(kinds(source, FILE, new Set([3, 4])), []);
    assert.deepEqual(kinds(source, "packages/core/src/client/settings.ts"), []);
    assert.deepEqual(kinds(source, "templates/slides/app/routes/x.tsx"), []);
    assert.deepEqual(
      kinds(source, "packages/core/src/settings/store.spec.ts"),
      [],
    );
    assert.deepEqual(
      kinds(source, "templates/slides/server/plugins/collab.ts"),
      ["sql: SELECT id, data FROM decks"],
    );
  });
});
