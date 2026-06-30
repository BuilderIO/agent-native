import { getDbExec, isPostgres } from "@agent-native/core/db";

function escapeLike(value: string): string {
  return value.replace(/[!%_]/g, (match) => `!${match}`);
}

function chunkPrefix(recordingId: string): string {
  return `recording-chunks-${recordingId}-`;
}

function likePrefix(prefix: string): string {
  return `${escapeLike(prefix)}%`;
}

function numberFromRowValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export async function listRecordingChunkKeys(
  ownerEmail: string,
  recordingId: string,
): Promise<string[]> {
  const { rows } = await getDbExec().execute({
    sql: `SELECT key FROM application_state WHERE session_id = ? AND key LIKE ? ESCAPE '!'`,
    args: [ownerEmail, likePrefix(chunkPrefix(recordingId))],
  });
  return rows.map((row) => String(row.key));
}

export async function sumRecordingChunkBytes(
  ownerEmail: string,
  recordingId: string,
): Promise<number> {
  const bytesExpression = isPostgres()
    ? `COALESCE(SUM((value::jsonb ->> 'bytes')::bigint), 0)`
    : `COALESCE(SUM(json_extract(value, '$.bytes')), 0)`;
  const { rows } = await getDbExec().execute({
    sql: `SELECT ${bytesExpression} AS bytes FROM application_state WHERE session_id = ? AND key LIKE ? ESCAPE '!'`,
    args: [ownerEmail, likePrefix(chunkPrefix(recordingId))],
  });
  return numberFromRowValue(rows[0]?.bytes);
}
