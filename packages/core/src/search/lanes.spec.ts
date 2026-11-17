import { afterEach, describe, expect, it, vi } from "vitest";

import type { DbExecInput } from "../db/client.js";
import {
  assertPgVectorAvailable,
  DEFAULT_SEARCH_NAMESPACE,
  deletePgVectors,
  deletePostgresFtsDocuments,
  ensurePgVectorIndex,
  ensurePostgresFts,
  PGVECTOR_REQUIRED_MESSAGE,
  queryPgVectorIndex,
  queryPostgresFts,
  reciprocalRankFusion,
  searchNamespaceIdentifiers,
  upsertPgVector,
  upsertPostgresFtsDocument,
} from "./lanes.js";

interface Statement {
  sql: string;
  args: unknown[];
}

/** A database that records each statement and answers from `respond`. */
function recordingDb(
  respond: (
    statement: Statement,
  ) =>
    | { rows?: unknown[]; rowsAffected?: number }
    | Promise<never> = () => ({}),
) {
  const statements: Statement[] = [];
  // raw-sql-ok: a fake database that records the statements it is sent; it runs none.
  return {
    statements,
    sql: () => statements.map((statement) => statement.sql.trim()),
    db: {
      async execute(input: DbExecInput) {
        // raw-sql-ok: copies the statement it was sent into the record; nothing runs.
        const statement =
          typeof input === "string"
            ? { sql: input, args: [] }
            : "sql" in input && typeof input.sql === "string"
              ? { sql: input.sql, args: [...(input.args ?? [])] }
              : { sql: String(input), args: [] };
        statements.push(statement);
        const answer = await respond(statement);
        return {
          rows: answer.rows ?? [],
          rowsAffected: answer.rowsAffected ?? 0,
        };
      },
    },
  };
}

const placeholders = (sql: string) => sql.split("?").length - 1;

afterEach(() => {
  vi.useRealTimers();
});

describe("searchNamespaceIdentifiers", () => {
  it("names every table and index after the namespace", () => {
    expect(searchNamespaceIdentifiers()).toEqual({
      namespace: DEFAULT_SEARCH_NAMESPACE,
      ftsTable: "creative_context_search_documents",
      ftsIndex: "creative_context_search_documents_gin",
      ftsAudienceIndex: "creative_context_search_documents_audience_gin",
      vectorTable: "creative_context_vectors",
      vectorIndex: "creative_context_vectors_hnsw",
      vectorAudienceIndex: "creative_context_vectors_audience_gin",
    });
    expect(searchNamespaceIdentifiers("brain", 768)).toMatchObject({
      ftsTable: "brain_search_documents",
      vectorTable: "brain_vectors_768",
      vectorIndex: "brain_vectors_768_hnsw",
      vectorAudienceIndex: "brain_vectors_768_audience_gin",
    });
  });

  it("accepts only lowercase identifiers up to 63 characters", () => {
    expect(
      searchNamespaceIdentifiers(`a${"b".repeat(62)}`).namespace,
    ).toHaveLength(63);
    expect(searchNamespaceIdentifiers("a1_b").namespace).toBe("a1_b");
    for (const bad of [
      "Brain",
      "1brain",
      "_brain",
      "brain-x",
      "",
      `a${"b".repeat(63)}`,
      "brain;drop",
    ]) {
      expect(() => searchNamespaceIdentifiers(bad)).toThrow(
        "Search namespace must start with a lowercase letter",
      );
    }
  });

  it("accepts integer dimensions from 1 to 16000", () => {
    expect(searchNamespaceIdentifiers("brain", 1).vectorTable).toBe(
      "brain_vectors_1",
    );
    expect(searchNamespaceIdentifiers("brain", 16_000).vectorTable).toBe(
      "brain_vectors_16000",
    );
    for (const bad of [0, -3, 16_001, 1.5, Number.NaN]) {
      expect(() => searchNamespaceIdentifiers("brain", bad)).toThrow(
        "Embedding dimensions must be an integer from 1 to 16000.",
      );
    }
  });
});

