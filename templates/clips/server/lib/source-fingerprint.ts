import {
  SOURCE_HEAD_BYTES,
  sourceHeadSha256,
} from "@shared/source-fingerprint.js";
import { and, desc, eq, isNull } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { ownerEmailMatches } from "./recordings.js";

/**
 * The owner's ready clip of the file with this fingerprint, if any. A clip
 * still uploading or processing doesn't count: it may yet fail verification,
 * and the caller drops its own copy on a match.
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
        eq(schema.recordings.status, "ready"),
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
 * A failed write fails the chunk so the client retries it: a clip left without
 * its fingerprint is the duplicate this exists to prevent.
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
}
