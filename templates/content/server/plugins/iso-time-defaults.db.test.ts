import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { desc, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `iso-time-defaults-test-${process.pid}-${Date.now()}.pglite`,
);

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

type Schema = typeof import("../db/schema.js");
let getDb: typeof import("../db/index.js").getDb;
let schema: Schema;
let isoTimeDefaultsSql: typeof import("./db.js").isoTimeDefaultsSql;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const plugin = await import("./db.js");
  isoTimeDefaultsSql = plugin.isoTimeDefaultsSql;
  await plugin.default(undefined as never);
}, 60000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

async function runStatements(sql: string) {
  // raw-sql-ok: runs the migration's own statements unchanged; it builds no SQL.
  for (const statement of sql.split(";\n")) {
    await getDbExec().execute(statement);
  }
}

describe("times the database stamps itself", () => {
  it("every text column that defaults to the current time writes the app's ISO shape", async () => {
    const { rows } = await getDbExec().execute(`
      SELECT table_name, column_name, column_default
        FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND data_type = 'text'
         AND column_default ~* '(now\\(\\)|current_timestamp)'`);
    const columns = rows as Array<{
      table_name: string;
      column_name: string;
      column_default: string;
    }>;
    expect(columns.length).toBeGreaterThan(70);
    const otherShapes = columns
      .filter((column) => !column.column_default.startsWith("to_char("))
      .map(
        (column) =>
          `${column.table_name}.${column.column_name}: ${column.column_default}`,
      );
    // Fix: default the column to CONTENT_ISO_NOW_SQL from server/plugins/db.ts.
    expect(otherShapes).toEqual([]);
  });

  it("sorts a page the database stamped among pages the app stamped by time", async () => {
    const db = getDb();
    const earlier = new Date(Date.now() - 60_000).toISOString();
    await db.insert(schema.documents).values({
      id: "doc_app_stamped",
      title: "Edited a minute ago",
      createdAt: earlier,
      updatedAt: earlier,
    });
    await db.insert(schema.documents).values({
      id: "doc_database_stamped",
      title: "Edited just now",
    });

    const recent = await db
      .select({
        id: schema.documents.id,
        updatedAt: schema.documents.updatedAt,
      })
      .from(schema.documents)
      .where(
        inArray(schema.documents.id, [
          "doc_app_stamped",
          "doc_database_stamped",
        ]),
      )
      .orderBy(desc(schema.documents.updatedAt), schema.documents.id);

    expect(recent.map((row) => row.id)).toEqual([
      "doc_database_stamped",
      "doc_app_stamped",
    ]);
    expect(recent[0]?.updatedAt).toMatch(ISO_TIME);
  });

  it("rewrites times the old default wrote and leaves everything else as it was", async () => {
    const rows: Array<[id: string, time: string]> = [
      ["doc_postgres_utc", "2026-11-11 21:52:00.123456+00"],
      ["doc_postgres_offset", "2026-11-11 16:52:00-05"],
      ["doc_iso", "2026-11-11T21:52:00.123Z"],
      ["doc_other_text", "yesterday"],
    ];
    for (const [id, time] of rows) {
      await getDbExec().execute({
        sql: "INSERT INTO documents (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
        args: [id, id, time, time],
      });
    }

    await runStatements(
      isoTimeDefaultsSql({ documents: ["created_at", "updated_at"] }),
    );

    const stored = await getDb()
      .select({
        id: schema.documents.id,
        createdAt: schema.documents.createdAt,
        updatedAt: schema.documents.updatedAt,
      })
      .from(schema.documents)
      .where(
        inArray(
          schema.documents.id,
          rows.map(([id]) => id),
        ),
      );
    const byId = new Map(
      stored.map((row) => [row.id, [row.createdAt, row.updatedAt]] as const),
    );
    expect(byId.get("doc_postgres_utc")).toEqual([
      "2026-11-11T21:52:00.123Z",
      "2026-11-11T21:52:00.123Z",
    ]);
    expect(byId.get("doc_postgres_offset")).toEqual([
      "2026-11-11T21:52:00.000Z",
      "2026-11-11T21:52:00.000Z",
    ]);
    expect(byId.get("doc_iso")).toEqual([
      "2026-11-11T21:52:00.123Z",
      "2026-11-11T21:52:00.123Z",
    ]);
    expect(byId.get("doc_other_text")).toEqual(["yesterday", "yesterday"]);
  });
});