describe("assertPgVectorAvailable", () => {
  it("throws only when the database isn't Postgres", () => {
    expect(() => assertPgVectorAvailable()).not.toThrow();
    expect(() => assertPgVectorAvailable(true)).not.toThrow();
    expect(() => assertPgVectorAvailable(false)).toThrow(
      PGVECTOR_REQUIRED_MESSAGE,
    );
  });
});

describe("ensurePgVectorIndex", () => {
  it("creates the extension, the table and both indexes", async () => {
    const { db, sql } = recordingDb();
    await ensurePgVectorIndex(db, 3, { namespace: "brain" });
    const statements = sql();
    expect(statements).toHaveLength(5);
    expect(statements[0]).toBe("CREATE EXTENSION IF NOT EXISTS vector");
    expect(statements[1]).toContain(
      "CREATE TABLE IF NOT EXISTS brain_vectors_3 (",
    );
    expect(statements[1]).toContain("embedding vector(3) NOT NULL");
    expect(statements[1]).toContain(
      "audience_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]",
    );
    expect(statements[2]).toBe(
      "ALTER TABLE brain_vectors_3 ADD COLUMN IF NOT EXISTS audience_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]",
    );
    expect(statements[3]).toBe(
      "CREATE INDEX IF NOT EXISTS brain_vectors_3_hnsw ON brain_vectors_3 USING hnsw (embedding vector_cosine_ops)",
    );
    expect(statements[4]).toBe(
      "CREATE INDEX IF NOT EXISTS brain_vectors_3_audience_gin ON brain_vectors_3 USING GIN (audience_ids)",
    );
  });

  it("uses the default namespace and accepts a plain postgres flag", async () => {
    const { db, sql } = recordingDb();
    await ensurePgVectorIndex(db, 2, true);
    expect(sql()[1]).toContain("creative_context_vectors_2");
  });

  it("refuses before any statement when the database isn't Postgres", async () => {
    const { db, statements } = recordingDb();
    await expect(ensurePgVectorIndex(db, 2, false)).rejects.toThrow(
      PGVECTOR_REQUIRED_MESSAGE,
    );
    await expect(
      ensurePgVectorIndex(db, 2, { postgres: false }),
    ).rejects.toThrow(PGVECTOR_REQUIRED_MESSAGE);
    expect(statements).toEqual([]);
  });

  it("reports a missing extension as pgvector being required", async () => {
    const cause = new Error('extension "vector" is not available');
    const { db } = recordingDb(() => Promise.reject(cause));
    const error = await ensurePgVectorIndex(db, 2).catch((caught) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(PGVECTOR_REQUIRED_MESSAGE);
    expect(error.cause).toBe(cause);
  });
});

describe("upsertPgVector", () => {
  const input = {
    vectorKey: "page:1",
    embeddingSetId: "set-a",
    dimensions: 3,
    vector: [0.5, -1, 2],
  };

  it("writes one row with bound values once the index exists", async () => {
    const { db, statements } = recordingDb();
    await upsertPgVector(
      db,
      {
        ...input,
        audienceIds: ["org:a", "user:b"],
        updatedAt: "2026-11-11T00:00:00.000Z",
      },
      { namespace: "brain", indexInitialized: true },
    );
    expect(statements).toHaveLength(1);
    const [statement] = statements;
    expect(statement?.sql).toContain(
      "INSERT INTO brain_vectors_3 (vector_key, embedding_set_id, audience_ids, embedding, updated_at)",
    );
    expect(statement?.sql).toContain(
      "VALUES (?, ?, ARRAY[?, ?]::TEXT[], ?::vector, ?)",
    );
    expect(statement?.sql).toContain("ON CONFLICT (vector_key) DO UPDATE SET");
    expect(statement?.sql).toContain("audience_ids = EXCLUDED.audience_ids");
    expect(statement?.sql).toContain("embedding = EXCLUDED.embedding");
    expect(statement?.args).toEqual([
      "page:1",
      "set-a",
      "org:a",
      "user:b",
      "[0.5,-1,2]",
      "2026-11-11T00:00:00.000Z",
    ]);
    expect(placeholders(statement?.sql ?? "")).toBe(statement?.args.length);
  });

  it("creates the index first unless told it exists, and stamps the time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-11T05:06:07.000Z"));
    const { db, sql, statements } = recordingDb();
    await upsertPgVector(db, input);
    expect(sql()).toHaveLength(6);
    expect(sql()[0]).toBe("CREATE EXTENSION IF NOT EXISTS vector");
    const insert = statements[5];
    expect(insert?.sql).toContain("ARRAY[]::TEXT[]");
    expect(insert?.args).toEqual([
      "page:1",
      "set-a",
      "[0.5,-1,2]",
      "2026-11-11T05:06:07.000Z",
    ]);
  });

  it("refuses a vector of the wrong length or with a non-finite value", async () => {
    const { db } = recordingDb();
    await expect(
      upsertPgVector(
        db,
        { ...input, vector: [1, 2] },
        { indexInitialized: true },
      ),
    ).rejects.toThrow("Embedding has 2 values; expected 3.");
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        upsertPgVector(
          db,
          { ...input, vector: [1, bad, 2] },
          { indexInitialized: true },
        ),
      ).rejects.toThrow("Embedding vectors may contain only finite numbers.");
    }
  });

  it("refuses without Postgres", async () => {
    const { db, statements } = recordingDb();
    await expect(
      upsertPgVector(db, input, { postgres: false, indexInitialized: true }),
    ).rejects.toThrow(PGVECTOR_REQUIRED_MESSAGE);
    expect(statements).toEqual([]);
  });
});

