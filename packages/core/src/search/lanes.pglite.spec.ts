import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  isSchemaMutationStatement,
  type DbExec,
  type DbExecInput,
} from "../db/client.js";
import { MIGRATION_DEFERRED } from "../db/migrations.js";
import {
  ensurePgVectorIndex,
  PGVECTOR_REQUIRED_MESSAGE,
  pgVectorIndexMigration,
} from "./lanes.js";

function execFor(
  pg: PGlite,
  options: { refuseSchema?: boolean } = {},
): DbExec & { sent: string[] } {
  const sent: string[] = [];
  // raw-sql-ok: a test database that runs the statement it was sent; nothing is interpolated and values stay bound.
  return {
    sent,
    async execute(input: DbExecInput) {
      // raw-sql-ok: copies the statement it was sent; nothing is interpolated.
      const { sql, args } =
        typeof input === "string"
          ? { sql: input, args: [] as unknown[] }
          : { sql: input.sql, args: [...(input.args ?? [])] };
      sent.push(sql.trim());
      if (options.refuseSchema && isSchemaMutationStatement(input)) {
        throw new Error(
          "Schema mutation attempted in a production serverless request.",
        );
      }
      let index = 0;
      const numbered = sql.replace(/\?/g, () => `$${++index}`);
      const result = await pg.query(numbered, args);
      return { rows: result.rows, rowsAffected: result.affectedRows ?? 0 };
    },
  };
}

let pg: PGlite;
beforeEach(() => {
  pg = new PGlite();
});
afterEach(async () => {
  await pg.close();
});

async function releaseMadeTable(options: { audienceColumn: boolean }) {
  await pg.exec(
    "CREATE TABLE test_vectors_3 (vector_key TEXT PRIMARY KEY, embedding REAL[] NOT NULL)",
  );
  if (options.audienceColumn) {
    await pg.exec(
      "ALTER TABLE test_vectors_3 ADD COLUMN audience_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]",
    );
  }
  await pg.exec(
    "CREATE INDEX test_vectors_3_hnsw ON test_vectors_3 (vector_key)",
  );
  await pg.exec(
    "CREATE INDEX test_vectors_3_audience_gin ON test_vectors_3 (embedding)",
  );
}

describe("ensurePgVectorIndex on Postgres", () => {
  it("sends no schema statement for a table the release made", async () => {
    await releaseMadeTable({ audienceColumn: true });
    const request = execFor(pg, { refuseSchema: true });
    await ensurePgVectorIndex(request, 3, { namespace: "test" });
    expect(request.sent).toHaveLength(1);
    expect(
      request.sent.filter((sql) => isSchemaMutationStatement(sql)),
    ).toEqual([]);
  });

  it("checks the table its name finds, wherever it is on the search path", async () => {
    await releaseMadeTable({ audienceColumn: true });
    await pg.exec("CREATE SCHEMA app; SET search_path = app, public");
    const request = execFor(pg, { refuseSchema: true });
    await ensurePgVectorIndex(request, 3, { namespace: "test" });
    expect(request.sent).toHaveLength(1);
  });

  it("doesn't count indexes of the same names on another schema's table", async () => {
    await releaseMadeTable({ audienceColumn: true });
    await pg.exec(
      "CREATE SCHEMA app; SET search_path = app, public; CREATE TABLE app.test_vectors_3 (vector_key TEXT PRIMARY KEY, audience_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[])",
    );
    const request = execFor(pg, { refuseSchema: true });
    await expect(
      ensurePgVectorIndex(request, 3, { namespace: "test" }),
    ).rejects.toThrow(PGVECTOR_REQUIRED_MESSAGE);
    expect(request.sent[1]).toBe("CREATE EXTENSION IF NOT EXISTS vector");
  });

  it("still tries to make what an older table lacks", async () => {
    await releaseMadeTable({ audienceColumn: false });
    const request = execFor(pg, { refuseSchema: true });
    await expect(
      ensurePgVectorIndex(request, 3, { namespace: "test" }),
    ).rejects.toThrow(PGVECTOR_REQUIRED_MESSAGE);
    expect(request.sent[1]).toBe("CREATE EXTENSION IF NOT EXISTS vector");
  });
});

describe("pgVectorIndexMigration on Postgres", () => {
  it("waits for a later release on a database without pgvector", async () => {
    const release = execFor(pg);
    const migration = pgVectorIndexMigration({
      version: 1,
      name: "test-vectors",
      namespace: "test",
      dimensions: [3],
    });
    await expect(migration.run?.(release)).resolves.toBe(MIGRATION_DEFERRED);
    expect(release.sent).toEqual([
      "SELECT 1 AS present FROM pg_available_extensions WHERE name = 'vector'",
    ]);
  });
});
