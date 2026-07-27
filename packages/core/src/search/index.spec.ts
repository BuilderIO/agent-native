import { describe, expect, it, vi } from "vitest";

const { isPostgres } = vi.hoisted(() => ({ isPostgres: vi.fn(() => true) }));
vi.mock("../db/index.js", () => ({ isPostgres }));

import {
  queryPgVectorIndex,
  queryPostgresFts,
  searchNamespaceIdentifiers,
} from "./index.js";

describe("shared Postgres search", () => {
  it("keeps Creative Context's default identifiers stable", () => {
    expect(searchNamespaceIdentifiers(undefined, 1024)).toMatchObject({
      ftsTable: "creative_context_search_documents",
      ftsIndex: "creative_context_search_documents_gin",
      vectorTable: "creative_context_vectors_1024",
      vectorIndex: "creative_context_vectors_1024_hnsw",
    });
    expect(() => searchNamespaceIdentifiers("brain-search")).toThrow(
      /namespace/,
    );
  });

  it("filters FTS by allowed audience ids without chunk enumeration", async () => {
    const db = { execute: vi.fn(async () => ({ rows: [], rowsAffected: 0 })) };
    await queryPostgresFts(db, {
      query: "pricing",
      allowedAudienceIds: ["team:design", "team:brand"],
      namespace: "brain",
    });
    const query = db.execute.mock.calls[0]?.[0] as {
      sql: string;
      args: unknown[];
    };
    expect(query.sql).toContain("audience_ids && ARRAY[?, ?]::TEXT[]");
    expect(query.sql).not.toContain("chunk_id IN");
    expect(query.args).toContain("team:design");
  });

  it("keeps FTS retrieval read-only and tolerates a namespace before its first write", async () => {
    const db = {
      execute: vi.fn(async () => {
        throw { code: "42P01" };
      }),
    };
    await expect(
      queryPostgresFts(db, { query: "pricing", namespace: "brain" }),
    ).resolves.toEqual([]);
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(String(db.execute.mock.calls[0]?.[0].sql)).not.toMatch(
      /CREATE|ALTER/i,
    );
  });

  it("filters vector search by allowed audience ids without vector enumeration", async () => {
    const db = { execute: vi.fn(async () => ({ rows: [], rowsAffected: 0 })) };
    await queryPgVectorIndex(
      db,
      {
        embeddingSetId: "set",
        dimensions: 2,
        vector: [0.5, 0.5],
        allowedAudienceIds: ["team:design"],
        namespace: "brain",
      },
      true,
    );
    const query = db.execute.mock.calls[1]?.[0] as {
      sql: string;
      args: unknown[];
    };
    expect(query.sql).toContain("audience_ids && ARRAY[?]::TEXT[]");
    expect(query.sql).not.toContain("vector_key IN");
    expect(query.args).toContain("team:design");
  });
});