describe("deletePgVectors", () => {
  it("deletes the keys it is given and returns how many went", async () => {
    const { db, statements } = recordingDb(() => ({ rowsAffected: 2 }));
    await expect(
      deletePgVectors(db, {
        dimensions: 4,
        vectorKeys: ["a", "b"],
        namespace: "brain",
      }),
    ).resolves.toBe(2);
    expect(statements).toEqual([
      {
        sql: "DELETE FROM brain_vectors_4 WHERE vector_key IN (?, ?)",
        args: ["a", "b"],
      },
    ]);
  });

  it("does nothing for no keys, and refuses without Postgres", async () => {
    const { db, statements } = recordingDb(() => ({ rowsAffected: 9 }));
    await expect(
      deletePgVectors(db, { dimensions: 4, vectorKeys: [] }),
    ).resolves.toBe(0);
    await expect(
      deletePgVectors(db, { dimensions: 4, vectorKeys: ["a"] }, false),
    ).rejects.toThrow(PGVECTOR_REQUIRED_MESSAGE);
    expect(statements).toEqual([]);
  });
});

describe("queryPgVectorIndex", () => {
  const input = {
    embeddingSetId: "set-a",
    dimensions: 2,
    vector: [0.25, 0.75],
  };

  it("ranks by cosine distance within the set and maps each row", async () => {
    const { db, statements } = recordingDb((statement) =>
      statement.sql.includes("SELECT")
        ? { rows: [{ vector_key: 7, embedding_set_id: "set-a", score: "0.9" }] }
        : {},
    );
    const hits = await queryPgVectorIndex(db, {
      ...input,
      namespace: "brain",
      allowedVectorKeys: ["k1", "k2"],
      allowedAudienceIds: ["org:a"],
      limit: 5,
    });
    expect(hits).toEqual([
      { vectorKey: "7", embeddingSetId: "set-a", score: 0.9 },
    ]);
    expect(statements[0]).toEqual({
      sql: "SET hnsw.iterative_scan = strict_order",
      args: [],
    });
    const query = statements[1];
    expect(query?.sql).toContain(
      "SELECT vector_key, embedding_set_id, 1 - (embedding <=> ?::vector) AS score",
    );
    expect(query?.sql).toContain("FROM brain_vectors_2");
    expect(query?.sql).toContain(
      "WHERE embedding_set_id = ? AND vector_key IN (?, ?) AND audience_ids && ARRAY[?]::TEXT[]",
    );
    expect(query?.sql).toContain("ORDER BY embedding <=> ?::vector");
    expect(query?.args).toEqual([
      "[0.25,0.75]",
      "set-a",
      "k1",
      "k2",
      "org:a",
      "[0.25,0.75]",
      5,
    ]);
    expect(placeholders(query?.sql ?? "")).toBe(query?.args.length);
  });

  it("returns nothing without asking when an allow list is empty", async () => {
    const { db, statements } = recordingDb();
    await expect(
      queryPgVectorIndex(db, { ...input, allowedVectorKeys: [] }),
    ).resolves.toEqual([]);
    await expect(
      queryPgVectorIndex(db, { ...input, allowedAudienceIds: [] }),
    ).resolves.toEqual([]);
    expect(statements).toEqual([]);
  });

  it("keeps the limit between 1 and 200, defaulting to 40", async () => {
    const limits: unknown[] = [];
    const { db } = recordingDb((statement) => {
      if (statement.sql.includes("SELECT")) limits.push(statement.args.at(-1));
      return {};
    });
    for (const limit of [undefined, 0, -5, 2.9, 200, 201, 10_000]) {
      await queryPgVectorIndex(db, {
        ...input,
        ...(limit === undefined ? {} : { limit }),
      });
    }
    expect(limits).toEqual([40, 1, 1, 2, 200, 200, 200]);
  });

  it("runs without iterative scan on older pgvector, and filters nothing extra by default", async () => {
    const { db, statements } = recordingDb((statement) =>
      statement.sql.startsWith("SET")
        ? Promise.reject(new Error("unrecognized parameter"))
        : {},
    );
    await expect(queryPgVectorIndex(db, input)).resolves.toEqual([]);
    expect(statements[1]?.sql).not.toContain("vector_key IN");
    expect(statements[1]?.sql).not.toContain("audience_ids");
    expect(statements[1]?.sql).toContain("FROM creative_context_vectors_2");
  });

  it("refuses without Postgres or with a wrong-sized vector", async () => {
    const { db } = recordingDb();
    await expect(queryPgVectorIndex(db, input, false)).rejects.toThrow(
      PGVECTOR_REQUIRED_MESSAGE,
    );
    await expect(
      queryPgVectorIndex(db, { ...input, vector: [1] }),
    ).rejects.toThrow("Embedding has 1 values; expected 2.");
  });
});

