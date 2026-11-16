/**
 * S3 multipart parts must be at least 5 MiB, but recorders upload 1-3 MiB
 * chunks (the desktop app streams 1 MiB). The S3 relay used to buffer the
 * bytes below 5 MiB in one staging object: every chunk downloaded that
 * object, appended to it and uploaded it again. On Synology C2 that made a
 * 10-minute recording upload at ~0.4 MB/s while the bucket itself takes
 * ~11 MB/s.
 *
 * Each pending chunk is now written once, as its own object in the configured
 * storage. SQL keeps only a reference to it (upload, byte offset, length and
 * object key), keyed by offset so a retried chunk overwrites its own object
 * and row and is never counted twice. The chunk objects are read back once,
 * when they fill a part.
 *
 * Staged chunks live exactly as long as their multipart upload: complete and
 * abort drop them, and the sweep drops only chunks whose upload the storage
 * no longer has (completed, aborted, or expired by a bucket lifecycle rule).
 * A paused upload that can still resume keeps its chunks, however old.
 */
import { createHash } from "node:crypto";

import { getDbExec } from "@agent-native/core/db";

/** Object I/O on the storage the upload itself writes to. */
export interface StagingObjectStore {
  putObject(key: string, bytes: Uint8Array): Promise<void>;
  getObject(key: string): Promise<Uint8Array>;
  /** Deletes the object; a missing object is not an error. */
  deleteObject(key: string): Promise<void>;
}

/** One multipart upload whose pending chunks are staged. */
export interface StagingUpload {
  /** The session's staging prefix (`clips/.multipart/<file>.pending`). */
  stagingKey: string;
  /** The provider's multipart upload id (the resumable session id). */
  uploadId: string;
  /** Final object key the multipart upload completes into. */
  targetKey: string;
  /** Which bucket the chunks live in. */
  storageFingerprint: string;
}

/** Whether storage still holds a multipart upload. */
export type MultipartUploadState = "active" | "gone" | "unknown";

export type StagedChunk = { offset: number; bytes: Uint8Array };

type ChunkRef = { offset: number; length: number; objectKey: string };

/** Pending bytes never exceed one 5 MiB part, so this bounds every read. */
const MAX_REFS_PER_READ = 10_000;
const SWEEP_UPLOADS_PER_RUN = 25;
/**
 * Uploads untouched this long are checked against storage. This only spares
 * live uploads a probe on every sweep; whether chunks go is decided by the
 * upload's state in storage, never by their age.
 */
export const STAGING_PROBE_AFTER_MS = 60 * 60 * 1000;

/** Deterministic, so a retried chunk overwrites its own object. */
export function stagedChunkObjectKey(
  upload: Pick<StagingUpload, "stagingKey" | "uploadId">,
  offset: number,
): string {
  const uploadTag = createHash("sha256")
    .update(upload.uploadId)
    .digest("hex")
    .slice(0, 24);
  return `${upload.stagingKey}/${uploadTag}/${offset}`;
}

function rowInteger(value: unknown, label: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(`Multipart staging row has an invalid ${label}`);
  }
  return n;
}

function readRef(row: unknown): ChunkRef {
  const r = row as {
    byte_offset?: unknown;
    byte_length?: unknown;
    object_key?: unknown;
  };
  if (typeof r.object_key !== "string" || !r.object_key) {
    throw new Error("Multipart staging row has no object key");
  }
  return {
    offset: rowInteger(r.byte_offset, "byte offset"),
    length: rowInteger(r.byte_length, "byte length"),
    objectKey: r.object_key,
  };
}

function warn(message: string, error: unknown): void {
  console.warn(
    `[multipart-staging] ${message}:`,
    error instanceof Error ? error.message : String(error),
  );
}

/**
 * Stage one chunk at its offset: the reference first, then the object, so
 * every object ever written has a row that cleanup can find.
 */
export async function stageChunk(
  store: StagingObjectStore,
  upload: StagingUpload,
  offset: number,
  bytes: Uint8Array,
): Promise<void> {
  const objectKey = stagedChunkObjectKey(upload, offset);
  const now = new Date().toISOString();
  await getDbExec().execute({
    sql: `INSERT INTO multipart_staging_parts
        (staging_key, upload_id, byte_offset, byte_length, object_key,
         target_key, storage_fingerprint, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
      ON CONFLICT (staging_key, upload_id, byte_offset) DO UPDATE SET
        byte_length = excluded.byte_length,
        object_key = excluded.object_key,
        updated_at = excluded.updated_at`,
    args: [
      upload.stagingKey,
      upload.uploadId,
      offset,
      bytes.byteLength,
      objectKey,
      upload.targetKey,
      upload.storageFingerprint,
      now,
    ],
  });
  await store.putObject(objectKey, bytes);
}

async function readRefs(
  upload: StagingUpload,
  fromOffset: number,
  toOffset: number,
): Promise<ChunkRef[]> {
  const { rows } = await getDbExec().execute({
    sql: `SELECT byte_offset, byte_length, object_key FROM multipart_staging_parts
      WHERE staging_key = $1 AND upload_id = $2
        AND byte_offset >= $3 AND byte_offset < $4
      ORDER BY byte_offset
      LIMIT $5`,
    args: [
      upload.stagingKey,
      upload.uploadId,
      fromOffset,
      toOffset,
      MAX_REFS_PER_READ,
    ],
  });
  return rows.map(readRef);
}

