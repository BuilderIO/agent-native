import type { DbExec } from "../db/index.js";
import { isPostgres } from "../db/index.js";

export const DEFAULT_SEARCH_NAMESPACE = "creative_context";
export const PGVECTOR_REQUIRED_MESSAGE =
  "Vector search requires Postgres with the pgvector extension in the configured DATABASE_URL database.";

export interface SearchNamespaceIdentifiers {
  namespace: string;
  ftsTable: string;
  ftsIndex: string;
  ftsAudienceIndex: string;
  vectorTable: string;
  vectorIndex: string;
  vectorAudienceIndex: string;
}

export interface PgVectorHit {
  vectorKey: string;
  embeddingSetId: string;
  score: number;
}

export interface PostgresFtsHit {
  chunkId: string;
  itemVersionId: string;
  score: number;
}

export interface RankedCandidate<T> {
  key: string;
  value: T;
  score: number;
  reason?: string;
}

export interface FusedCandidate<T> extends RankedCandidate<T> {
  laneRanks: Record<string, number>;
  reasons: string[];
}

type PgVectorOptions = boolean | { namespace?: string; postgres?: boolean };

function pgVectorOptions(options: PgVectorOptions | undefined) {
  return typeof options === "boolean" ? { postgres: options } : (options ?? {});
}

export function searchNamespaceIdentifiers(
  namespace = DEFAULT_SEARCH_NAMESPACE,
  dimensions?: number,
): SearchNamespaceIdentifiers {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(namespace)) {
    throw new Error(
      "Search namespace must start with a lowercase letter and contain only lowercase letters, numbers, and underscores.",
    );
  }
  const suffix =
    dimensions === undefined ? "" : `_${checkedDimensions(dimensions)}`;
  return {
    namespace,
    ftsTable: `${namespace}_search_documents`,
    ftsIndex: `${namespace}_search_documents_gin`,
    ftsAudienceIndex: `${namespace}_search_documents_audience_gin`,
    vectorTable: `${namespace}_vectors${suffix}`,
    vectorIndex: `${namespace}_vectors${suffix}_hnsw`,
    vectorAudienceIndex: `${namespace}_vectors${suffix}_audience_gin`,
  };
}

function checkedDimensions(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 16_000) {
    throw new Error("Embedding dimensions must be an integer from 1 to 16000.");
  }
  return value;
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

function audienceClause(
  audienceIds: readonly string[] | undefined,
  column = "audience_ids",
): { sql: string; args: string[] } {
  if (!audienceIds?.length) return { sql: "", args: [] };
  return {
    sql: ` AND ${column} && ARRAY[${audienceIds.map(() => "?").join(", ")}]::TEXT[]`,
    args: [...audienceIds],
  };
}

export function assertPgVectorAvailable(postgres = isPostgres()): void {
  if (!postgres) throw new Error(PGVECTOR_REQUIRED_MESSAGE);
}

