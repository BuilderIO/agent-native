import {
  SOURCE_HEAD_BYTES,
  sourceHeadSha256,
} from "@shared/source-fingerprint.js";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { ownerEmailMatches } from "./recordings.js";

/**
 * The owner's uploaded clip of the file with this fingerprint, if any. A clip
 * still uploading doesn't count: it may yet fail, and then the caller's copy is
 * the only one.
 */
export async function findUploadedSourceRecording(
  ownerEmail: string,
  sha256: string,
) {
  const rows = await getDb()
    .select({
      id: schema.recordings.id,
      organizationId: schema.recordings.organizationId,
      status: schema.recordings.status,
    })
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.sourceHeadSha256, sha256),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
        inArray(schema.recordings.status, ["ready", "processing"]),
        isNull(schema.recordings.trashedAt),
      ),
    )
    .orderBy(desc(schema.recordings.createdAt))
    .limit(1);
  return rows.at(0) ?? null;
}

/**
 * Stores the fingerprint of the file an upload carries, from its first chunk.
 * A first chunk shorter than the fingerprinted span is skipped unless it is
 * the whole file, so a live recording's small first chunk records nothing.
 */
export async function recordSourceHeadFromFirstChunk(input: {
  recordingId: string;
  ownerEmail: string;
  index: number;
  bytes: Uint8Array;
  isFinal: boolean;
}): Promise<void> {
  if (input.index !== 0 || input.bytes.byteLength === 0) return;
  if (input.bytes.byteLength < SOURCE_HEAD_BYTES && !input.isFinal) return;
  try {
    const sha256 = await sourceHeadSha256(input.bytes);
    await getDb()
      .update(schema.recordings)
      .set({ sourceHeadSha256: sha256 })
      .where(
        and(
          eq(schema.recordings.id, input.recordingId),
          ownerEmailMatches(schema.recordings.ownerEmail, input.ownerEmail),
          isNull(schema.recordings.sourceHeadSha256),
        ),
      );
  } catch (error) {
    // A missing fingerprint only lets a later retry of this file upload it
    // again; it must never fail the chunk that is uploading it now.
    console.warn(
      "[source-fingerprint] could not store an upload's fingerprint",
      {
        recordingId: input.recordingId,
        err: error instanceof Error ? error.message : String(error),
      },
    );
  }
}