describe("Postgres full-text lane", () => {
  it("creates its table and both indexes", async () => {
    const { db, sql } = recordingDb();
    await expect(ensurePostgresFts(db, "brain")).resolves.toBe(true);
    const statements = sql();
    expect(statements).toHaveLength(4);
    expect(statements[0]).toContain(
      "CREATE TABLE IF NOT EXISTS brain_search_documents (",
    );
    expect(statements[0]).toContain("document TSVECTOR NOT NULL");
    expect(statements[1]).toBe(
      "ALTER TABLE brain_search_documents ADD COLUMN IF NOT EXISTS audience_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]",
    );
    expect(statements[2]).toBe(
      "CREATE INDEX IF NOT EXISTS brain_search_documents_gin ON brain_search_documents USING GIN (document)",
    );
    expect(statements[3]).toBe(
      "CREATE INDEX IF NOT EXISTS brain_search_documents_audience_gin ON brain_search_documents USING GIN (audience_ids)",
    );
    await ensurePostgresFts(db);
    expect(sql()[4]).toContain("creative_context_search_documents");
  });

  it("weights title, summary and body when it writes a document", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-11T08:00:00.000Z"));
    const { db, statements } = recordingDb();
    await expect(
      upsertPostgresFtsDocument(db, {
        chunkId: "c1",
        itemVersionId: "v1",
        title: "Refunds",
        body: "Ask support.",
        audienceIds: ["org:a"],
        namespace: "brain",
      }),
    ).resolves.toBe(true);
    expect(statements).toHaveLength(5);
    const insert = statements[4];
    expect(insert?.sql).toContain(
      "INSERT INTO brain_search_documents (chunk_id, item_version_id, audience_ids, document, updated_at)",
    );
    expect(insert?.sql).toContain(
      "VALUES (?, ?, ARRAY[?]::TEXT[], setweight(to_tsvector('simple', ?), 'A') || setweight(to_tsvector('simple', ?), 'B') || setweight(to_tsvector('simple', ?), 'C'), ?)",
    );
    expect(insert?.sql).toContain("ON CONFLICT (chunk_id) DO UPDATE SET");
    expect(insert?.args).toEqual([
      "c1",
      "v1",
      "org:a",
      "Refunds",
      "",
      "Ask support.",
      "2026-11-11T08:00:00.000Z",
    ]);
    expect(placeholders(insert?.sql ?? "")).toBe(insert?.args.length);
  });

  it("writes the summary and time it is given, in the default namespace", async () => {
    const { db, statements } = recordingDb();
    await upsertPostgresFtsDocument(db, {
      chunkId: "c1",
      itemVersionId: "v1",
      title: "T",
      summary: "S",
      body: "B",
      updatedAt: "then",
    });
    expect(statements[4]?.sql).toContain(
      "INSERT INTO creative_context_search_documents",
    );
    expect(statements[4]?.sql).toContain("ARRAY[]::TEXT[]");
    expect(statements[4]?.args).toEqual(["c1", "v1", "T", "S", "B", "then"]);
  });

  it("matches the query within the allowed chunks and audiences", async () => {
    const { db, statements } = recordingDb(() => ({
      rows: [{ chunk_id: 3, item_version_id: "v", score: "0.5" }],
    }));
    const hits = await queryPostgresFts(db, {
      query: "refund policy",
      allowedChunkIds: ["c1", "c2"],
      allowedAudienceIds: ["org:a", "user:b"],
      limit: 3,
      namespace: "brain",
    });
    expect(hits).toEqual([{ chunkId: "3", itemVersionId: "v", score: 0.5 }]);
    expect(statements).toEqual([
      {
        sql: "SELECT chunk_id, item_version_id, ts_rank_cd(document, websearch_to_tsquery('simple', ?)) AS score FROM brain_search_documents WHERE chunk_id IN (?, ?) AND document @@ websearch_to_tsquery('simple', ?) AND audience_ids && ARRAY[?, ?]::TEXT[] ORDER BY score DESC, chunk_id ASC LIMIT ?",
        args: [
          "refund policy",
          "c1",
          "c2",
          "refund policy",
          "org:a",
          "user:b",
          3,
        ],
      },
    ]);
  });

  it("returns nothing without asking when an allow list is empty", async () => {
    const { db, statements } = recordingDb();
    await expect(
      queryPostgresFts(db, { query: "x", allowedChunkIds: [] }),
    ).resolves.toEqual([]);
    await expect(
      queryPostgresFts(db, { query: "x", allowedAudienceIds: [] }),
    ).resolves.toEqual([]);
    expect(statements).toEqual([]);
  });

  it("keeps the limit between 1 and 200, defaulting to 40", async () => {
    const limits: unknown[] = [];
    const { db } = recordingDb((statement) => {
      limits.push(statement.args.at(-1));
      return {};
    });
    for (const limit of [undefined, 0, 7.5, 999]) {
      await queryPostgresFts(db, {
        query: "x",
        ...(limit === undefined ? {} : { limit }),
      });
    }
    expect(limits).toEqual([40, 1, 7, 200]);
  });

  it("treats only a missing table as no results", async () => {
    const missing = recordingDb(() => Promise.reject({ code: "42P01" }));
    await expect(queryPostgresFts(missing.db, { query: "x" })).resolves.toEqual(
      [],
    );
    for (const error of [{ code: "42501" }, new Error("boom"), "text", null]) {
      const failing = recordingDb(() => Promise.reject(error));
      await expect(queryPostgresFts(failing.db, { query: "x" })).rejects.toBe(
        error,
      );
    }
  });

  it("deletes chunks after making sure the table exists", async () => {
    const { db, statements, sql } = recordingDb(() => ({ rowsAffected: 2 }));
    await expect(
      deletePostgresFtsDocuments(db, ["c1", "c2"], "brain"),
    ).resolves.toBe(2);
    expect(sql()).toHaveLength(5);
    expect(statements[4]).toEqual({
      sql: "DELETE FROM brain_search_documents WHERE chunk_id IN (?, ?)",
      args: ["c1", "c2"],
    });
    const empty = recordingDb();
    await expect(deletePostgresFtsDocuments(empty.db, [])).resolves.toBe(0);
    expect(empty.statements).toEqual([]);
    await deletePostgresFtsDocuments(empty.db, ["c1"]);
    expect(empty.statements.at(-1)?.sql).toContain(
      "creative_context_search_documents",
    );
  });
});

