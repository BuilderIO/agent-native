import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

type Ops = typeof import("./operations.js");

let pglite: Awaited<ReturnType<typeof createTestPglite>>;

const sharedClient = {
  async execute(arg: string | { sql: string; args?: unknown[] }) {
    const sql = typeof arg === "string" ? arg : arg.sql;
    const args = typeof arg === "string" ? [] : (arg.args ?? []);
    const statement = pglite.prepare(sql);
    if (/^\s*(select|with)\b/i.test(sql)) {
      return { rows: await statement.all(...args), rowsAffected: 0 };
    }
    const result = await statement.run(...args);
    return { rows: [], rowsAffected: Number(result.changes ?? 0) };
  },
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => sharedClient,
}));

async function loadOps(): Promise<{ ops: Ops; dbUrl: string }> {
  // notifyActionChange writes to the settings/application_state tables which
  // are not migrated in this isolated test DB — stub it out so mutating ops
  // don't fail on the change-notify side effect.
  vi.doMock("../server/action-change.js", () => ({
    notifyActionChange: vi.fn(async () => {}),
  }));

  const ops = (await import("./operations.js")) as Ops;
  await pglite.exec(
    `CREATE TABLE authors (
       id SERIAL PRIMARY KEY,
       name TEXT NOT NULL,
       email TEXT
     )`,
  );
  await pglite.exec(
    `CREATE TABLE books (
       id SERIAL PRIMARY KEY,
       title TEXT NOT NULL,
       author_id INTEGER,
       pages INTEGER,
       FOREIGN KEY (author_id) REFERENCES authors(id)
     )`,
  );
  await pglite.exec(
    `CREATE TABLE logs (
       id SERIAL PRIMARY KEY,
       payload TEXT NOT NULL
     )`,
  );
  await pglite.exec(`CREATE UNIQUE INDEX idx_authors_email ON authors(email)`);
  await pglite.exec(`CREATE VIEW author_book_counts AS
       SELECT a.id AS author_id, COUNT(b.id) AS books
       FROM authors a LEFT JOIN books b ON b.author_id = a.id
       GROUP BY a.id`);

  await pglite.exec(
    `INSERT INTO authors (id, name, email) VALUES (1, 'Ada', 'ada@example.com'), (2, 'Bob', 'bob@example.com')`,
  );
  for (let i = 1; i <= 5; i++) {
    await pglite
      .prepare(
        `INSERT INTO books (id, title, author_id, pages) VALUES (?, ?, ?, ?)`,
      )
      .run(i, `Book ${i}`, (i % 2) + 1, i * 10);
  }
  await pglite
    .prepare(`INSERT INTO logs (id, payload) VALUES (?, ?)`)
    .run(1, "x".repeat(20_000));

  return { ops };
}

beforeEach(async () => {
  pglite = await createTestPglite();
});

afterEach(async () => {
  await pglite.close();
  vi.resetModules();
  vi.restoreAllMocks();
  vi.doUnmock("../server/action-change.js");
});

describe("listTables", () => {
  it("lists tables and views with row counts (null for views)", async () => {
    const { ops } = await loadOps();
    const { tables } = await ops.listTables();

    const byName = new Map(tables.map((t) => [t.name, t]));
    expect(byName.get("authors")).toMatchObject({
      type: "table",
      rowCount: 2,
    });
    expect(byName.get("books")).toMatchObject({ type: "table", rowCount: 5 });
    const view = byName.get("author_book_counts");
    expect(view?.type).toBe("view");
    expect(view?.rowCount).toBeNull();
  });

  it("can cap table row-count queries while retaining table metadata", async () => {
    const { ops } = await loadOps();
    const { tables } = await ops.listTables(undefined, { maxRowCounts: 1 });

    expect(tables.find((table) => table.name === "authors")?.rowCount).toBe(2);
    expect(tables.find((table) => table.name === "books")?.rowCount).toBeNull();
    expect(
      tables.find((table) => table.name === "author_book_counts")?.rowCount,
    ).toBeNull();
  });
});

