import type { DbExec } from "@agent-native/core/db";
import { isPostgres } from "@agent-native/core/db";

const FTS_TABLE = "creative_context_search_documents";

export interface PostgresFtsHit {
  chunkId: string;
  itemVersionId: string;
  score: number;
}

export async function ensurePostgresFts(db: DbExec): Promise<boolean> {
  if (!isPostgres()) return false;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS ${FTS_TABLE} (
      chunk_id TEXT PRIMARY KEY,
      item_version_id TEXT NOT NULL,
      document TSVECTOR NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS creative_context_search_documents_gin ON ${FTS_TABLE} USING GIN (document)`,
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
    updatedAt?: string;
  },
): Promise<boolean> {
  if (!(await ensurePostgresFts(db))) return false;
  await db.execute({
    sql: `
      INSERT INTO ${FTS_TABLE} (chunk_id, item_version_id, document, updated_at)
      VALUES (
        ?,
        ?,
        setweight(to_tsvector('simple', ?), 'A') ||
          setweight(to_tsvector('simple', ?), 'B') ||
          setweight(to_tsvector('simple', ?), 'C'),
        ?
      )
      ON CONFLICT (chunk_id) DO UPDATE SET
        item_version_id = EXCLUDED.item_version_id,
        document = EXCLUDED.document,
        updated_at = EXCLUDED.updated_at
    `,
    args: [
      input.chunkId,
      input.itemVersionId,
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
    limit?: number;
  },
): Promise<PostgresFtsHit[]> {
  if (!isPostgres() || input.allowedChunkIds?.length === 0) return [];
  await ensurePostgresFts(db);
  const placeholders = input.allowedChunkIds?.map(() => "?").join(", ");
  const accessClause = placeholders ? `chunk_id IN (${placeholders}) AND` : "";
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 40)));
  const result = await db.execute({
    sql: `
      SELECT chunk_id, item_version_id,
        ts_rank_cd(document, websearch_to_tsquery('simple', ?)) AS score
      FROM ${FTS_TABLE}
      WHERE ${accessClause}
        document @@ websearch_to_tsquery('simple', ?)
      ORDER BY score DESC, chunk_id ASC
      LIMIT ?
    `,
    args: [input.query, ...(input.allowedChunkIds ?? []), input.query, limit],
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
): Promise<number> {
  if (!isPostgres() || chunkIds.length === 0) return 0;
  await ensurePostgresFts(db);
  const placeholders = chunkIds.map(() => "?").join(", ");
  const result = await db.execute({
    sql: `DELETE FROM ${FTS_TABLE} WHERE chunk_id IN (${placeholders})`,
    args: [...chunkIds],
  });
  return result.rowsAffected;
}