describe("reciprocalRankFusion", () => {
  const ranked = (...keys: string[]) =>
    keys.map((key) => ({ key, value: key.toUpperCase(), score: 1 }));

  it("adds one over rank plus the constant from each lane", () => {
    const fused = reciprocalRankFusion(
      { words: ranked("a", "b", "c"), meaning: ranked("c", "d") },
      { rankConstant: 60 },
    );
    expect(fused.map((candidate) => candidate.key)).toEqual([
      "c",
      "a",
      "b",
      "d",
    ]);
    const [c, a, b, d] = fused;
    expect(c?.score).toBeCloseTo(1 / 63 + 1 / 61, 12);
    expect(a?.score).toBeCloseTo(1 / 61, 12);
    expect(b?.score).toBeCloseTo(1 / 62, 12);
    expect(d?.score).toBeCloseTo(1 / 62, 12);
    expect(c?.laneRanks).toEqual({ words: 3, meaning: 1 });
    expect(d?.laneRanks).toEqual({ meaning: 2 });
    expect(c?.value).toBe("C");
  });

  it("breaks ties by key and defaults the constant to 60", () => {
    const fused = reciprocalRankFusion({ one: ranked("z"), two: ranked("y") });
    expect(fused.map((candidate) => candidate.key)).toEqual(["y", "z"]);
    expect(fused[0]?.score).toBeCloseTo(1 / 61, 12);
  });

  it("keeps the constant at least 1", () => {
    const [top] = reciprocalRankFusion(
      { only: ranked("a") },
      { rankConstant: -10 },
    );
    expect(top?.score).toBeCloseTo(1 / 2, 12);
    const [zero] = reciprocalRankFusion(
      { only: ranked("a") },
      { rankConstant: 0 },
    );
    expect(zero?.score).toBeCloseTo(1 / 2, 12);
  });

  it("collects each distinct reason once", () => {
    const [top] = reciprocalRankFusion({
      words: [{ key: "a", value: 1, score: 1, reason: "title" }],
      meaning: [{ key: "a", value: 1, score: 1, reason: "meaning" }],
      again: [
        { key: "a", value: 1, score: 1, reason: "title" },
        { key: "b", value: 2, score: 1 },
      ],
    });
    expect(top?.reasons).toEqual(["title", "meaning"]);
  });

  it("returns at most the limit, at least one, and 40 by default", () => {
    const many = ranked(
      ...Array.from(
        { length: 50 },
        (_, index) => `k${String(index).padStart(2, "0")}`,
      ),
    );
    expect(reciprocalRankFusion({ words: many })).toHaveLength(40);
    expect(
      reciprocalRankFusion({ words: many }, { limit: 3 }).map((c) => c.key),
    ).toEqual(["k00", "k01", "k02"]);
    expect(reciprocalRankFusion({ words: many }, { limit: 0 })).toHaveLength(1);
    expect(reciprocalRankFusion({ words: [] })).toEqual([]);
  });
});