export async function ensurePgVectorIndex(
  db: DbExec,
  dimensions: number,
  options?: PgVectorOptions,
): Promise<void> {
  const resolved = pgVectorOptions(options);
  const names = searchNamespaceIdentifiers(resolved.namespace, dimensions);
  assertPgVectorAvailable(resolved.postgres);
  try {
    await db.execute("CREATE EXTENSION IF NOT EXISTS vector");
    await db.execute(`
      CREATE TABLE IF NOT EXISTS ${names.vectorTable} (
        vector_key TEXT PRIMARY KEY,
        embedding_set_id TEXT NOT NULL,
        audience_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        embedding vector(${checkedDimensions(dimensions)}) NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await db.execute(
      `ALTER TABLE ${names.vectorTable} ADD COLUMN IF NOT EXISTS audience_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`,
    );
    await db.execute(
      `CREATE INDEX IF NOT EXISTS ${names.vectorIndex} ON ${names.vectorTable} USING hnsw (embedding vector_cosine_ops)`,
    );
    await db.execute(
      `CREATE INDEX IF NOT EXISTS ${names.vectorAudienceIndex} ON ${names.vectorTable} USING GIN (audience_ids)`,
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
    audienceIds?: readonly string[];
    updatedAt?: string;
  },
  options?: PgVectorOptions,
): Promise<void> {
  const resolved = pgVectorOptions(options);
  const names = searchNamespaceIdentifiers(
    resolved.namespace,
    input.dimensions,
  );
  assertPgVectorAvailable(resolved.postgres);
  await ensurePgVectorIndex(db, input.dimensions, resolved);
  await db.execute({
    sql: `
      INSERT INTO ${names.vectorTable} (vector_key, embedding_set_id, audience_ids, embedding, updated_at)
      VALUES (?, ?, ARRAY[${(input.audienceIds ?? []).map(() => "?").join(", ")}]::TEXT[], ?::vector, ?)
      ON CONFLICT (vector_key) DO UPDATE SET
        embedding_set_id = EXCLUDED.embedding_set_id,
        audience_ids = EXCLUDED.audience_ids,
        embedding = EXCLUDED.embedding,
        updated_at = EXCLUDED.updated_at
    `,
    args: [
      input.vectorKey,
      input.embeddingSetId,
      ...(input.audienceIds ?? []),
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
    namespace?: string;
  },
  postgres = isPostgres(),
): Promise<number> {
  const names = searchNamespaceIdentifiers(input.namespace, input.dimensions);
  assertPgVectorAvailable(postgres);
  if (!input.vectorKeys.length) return 0;
  const result = await db.execute({
    sql: `DELETE FROM ${names.vectorTable} WHERE vector_key IN (${input.vectorKeys.map(() => "?").join(", ")})`,
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
    allowedVectorKeys?: readonly string[];
    allowedAudienceIds?: readonly string[];
    namespace?: string;
  },
  postgres = isPostgres(),
): Promise<PgVectorHit[]> {
  const names = searchNamespaceIdentifiers(input.namespace, input.dimensions);
  assertPgVectorAvailable(postgres);
  if (
    input.allowedVectorKeys?.length === 0 ||
    input.allowedAudienceIds?.length === 0
  )
    return [];
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 40)));
  const literal = vectorLiteral(input.vector, input.dimensions);
  const keySql = input.allowedVectorKeys?.length
    ? ` AND vector_key IN (${input.allowedVectorKeys.map(() => "?").join(", ")})`
    : "";
  const audiences = audienceClause(input.allowedAudienceIds);
  try {
    await db.execute("SET hnsw.iterative_scan = strict_order");
  } catch {}
  const result = await db.execute({
    sql: `
      SELECT vector_key, embedding_set_id, 1 - (embedding <=> ?::vector) AS score
      FROM ${names.vectorTable}
      WHERE embedding_set_id = ?${keySql}${audiences.sql}
      ORDER BY embedding <=> ?::vector
      LIMIT ?
    `,
    args: [
      literal,
      input.embeddingSetId,
      ...(input.allowedVectorKeys ?? []),
      ...audiences.args,
      literal,
      limit,
    ],
  });
  return result.rows.map((row) => ({
    vectorKey: String(row.vector_key),
    embeddingSetId: String(row.embedding_set_id),
    score: Number(row.score),
  }));
}

export async function ensurePostgresFts(
  db: DbExec,
  namespace = DEFAULT_SEARCH_NAMESPACE,
): Promise<boolean> {
  const names = searchNamespaceIdentifiers(namespace);
  if (!isPostgres()) return false;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS ${names.ftsTable} (
      chunk_id TEXT PRIMARY KEY,
      item_version_id TEXT NOT NULL,
      audience_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      document TSVECTOR NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await db.execute(
    `ALTER TABLE ${names.ftsTable} ADD COLUMN IF NOT EXISTS audience_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`,
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS ${names.ftsIndex} ON ${names.ftsTable} USING GIN (document)`,
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS ${names.ftsAudienceIndex} ON ${names.ftsTable} USING GIN (audience_ids)`,
  );
  return true;
}

export async function upsertPostgresFtsDocument(
  db: DbExec,
  input: {
    chunkId: string;
    itemVersionId: string;
    title: string;
    summary?: string | null;
    body: string;
    audienceIds?: readonly string[];
    updatedAt?: string;
    namespace?: string;
  },
): Promise<boolean> {
  const namespace = input.namespace ?? DEFAULT_SEARCH_NAMESPACE;
  if (!(await ensurePostgresFts(db, namespace))) return false;
  const names = searchNamespaceIdentifiers(namespace);
  await db.execute({
    sql: `
      INSERT INTO ${names.ftsTable} (chunk_id, item_version_id, audience_ids, document, updated_at)
      VALUES (?, ?, ARRAY[${(input.audienceIds ?? []).map(() => "?").join(", ")}]::TEXT[], setweight(to_tsvector('simple', ?), 'A') || setweight(to_tsvector('simple', ?), 'B') || setweight(to_tsvector('simple', ?), 'C'), ?)
      ON CONFLICT (chunk_id) DO UPDATE SET item_version_id = EXCLUDED.item_version_id, audience_ids = EXCLUDED.audience_ids, document = EXCLUDED.document, updated_at = EXCLUDED.updated_at
    `,
    args: [
      input.chunkId,
      input.itemVersionId,
      ...(input.audienceIds ?? []),
      input.title,
      input.summary ?? "",
      input.body,
      input.updatedAt ?? new Date().toISOString(),
    ],
  });
  return true;
}

export async function queryPostgresFts(
  db: DbExec,
  input: {
    query: string;
    allowedChunkIds?: readonly string[];
    allowedAudienceIds?: readonly string[];
    limit?: number;
    namespace?: string;
  },
): Promise<PostgresFtsHit[]> {
  const namespace = input.namespace ?? DEFAULT_SEARCH_NAMESPACE;
  const names = searchNamespaceIdentifiers(namespace);
  if (
    !isPostgres() ||
    input.allowedChunkIds?.length === 0 ||
    input.allowedAudienceIds?.length === 0
  )
    return [];
  await ensurePostgresFts(db, namespace);
  const keys = input.allowedChunkIds?.length
    ? `chunk_id IN (${input.allowedChunkIds.map(() => "?").join(", ")}) AND`
    : "";
  const audiences = audienceClause(input.allowedAudienceIds);
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 40)));
  const result = await db.execute({
    sql: `SELECT chunk_id, item_version_id, ts_rank_cd(document, websearch_to_tsquery('simple', ?)) AS score FROM ${names.ftsTable} WHERE ${keys} document @@ websearch_to_tsquery('simple', ?)${audiences.sql} ORDER BY score DESC, chunk_id ASC LIMIT ?`,
    args: [
      input.query,
      ...(input.allowedChunkIds ?? []),
      input.query,
      ...audiences.args,
      limit,
    ],
  });
  return result.rows.map((row) => ({
    chunkId: String(row.chunk_id),
    itemVersionId: String(row.item_version_id),
    score: Number(row.score),
  }));
}

export async function deletePostgresFtsDocuments(
  db: DbExec,
  chunkIds: readonly string[],
  namespace = DEFAULT_SEARCH_NAMESPACE,
): Promise<number> {
  const names = searchNamespaceIdentifiers(namespace);
  if (!isPostgres() || !chunkIds.length) return 0;
  await ensurePostgresFts(db, namespace);
  const result = await db.execute({
    sql: `DELETE FROM ${names.ftsTable} WHERE chunk_id IN (${chunkIds.map(() => "?").join(", ")})`,
    args: [...chunkIds],
  });
  return result.rowsAffected;
}

export function reciprocalRankFusion<T>(
  lanes: Readonly<Record<string, readonly RankedCandidate<T>[]>>,
  options: { rankConstant?: number; limit?: number } = {},
): FusedCandidate<T>[] {
  const rankConstant = Math.max(1, options.rankConstant ?? 60);
  const fused = new Map<string, FusedCandidate<T>>();
  for (const [lane, candidates] of Object.entries(lanes)) {
    candidates.forEach((candidate, index) => {
      const rank = index + 1;
      const current = fused.get(candidate.key) ?? {
        ...candidate,
        score: 0,
        laneRanks: {},
        reasons: [],
      };
      current.score += 1 / (rankConstant + rank);
      current.laneRanks[lane] = rank;
      if (candidate.reason && !current.reasons.includes(candidate.reason))
        current.reasons.push(candidate.reason);
      fused.set(candidate.key, current);
    });
  }
  return [...fused.values()]
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
    .slice(0, Math.max(1, options.limit ?? 40));
}
