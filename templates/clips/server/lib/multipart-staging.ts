/**
 * S3 multipart parts must be at least 5 MiB, but recorders upload 1-3 MiB
 * chunks (the desktop app streams 1 MiB). The S3 relay used to buffer the
 * bytes below 5 MiB in a staging object in the bucket: every chunk downloaded
 * that object, appended to it and uploaded it again. On Synology C2 that made
 * a 10-minute recording upload at ~0.4 MB/s on Synology C2 while the
 * bucket itself takes ~11 MB/s.
 *
 * This keeps those pending bytes in the app database instead, one row per
 * chunk keyed by its byte offset. A retried chunk overwrites its own row, so
 * a chunk whose session update failed cannot be counted twice. Rows go away
 * once their bytes are sent as a part, and on complete/abort.
 */
import { getDbExec } from "@agent-native/core/db";

const TABLE = "multipart_staging_chunks";
const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

export type StagedChunk = { offset: number; bytes: Uint8Array };

function rowOffset(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error("Multipart staging row has an invalid byte offset");
  }
  return n;
}

/** Stage one chunk's bytes at its offset in the upload. */
export async function stageChunk(
  stagingKey: string,
  offset: number,
  bytes: Uint8Array,
): Promise<void> {
  await getDbExec().execute({
    sql: `INSERT INTO ${TABLE} (staging_key, byte_offset, byte_length, data, updated_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (staging_key, byte_offset) DO UPDATE SET
        byte_length = excluded.byte_length,
        data = excluded.data,
        updated_at = excluded.updated_at`,
    args: [
      stagingKey,
      offset,
      bytes.byteLength,
      Buffer.from(bytes).toString("base64"),
      new Date().toISOString(),
    ],
  });
}

/**
 * The staged bytes in [fromOffset, toOffset), in order. Returns null when
 * they do not form exactly that range (nothing staged here, or a gap).
 */
export async function readStagedRange(
  stagingKey: string,
  fromOffset: number,
  toOffset: number,
): Promise<Uint8Array | null> {
  const { rows } = await getDbExec().execute({
    sql: `SELECT byte_offset, data FROM ${TABLE}
      WHERE staging_key = $1 AND byte_offset >= $2 AND byte_offset < $3
      ORDER BY byte_offset`,
    args: [stagingKey, fromOffset, toOffset],
  });
  const chunks: StagedChunk[] = rows.map((row) => {
    const r = row as { byte_offset?: unknown; data?: unknown };
    if (typeof r.data !== "string") {
      throw new Error("Multipart staging row has no data");
    }
    return {
      offset: rowOffset(r.byte_offset),
      bytes: new Uint8Array(Buffer.from(r.data, "base64")),
    };
  });
  return joinContiguous(chunks, fromOffset, toOffset);
}

/** Pure helper: join chunks that exactly cover [from, to), else null. */
export function joinContiguous(
  chunks: StagedChunk[],
  fromOffset: number,
  toOffset: number,
): Uint8Array | null {
  if (toOffset < fromOffset) return null;
  if (toOffset === fromOffset) {
    return chunks.length === 0 ? new Uint8Array(0) : null;
  }
  const out = new Uint8Array(toOffset - fromOffset);
  let cursor = fromOffset;
  for (const chunk of [...chunks].sort((a, b) => a.offset - b.offset)) {
    if (chunk.offset !== cursor) return null;
    if (cursor + chunk.bytes.byteLength > toOffset) return null;
    out.set(chunk.bytes, cursor - fromOffset);
    cursor += chunk.bytes.byteLength;
  }
  return cursor === toOffset ? out : null;
}

/** Drop every staged chunk of one upload. Never throws. */
export async function clearStaged(stagingKey: string): Promise<void> {
  try {
    await getDbExec().execute({
      sql: `DELETE FROM ${TABLE} WHERE staging_key = $1`,
      args: [stagingKey],
    });
  } catch (error) {
    console.warn(
      "[multipart-staging] failed to clear staged chunks:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** Drop staged chunks that start before `offset`. Never throws. */
export async function clearStagedBefore(
  stagingKey: string,
  offset: number,
): Promise<void> {
  try {
    await getDbExec().execute({
      sql: `DELETE FROM ${TABLE} WHERE staging_key = $1 AND byte_offset < $2`,
      args: [stagingKey, offset],
    });
  } catch (error) {
    console.warn(
      "[multipart-staging] failed to clear sent chunks:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Drop chunks of uploads abandoned days ago. Best effort and never throws:
 * a failed sweep only leaves old rows behind, which the next sweep removes.
 * It must not fail the upload that triggered it.
 */
export async function clearStaleStaged(now = Date.now()): Promise<void> {
  try {
    await getDbExec().execute({
      sql: `DELETE FROM ${TABLE} WHERE updated_at < $1`,
      args: [new Date(now - STALE_AFTER_MS).toISOString()],
    });
  } catch (error) {
    console.warn(
      "[multipart-staging] failed to clear stale chunks:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export const MULTIPART_STAGING_TABLE_SQL = `CREATE TABLE IF NOT EXISTS ${TABLE} (
  staging_key TEXT NOT NULL,
  byte_offset BIGINT NOT NULL,
  byte_length INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (staging_key, byte_offset)
)`;

export const MULTIPART_STAGING_INDEX_SQL = `CREATE INDEX IF NOT EXISTS multipart_staging_updated_at_idx ON ${TABLE} (updated_at)`;
