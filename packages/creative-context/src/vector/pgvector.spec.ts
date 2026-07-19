import { describe, expect, it, vi } from "vitest";

import {
  PGVECTOR_REQUIRED_MESSAGE,
  ensurePgVectorIndex,
  queryPgVectorIndex,
  upsertPgVector,
} from "./pgvector.js";

function mockDb(rows: unknown[] = []) {
  return {
    execute: vi.fn(async () => ({ rows, rowsAffected: 1 })),
  };
}

describe("pgvector creative-context lane", () => {
  it("fails only vector operations clearly outside Postgres", async () => {
    await expect(ensurePgVectorIndex(mockDb(), 3, false)).rejects.toThrow(
      PGVECTOR_REQUIRED_MESSAGE,
    );
  });

  it("creates a dimension-locked HNSW index in the corpus database", async () => {
    const db = mockDb();
    await ensurePgVectorIndex(db, 1024, true);
    expect(db.execute).toHaveBeenCalledWith(
      "CREATE EXTENSION IF NOT EXISTS vector",
    );
    expect(String(db.execute.mock.calls[1]?.[0])).toContain(
      "creative_context_vectors_1024",
    );
    expect(String(db.execute.mock.calls[3]?.[0])).toContain("USING hnsw");
  });

  it("binds vector values and validates the selected dimensions", async () => {
    const db = mockDb();
    await upsertPgVector(
      db,
      {
        vectorKey: "chunk:1",
        embeddingSetId: "set:1",
        dimensions: 3,
        vector: [0.25, 0.5, 0.75],
      },
      true,
    );
    const write = db.execute.mock.calls[5]?.[0] as {
      sql: string;
      args: unknown[];
    };
    expect(write.sql).toContain("?::vector");
    expect(write.args.slice(0, 3)).toEqual([
      "chunk:1",
      "set:1",
      "[0.25,0.5,0.75]",
    ]);
    await expect(
      upsertPgVector(
        db,
        {
          vectorKey: "bad",
          embeddingSetId: "set:1",
          dimensions: 2,
          vector: [1],
        },
        true,
      ),
    ).rejects.toThrow("expected 2");
  });

  it("limits vector results to access-filtered vector keys", async () => {
    const db = mockDb([
      { vector_key: "media:1", embedding_set_id: "set:1", score: 0.91 },
    ]);
    const hits = await queryPgVectorIndex(
      db,
      {
        embeddingSetId: "set:1",
        dimensions: 2,
        vector: [0.5, 0.5],
        allowedVectorKeys: ["media:1"],
      },
      true,
    );
    expect(db.execute.mock.calls[0]?.[0]).toBe(
      "SET hnsw.iterative_scan = strict_order",
    );
    const query = db.execute.mock.calls[1]?.[0] as {
      sql: string;
      args: unknown[];
    };
    expect(query.sql).toContain("vector_key IN (?)");
    expect(query.args).toContain("media:1");
    expect(hits).toEqual([
      { vectorKey: "media:1", embeddingSetId: "set:1", score: 0.91 },
    ]);
  });
});