/** True when the refs, in offset order, cover exactly [from, to). */
function refsCover(refs: ChunkRef[], fromOffset: number, toOffset: number) {
  let cursor = fromOffset;
  for (const ref of refs) {
    if (ref.offset !== cursor) return false;
    cursor += ref.length;
  }
  return cursor === toOffset;
}

/**
 * The staged bytes in [fromOffset, toOffset), in order. Returns null when no
 * staged chunks form exactly that range (an upload that staged in one bucket
 * object before chunk staging existed).
 */
export async function readStagedRange(
  store: StagingObjectStore,
  upload: StagingUpload,
  fromOffset: number,
  toOffset: number,
): Promise<Uint8Array | null> {
  if (toOffset <= fromOffset) return null;
  const refs = await readRefs(upload, fromOffset, toOffset);
  if (!refsCover(refs, fromOffset, toOffset)) return null;
  const chunks = await Promise.all(
    refs.map(async (ref): Promise<StagedChunk> => {
      const bytes = await store.getObject(ref.objectKey);
      if (bytes.byteLength !== ref.length) {
        throw new Error(
          `Staged chunk at ${ref.offset} has ${bytes.byteLength} bytes; expected ${ref.length}`,
        );
      }
      return { offset: ref.offset, bytes };
    }),
  );
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

/**
 * Deletes the chunk objects starting before `beforeOffset` (all of them when
 * omitted), then their rows. A row whose object could not be deleted stays,
 * so a later clear or the sweep retries it. Never throws.
 */
async function dropStaged(
  store: StagingObjectStore,
  upload: Pick<StagingUpload, "stagingKey" | "uploadId">,
  beforeOffset?: number,
): Promise<boolean> {
  try {
    const { rows } = await getDbExec().execute({
      sql: `SELECT byte_offset, byte_length, object_key FROM multipart_staging_parts
        WHERE staging_key = $1 AND upload_id = $2 AND byte_offset < $3
        ORDER BY byte_offset
        LIMIT $4`,
      args: [
        upload.stagingKey,
        upload.uploadId,
        beforeOffset ?? Number.MAX_SAFE_INTEGER,
        MAX_REFS_PER_READ,
      ],
    });
    let complete = true;
    for (const ref of rows.map(readRef)) {
      try {
        await store.deleteObject(ref.objectKey);
      } catch (error) {
        complete = false;
        warn("failed to delete a staged chunk object", error);
        continue;
      }
      await getDbExec().execute({
        sql: `DELETE FROM multipart_staging_parts
          WHERE staging_key = $1 AND upload_id = $2 AND byte_offset = $3`,
        args: [upload.stagingKey, upload.uploadId, ref.offset],
      });
    }
    return complete;
  } catch (error) {
    warn("failed to clear staged chunks", error);
    return false;
  }
}

/** Drop every staged chunk of one upload (complete/abort). Never throws. */
export async function clearStaged(
  store: StagingObjectStore,
  upload: Pick<StagingUpload, "stagingKey" | "uploadId">,
): Promise<void> {
  await dropStaged(store, upload);
}

/** Drop staged chunks already sent in recorded parts. Never throws. */
export async function clearStagedBefore(
  store: StagingObjectStore,
  upload: Pick<StagingUpload, "stagingKey" | "uploadId">,
  offset: number,
): Promise<void> {
  await dropStaged(store, upload, offset);
}

/**
 * Drops the staged chunks of uploads that can no longer resume: storage
 * reports their multipart upload gone (completed, aborted, or expired by a
 * bucket lifecycle rule). Uploads storage still holds keep their chunks, so a
 * paused recording resumes with its pending bytes intact. Only uploads in
 * this bucket are checked. Best effort and never throws.
 */
export async function sweepExpiredStaging(options: {
  store: StagingObjectStore;
  storageFingerprint: string;
  probe: (targetKey: string, uploadId: string) => Promise<MultipartUploadState>;
  now?: number;
}): Promise<{ checked: number; cleared: number }> {
  const now = options.now ?? Date.now();
  let checked = 0;
  let cleared = 0;
  try {
    const { rows } = await getDbExec().execute({
      sql: `SELECT staging_key, upload_id, MIN(target_key) AS target_key
        FROM multipart_staging_parts
        WHERE storage_fingerprint = $1
        GROUP BY staging_key, upload_id
        HAVING MAX(updated_at) < $2
        ORDER BY MAX(updated_at)
        LIMIT $3`,
      args: [
        options.storageFingerprint,
        new Date(now - STAGING_PROBE_AFTER_MS).toISOString(),
        SWEEP_UPLOADS_PER_RUN,
      ],
    });
    for (const row of rows) {
      const r = row as {
        staging_key?: unknown;
        upload_id?: unknown;
        target_key?: unknown;
      };
      if (
        typeof r.staging_key !== "string" ||
        typeof r.upload_id !== "string" ||
        typeof r.target_key !== "string"
      ) {
        continue;
      }
      checked += 1;
      let state: MultipartUploadState;
      try {
        state = await options.probe(r.target_key, r.upload_id);
      } catch (error) {
        warn("failed to check a staged upload", error);
        continue;
      }
      if (state !== "gone") continue;
      if (
        await dropStaged(options.store, {
          stagingKey: r.staging_key,
          uploadId: r.upload_id,
        })
      ) {
        cleared += 1;
      }
    }
  } catch (error) {
    warn("failed to sweep staged chunks", error);
  }
  return { checked, cleared };
}