describe("getTableSchema", () => {
  it("returns columns, pk, fk, indexes, and types", async () => {
    const { ops } = await loadOps();
    const schema = await ops.getTableSchema("books");

    expect(schema.type).toBe("table");
    expect(schema.rowCount).toBe(5);
    expect(schema.primaryKey).toEqual(["id"]);

    const cols = new Map(schema.columns.map((c) => [c.name, c]));
    expect(cols.get("id")).toMatchObject({ pk: true, autoIncrement: true });
    expect(cols.get("title")).toMatchObject({ nullable: false });
    expect(cols.get("pages")?.type.toLowerCase()).toContain("int");

    expect(schema.foreignKeys).toEqual([
      { column: "author_id", refTable: "authors", refColumn: "id" },
    ]);

    const authors = await ops.getTableSchema("authors");
    const idx = authors.indexes.find((i) => i.name === "idx_authors_email");
    expect(idx).toMatchObject({ unique: true, columns: ["email"] });
  });

  it("rejects invalid table identifiers", async () => {
    const { ops } = await loadOps();
    await expect(
      ops.getTableSchema("books; DROP TABLE authors"),
    ).rejects.toThrow(/invalid table name/i);
  });
});

describe("getRows", () => {
  it("supports filters, sort, pagination, and total", async () => {
    const { ops } = await loadOps();

    const eq = await ops.getRows("books", {
      page: 1,
      pageSize: 50,
      filters: [{ column: "author_id", op: "eq", value: 1 }],
    });
    // books with id 1,3,5 -> author_id (i%2)+1 = 2,2,2; id 2,4 -> 1.
    expect(eq.total).toBe(2);
    expect(eq.rows.every((r) => r.author_id === 1)).toBe(true);

    const sorted = await ops.getRows("books", {
      page: 1,
      pageSize: 2,
      sort: [{ column: "pages", dir: "desc" }],
    });
    expect(sorted.total).toBe(5);
    expect(sorted.rows).toHaveLength(2);
    expect(sorted.rows[0].pages).toBe(50);
    expect(sorted.rows[1].pages).toBe(40);

    const page2 = await ops.getRows("books", {
      page: 2,
      pageSize: 2,
      sort: [{ column: "id", dir: "asc" }],
    });
    expect(page2.rows.map((r) => r.id)).toEqual([3, 4]);

    const inFilter = await ops.getRows("books", {
      page: 1,
      pageSize: 50,
      filters: [{ column: "id", op: "in", value: [1, 2] }],
    });
    expect(inFilter.total).toBe(2);

    const like = await ops.getRows("authors", {
      page: 1,
      pageSize: 50,
      filters: [{ column: "name", op: "like", value: "Ad%" }],
    });
    expect(like.rows.map((r) => r.name)).toEqual(["Ada"]);

    const notNull = await ops.getRows("authors", {
      page: 1,
      pageSize: 50,
      filters: [{ column: "email", op: "not_null" }],
    });
    expect(notNull.total).toBe(2);

    expect(eq.columns.some((c) => c.name === "title")).toBe(true);
  });

  it("previews large text cells unless explicitly requested", async () => {
    const { ops } = await loadOps();

    const preview = await ops.getRows("logs", {
      page: 1,
      pageSize: 10,
    });
    expect(preview.rows[0].payload).toEqual(
      expect.stringContaining("db-admin truncated large cell"),
    );
    expect(String(preview.rows[0].payload).length).toBeLessThan(17_000);
    expect(preview.truncatedCells).toBe(1);
    expect(preview.columns.find((c) => c.name === "payload")).toMatchObject({
      largeValuePreview: true,
    });

    const full = await ops.getRows("logs", {
      page: 1,
      pageSize: 10,
      includeLargeCells: true,
    });
    expect(full.rows[0].payload).toBe("x".repeat(20_000));
    expect(full.truncatedCells).toBe(0);
  });

  it("marks jsonb columns as large-value previewable", async () => {
    const { ops } = await loadOps();
    const runtime = {
      db: {
        execute: vi.fn(async (query: any) => {
          const sql = typeof query === "string" ? query : query.sql;
          if (sql.includes("information_schema.tables")) {
            return { rows: [{ type: "BASE TABLE" }] };
          }
          if (sql.includes("information_schema.columns")) {
            return {
              rows: [
                {
                  name: "id",
                  type: "text",
                  nullable: 0,
                  dflt: null,
                },
                {
                  name: "payload",
                  type: "jsonb",
                  nullable: 1,
                  dflt: null,
                },
              ],
            };
          }
          if (sql.includes("table_constraints")) return { rows: [] };
          if (sql.includes("pg_indexes")) return { rows: [] };
          if (sql.includes("COUNT(*)")) return { rows: [{ c: 1 }] };
          if (sql.includes("SELECT"))
            return { rows: [{ id: "1", payload: "{}" }] };
          return { rows: [] };
        }),
      },
    };

    const result = await ops.getRows(
      "audit_log",
      { page: 1, pageSize: 10 },
      runtime,
    );

    expect(
      result.columns.find((column) => column.name === "payload"),
    ).toMatchObject({ largeValuePreview: true });
    expect((runtime.db.execute as any).mock.calls.at(-1)?.[0].sql).toContain(
      'CAST("payload" AS TEXT)',
    );
  });
});

