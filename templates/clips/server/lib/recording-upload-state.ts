import { getDbExec } from "@agent-native/core/db";

export interface RecordingUploadAttempt {
  recordingId: string;
  uploadAttemptId: string | null;
  uploadGenerationId: string | null;
}

function recordingUploadStateRecord(
  state: unknown,
): Record<string, unknown> | null {
  return state && typeof state === "object"
    ? (state as Record<string, unknown>)
    : null;
}

function validBrowserSessionId(value: unknown): string | undefined {
  return typeof value === "string" && /^[!-~]{1,127}$/.test(value)
    ? value
    : undefined;
}

export function recordingUploadStateMatchesAttempt(
  state: unknown,
  attempt: RecordingUploadAttempt,
): boolean {
  const record = recordingUploadStateRecord(state);
  return (
    record?.recordingId === attempt.recordingId &&
    (record.uploadAttemptId ?? null) === attempt.uploadAttemptId &&
    (record.uploadGenerationId ?? null) === attempt.uploadGenerationId
  );
}

export function recordingUploadBrowserSessionId(
  state: unknown,
  attempt: RecordingUploadAttempt,
): string | undefined {
  if (!recordingUploadStateMatchesAttempt(state, attempt)) return undefined;
  return validBrowserSessionId(
    recordingUploadStateRecord(state)?.browserSessionId,
  );
}

export function recordingUploadStateForAttempt(params: {
  state: unknown;
  attempt: RecordingUploadAttempt;
  browserSessionId?: string;
}): Record<string, unknown> {
  const { state, attempt, browserSessionId } = params;
  const record = recordingUploadStateRecord(state);
  const matchesAttempt = recordingUploadStateMatchesAttempt(state, attempt);
  const isInitialUploadState =
    record?.recordingId === attempt.recordingId &&
    record.status === "uploading" &&
    record.uploadAttemptId == null &&
    record.uploadGenerationId == null;
  const storedBrowserSessionId = recordingUploadBrowserSessionId(
    state,
    attempt,
  );
  const baseState: Record<string, unknown> =
    matchesAttempt && record
      ? record
      : isInitialUploadState && record
        ? { ...record }
        : {};
  if (!matchesAttempt) delete baseState.browserSessionId;
  const nextState: Record<string, unknown> = {
    ...baseState,
    recordingId: attempt.recordingId,
    uploadAttemptId: attempt.uploadAttemptId,
    uploadGenerationId: attempt.uploadGenerationId,
  };
  const sessionId =
    storedBrowserSessionId ?? validBrowserSessionId(browserSessionId);
  if (sessionId) nextState.browserSessionId = sessionId;
  return nextState;
}

export function recordingUploadStateForAttemptIfCurrent(params: {
  state: unknown;
  attempt: RecordingUploadAttempt;
  browserSessionId: string;
}): Record<string, unknown> | null {
  const { state, attempt } = params;
  const record = recordingUploadStateRecord(state);
  const matchesAttempt = recordingUploadStateMatchesAttempt(state, attempt);
  const isInitialUploadState =
    record?.recordingId === attempt.recordingId &&
    record.status === "uploading" &&
    record.uploadAttemptId == null &&
    record.uploadGenerationId == null;
  if (
    state !== null &&
    state !== undefined &&
    (!record || (!matchesAttempt && !isInitialUploadState))
  ) {
    return null;
  }
  return recordingUploadStateForAttempt(params);
}

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

const exactChunkKeyWhere = `session_id = $1 AND key LIKE $2 ESCAPE '!' AND length(key) = $3 AND key >= $4 AND key <= $5`;

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
  const bytesExpression = `COALESCE(SUM((value::jsonb ->> 'bytes')::bigint), 0)`;
  const { rows } = await getDbExec().execute({
    sql: `SELECT ${bytesExpression} AS bytes FROM application_state WHERE ${exactChunkKeyWhere}`,
    args: exactChunkKeyArgs(ownerEmail, recordingId, generationId),
  });
  return numberFromRowValue(rows[0]?.bytes);
}
