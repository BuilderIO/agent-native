import { getDbExec, isPostgres } from "@agent-native/core/db";

function escapeLike(value: string): string {
  return value.replace(/[!%_]/g, (match) => `!${match}`);
}

function chunkPrefix(
  recordingId: string,
  generationId?: string | null,
): string {
  return generationId
    ? `recording-chunks-${recordingId}-${generationId}-`
    : `recording-chunks-${recordingId}-`;
}

function likePrefix(prefix: string): string {
  return `${escapeLike(prefix)}%`;
}

function exactChunkKeyArgs(
  ownerEmail: string,
  recordingId: string,
  generationId?: string | null,
): [string, string, number, string, string] {
  const prefix = chunkPrefix(recordingId, generationId);
  return [
    ownerEmail,
    likePrefix(prefix),
    prefix.length + 6,
    `${prefix}000000`,
    `${prefix}999999`,
  ];
}

const exactChunkKeyWhere = `session_id = ? AND key LIKE ? ESCAPE '!' AND length(key) = ? AND key >= ? AND key <= ?`;

function isChunkKeyForGeneration(
  key: string,
  recordingId: string,
  generationId?: string | null,
): boolean {
  const prefix = chunkPrefix(recordingId, generationId);
  if (!key.startsWith(prefix)) return false;
  return /^\d+$/.test(key.slice(prefix.length));
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

export interface RecordingChunkKey {
  key: string;
  index: number;
}

export function recordingChunkIndexFromKey(key: string): number | null {
  const rawIndex = key.slice(key.lastIndexOf("-") + 1);
  if (!/^\d+$/.test(rawIndex)) return null;
  const index = Number(rawIndex);
  return Number.isSafeInteger(index) ? index : null;
}

export function validateRecordingChunkKeys(
  keys: string[],
  expectedChunks?: number,
): RecordingChunkKey[] {
  const parsed = keys.map((key) => {
    const index = recordingChunkIndexFromKey(key);
    if (index === null) {
      throw new Error(
        `Recording upload contains an invalid chunk key (${key}). Please retry the recording.`,
      );
    }
    return { key, index };
  });

  parsed.sort((a, b) => a.index - b.index);

  for (let i = 0; i < parsed.length; i++) {
    const chunk = parsed[i]!;
    if (chunk.index < i) {
      throw new Error(
        `Recording upload contains duplicate chunk ${chunk.index}. Please retry the recording.`,
      );
    }
    if (chunk.index > i) {
      throw new Error(
        `Recording upload is incomplete: missing chunk ${i}. Please retry the recording.`,
      );
    }
  }

  if (
    typeof expectedChunks === "number" &&
    Number.isSafeInteger(expectedChunks) &&
    expectedChunks >= 0 &&
    parsed.length !== expectedChunks
  ) {
    throw new Error(
      `Recording upload is incomplete (${parsed.length} of ${expectedChunks} chunks received). Please retry the recording.`,
    );
  }

  return parsed;
}

export async function listRecordingChunkKeys(
  ownerEmail: string,
  recordingId: string,
  generationId?: string | null,
): Promise<string[]> {
  const { rows } = await getDbExec().execute({
    sql: `SELECT key FROM application_state WHERE ${exactChunkKeyWhere}`,
    args: exactChunkKeyArgs(ownerEmail, recordingId, generationId),
  });
  return rows
    .map((row) => String(row.key))
    .filter((key) => isChunkKeyForGeneration(key, recordingId, generationId));
}

export async function deleteRecordingChunks(
  ownerEmail: string,
  recordingId: string,
  generationId?: string | null,
): Promise<number> {
  const result = await getDbExec().execute({
    sql: `DELETE FROM application_state WHERE ${exactChunkKeyWhere}`,
    args: exactChunkKeyArgs(ownerEmail, recordingId, generationId),
  });
  return result.rowsAffected ?? 0;
}

export async function sumRecordingChunkBytes(
  ownerEmail: string,
  recordingId: string,
  generationId?: string | null,
): Promise<number> {
  const bytesExpression = isPostgres()
    ? `COALESCE(SUM((value::jsonb ->> 'bytes')::bigint), 0)`
    : `COALESCE(SUM(json_extract(value, '$.bytes')), 0)`;
  const { rows } = await getDbExec().execute({
    sql: `SELECT ${bytesExpression} AS bytes FROM application_state WHERE ${exactChunkKeyWhere}`,
    args: exactChunkKeyArgs(ownerEmail, recordingId, generationId),
  });
  return numberFromRowValue(rows[0]?.bytes);
}
