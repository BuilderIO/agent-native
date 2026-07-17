import type { DbExec } from "@agent-native/core/db";
import { isPostgres } from "@agent-native/core/db";

export const PGVECTOR_REQUIRED_MESSAGE =
  "Visual search requires Postgres with the pgvector extension in the configured DATABASE_URL database.";

export interface PgVectorHit {
  vectorKey: string;
  embeddingSetId: string;
  score: number;
}

function checkedDimensions(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 16_000) {
    throw new Error("Embedding dimensions must be an integer from 1 to 16000.");
  }
  return value;
}

function vectorTable(dimensions: number): string {
  return `creative_context_vectors_${checkedDimensions(dimensions)}`;
}

function vectorIndex(dimensions: number): string {
  return `creative_context_vectors_${checkedDimensions(dimensions)}_hnsw`;
}

function vectorLiteral(vector: readonly number[], dimensions: number): string {
  if (vector.length !== dimensions) {
    throw new Error(
      `Embedding has ${vector.length} values; expected ${dimensions}.`,
    );
  }
  for (const value of vector) {
    if (!Number.isFinite(value)) {
      throw new Error("Embedding vectors may contain only finite numbers.");
    }
  }
  return `[${vector.join(",")}]`;
}

export function assertPgVectorAvailable(postgres = isPostgres()): void {
  if (!postgres) throw new Error(PGVECTOR_REQUIRED_MESSAGE);
}

export async function ensurePgVectorIndex(
  db: DbExec,
  dimensions: number,
  postgres = isPostgres(),
): Promise<void> {
  assertPgVectorAvailable(postgres);
  const table = vectorTable(dimensions);
  const index = vectorIndex(dimensions);
  try {
    await db.execute("CREATE EXTENSION IF NOT EXISTS vector");
    await db.execute(`
      CREATE TABLE IF NOT EXISTS ${table} (
        vector_key TEXT PRIMARY KEY,
        embedding_set_id TEXT NOT NULL,
        embedding vector(${checkedDimensions(dimensions)}) NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await db.execute(
      `CREATE INDEX IF NOT EXISTS ${index} ON ${table} USING hnsw (embedding vector_cosine_ops)`,
    );
  } catch (error) {
    throw new Error(PGVECTOR_REQUIRED_MESSAGE, { cause: error });
  }
}

export async function upsertPgVector(
  db: DbExec,
  input: {
    vectorKey: string;
    embeddingSetId: string;
    dimensions: number;
    vector: readonly number[];
    updatedAt?: string;
  },
  postgres = isPostgres(),
): Promise<void> {
  assertPgVectorAvailable(postgres);
  await ensurePgVectorIndex(db, input.dimensions, postgres);
  const table = vectorTable(input.dimensions);
  await db.execute({
    sql: `
      INSERT INTO ${table} (vector_key, embedding_set_id, embedding, updated_at)
      VALUES (?, ?, ?::vector, ?)
      ON CONFLICT (vector_key) DO UPDATE SET
        embedding_set_id = EXCLUDED.embedding_set_id,
        embedding = EXCLUDED.embedding,
        updated_at = EXCLUDED.updated_at
    `,
    args: [
      input.vectorKey,
      input.embeddingSetId,
      vectorLiteral(input.vector, input.dimensions),
      input.updatedAt ?? new Date().toISOString(),
    ],
  });
}

export async function deletePgVectors(
  db: DbExec,
  input: {
    dimensions: number;
    vectorKeys: readonly string[];
  },
  postgres = isPostgres(),
): Promise<number> {
  assertPgVectorAvailable(postgres);
  if (input.vectorKeys.length === 0) return 0;
  const table = vectorTable(input.dimensions);
  const placeholders = input.vectorKeys.map(() => "?").join(", ");
  const result = await db.execute({
    sql: `DELETE FROM ${table} WHERE vector_key IN (${placeholders})`,
    args: [...input.vectorKeys],
  });
  return result.rowsAffected;
}

export async function queryPgVectorIndex(
  db: DbExec,
  input: {
    embeddingSetId: string;
    dimensions: number;
    vector: readonly number[];
    limit?: number;
    allowedVectorKeys: readonly string[];
  },
  postgres = isPostgres(),
): Promise<PgVectorHit[]> {
  assertPgVectorAvailable(postgres);
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 40)));
  const allowed = input.allowedVectorKeys;
  if (allowed.length === 0) return [];
  const table = vectorTable(input.dimensions);
  const literal = vectorLiteral(input.vector, input.dimensions);
  const allowedSql = allowed.length
    ? ` AND vector_key IN (${allowed.map(() => "?").join(", ")})`
    : "";
  try {
    await db.execute("SET hnsw.iterative_scan = strict_order");
  } catch {
    // pgvector before iterative scans still supports the filtered exact query.
  }
  const result = await db.execute({
    sql: `
      SELECT vector_key, embedding_set_id,
        1 - (embedding <=> ?::vector) AS score
      FROM ${table}
      WHERE embedding_set_id = ?${allowedSql}
      ORDER BY embedding <=> ?::vector
      LIMIT ?
    `,
    args: [literal, input.embeddingSetId, ...allowed, literal, limit],
  });
  return result.rows.map((row) => ({
    vectorKey: String(row.vector_key),
    embeddingSetId: String(row.embedding_set_id),
    score: Number(row.score),
  }));
}