describe("applyMutations", () => {
  it("dryRun returns SQL without executing", async () => {
    const { ops } = await loadOps();
    const result = await ops.applyMutations("authors", {
      inserts: [{ id: 99, name: "Zed" }],
      dryRun: true,
    });
    expect(result.inserted).toBe(0);
    expect(result.sql).toHaveLength(1);
    expect(result.sql[0]).toContain('INSERT INTO "authors"');

    // Row must NOT exist after a dryRun.
    const rows = await ops.getRows("authors", {
      page: 1,
      pageSize: 50,
      filters: [{ column: "id", op: "eq", value: 99 }],
    });
    expect(rows.total).toBe(0);
  });

  it("executes insert, update, and delete", async () => {
    const { ops } = await loadOps();

    const ins = await ops.applyMutations("authors", {
      inserts: [{ id: 3, name: "Cara", email: "cara@example.com" }],
    });
    expect(ins.inserted).toBe(1);

    const upd = await ops.applyMutations("authors", {
      updates: [{ where: { id: 3 }, set: { name: "Cara Updated" } }],
    });
    expect(upd.updated).toBe(1);

    const check = await ops.getRows("authors", {
      page: 1,
      pageSize: 50,
      filters: [{ column: "id", op: "eq", value: 3 }],
    });
    expect(check.rows[0].name).toBe("Cara Updated");

    const del = await ops.applyMutations("authors", {
      deletes: [{ id: 3 }],
    });
    expect(del.deleted).toBe(1);

    const after = await ops.getRows("authors", {
      page: 1,
      pageSize: 50,
      filters: [{ column: "id", op: "eq", value: 3 }],
    });
    expect(after.total).toBe(0);
  });

  it("rejects an update without a where clause", async () => {
    const { ops } = await loadOps();
    await expect(
      ops.applyMutations("authors", {
        updates: [{ where: {}, set: { name: "X" } }],
      }),
    ).rejects.toThrow(/where/i);
  });

  it("rejects previewed large-cell values in mutations", async () => {
    const { ops } = await loadOps();
    const preview = await ops.getRows("logs", {
      page: 1,
      pageSize: 10,
    });
    const payload = String(preview.rows[0].payload);

    await expect(
      ops.applyMutations("logs", {
        updates: [{ where: { id: 1 }, set: { payload } }],
      }),
    ).rejects.toThrow(/previewed large-cell value/i);
  });
});

describe("runSql", () => {
  it("auto-appends LIMIT to a bare SELECT", async () => {
    const { ops } = await loadOps();
    const result = await ops.runSql("SELECT * FROM books", undefined, {});
    expect(result.columns).toContain("title");
    expect(result.rows.length).toBe(5);
  });

  it("respects an explicit LIMIT and bind params", async () => {
    const { ops } = await loadOps();
    const result = await ops.runSql(
      "SELECT * FROM books WHERE author_id = ? ORDER BY id LIMIT 1",
      [2],
      {},
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].author_id).toBe(2);
  });

  it("truncates large cells in arbitrary SQL results", async () => {
    const { ops } = await loadOps();
    const result = await ops.runSql("SELECT payload FROM logs", undefined, {});

    expect(result.truncatedCells).toBe(1);
    expect(result.rows[0].payload).toEqual(
      expect.stringContaining("db-admin truncated large cell"),
    );
    expect(String(result.rows[0].payload).length).toBeLessThan(17_000);
  });

  it("throws needsConfirm for destructive statements without confirmation", async () => {
    const { ops } = await loadOps();
    await expect(
      ops.runSql("DELETE FROM books", undefined, {}),
    ).rejects.toMatchObject({ needsConfirm: true });
    await expect(
      ops.runSql("DROP TABLE books", undefined, {}),
    ).rejects.toMatchObject({ needsConfirm: true });

    // Comment-stripping: a DELETE with only a commented-out WHERE is destructive.
    await expect(
      ops.runSql("DELETE FROM books -- WHERE id = 1", undefined, {}),
    ).rejects.toMatchObject({ needsConfirm: true });
  });

  it("allows destructive statements with confirmDestructive", async () => {
    const { ops } = await loadOps();
    const result = await ops.runSql("DELETE FROM books", undefined, {
      confirmDestructive: true,
    });
    expect(result.rowsAffected).toBe(5);
  });
});
