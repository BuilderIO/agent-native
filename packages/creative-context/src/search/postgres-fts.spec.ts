import { describe, expect, it, vi } from "vitest";

import { queryPostgresFts } from "./postgres-fts.js";

describe("Postgres creative-context FTS", () => {
  it("filters every Postgres candidate through accessible chunk ids", async () => {
    const db = {
      execute: vi.fn().mockResolvedValueOnce({
        rows: [{ chunk_id: "allowed", item_version_id: "v1", score: 0.8 }],
        rowsAffected: 0,
      }),
    };
    const hits = await queryPostgresFts(db, {
      query: "pricing slide",
      allowedChunkIds: ["allowed"],
    });
    const query = db.execute.mock.calls[0]?.[0] as {
      sql: string;
      args: unknown[];
    };
    expect(query.sql).toContain("chunk_id IN (?)");
    expect(query.args).toContain("allowed");
    expect(hits[0]?.score).toBe(0.8);
  });

  it("can search the global FTS index before access-scoped hydration", async () => {
    const db = {
      execute: vi.fn().mockResolvedValueOnce({
        rows: [{ chunk_id: "late", item_version_id: "v9", score: 0.9 }],
        rowsAffected: 0,
      }),
    };
    const hits = await queryPostgresFts(db, {
      query: "pricing slide",
    });
    const query = db.execute.mock.calls[0]?.[0] as {
      sql: string;
      args: unknown[];
    };
    expect(query.sql).not.toContain("chunk_id IN");
    expect(query.args).toEqual(["pricing slide", "pricing slide", 40]);
    expect(hits).toEqual([
      { chunkId: "late", itemVersionId: "v9", score: 0.9 },
    ]);
  });
});
