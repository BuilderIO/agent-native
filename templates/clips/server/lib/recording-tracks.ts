import { randomUUID } from "node:crypto";

import {
  compareAndSetAppState,
  deleteAppState,
  readAppState,
} from "@agent-native/core/application-state";
import { and, eq } from "drizzle-orm";

import {
  RICH_TRACK_IDS,
  type RichTrackId,
} from "../../shared/rich-recording.js";
import {
  HOSTED_MAX_RICH_BYTES,
  resolveMaxRichBytes,
} from "../../shared/upload-limits.js";
import { getDb, schema } from "../db/index.js";
import { deleteStoredMediaUrl } from "./recording-media-cleanup.js";
import { ownerEmailMatches } from "./recordings.js";
import type { StoredResumableSession } from "./resumable-session.js";
import { abortResumableUploadSession } from "./resumable-upload-cleanup.js";
import { deleteRejectedHostedUpload } from "./upload-recording-media.js";

/**
 * Under the recording's own `resumable-session-` prefix, so permanent deletion
 * captures an unfinished track upload the same way it captures the video's.
 * One key per track whatever the upload generation, so a recording restarted
 * under a new generation can't leave an earlier track upload where nothing
 * looks for it; the session names its generation instead.
 */
export function trackSessionKey(
  recordingId: string,
  track: RichTrackId,
): string {
  return `resumable-session-${recordingId}-track-${track}`;
}

/** The upload generation a track session was started under. */
export function trackSessionGeneration(
  session: StoredResumableSession,
): string | null {
  const generationId = session.meta.uploadGenerationId;
  return typeof generationId === "string" ? generationId : null;
}

export async function getTrackSession(
  recordingId: string,
  track: RichTrackId,
): Promise<StoredResumableSession | null> {
  const raw = await readAppState(trackSessionKey(recordingId, track));
  if (!raw || typeof raw !== "object") return null;
  return raw as unknown as StoredResumableSession;
}

export async function compareAndSetTrackSession(
  recordingId: string,
  track: RichTrackId,
  expected: StoredResumableSession | null,
  next: StoredResumableSession,
): Promise<boolean> {
  return compareAndSetAppState(
    trackSessionKey(recordingId, track),
    expected as unknown as Record<string, unknown> | null,
    next as unknown as Record<string, unknown>,
  );
}

export async function deleteTrackSession(
  recordingId: string,
  track: RichTrackId,
): Promise<void> {
  await deleteAppState(trackSessionKey(recordingId, track));
}

/** Every track session the recording holds, from any upload generation. */
export async function listTrackSessions(
  recordingId: string,
): Promise<Array<{ track: RichTrackId; session: StoredResumableSession }>> {
  const sessions = await Promise.all(
    RICH_TRACK_IDS.map(async (track) => ({
      track,
      session: await getTrackSession(recordingId, track),
    })),
  );
  return sessions.filter(
    (entry): entry is { track: RichTrackId; session: StoredResumableSession } =>
      entry.session !== null,
  );
}

/** All of a recording's tracks together may not pass this many bytes. */
export function richBytesLimit(storageMode: "own" | "hosted" | null): number {
  return storageMode === "hosted"
    ? HOSTED_MAX_RICH_BYTES
    : resolveMaxRichBytes();
}

/**
 * The name a track's upload is stored under. Storage only reads a recording's
 * files when they are named for it (`clips/<id>.<suffix>`, see
 * `isRecordingObjectKey`), so the track rides in the suffix. Each upload gets
 * its own name: two first chunks that race start two uploads, and the one
 * that loses must not cancel the other's file.
 */
export function trackStorageFilename(
  recordingId: string,
  track: RichTrackId,
): string {
  const nonce = randomUUID().replace(/-/g, "").slice(0, 12);
  return `${recordingId}.track-${track}-${nonce}`;
}

export type RecordingTrackRow = typeof schema.recordingTracks.$inferSelect;

export async function listRecordingTracks(
  recordingId: string,
  ownerEmail: string,
): Promise<RecordingTrackRow[]> {
  return getDb()
    .select()
    .from(schema.recordingTracks)
    .where(
      and(
        eq(schema.recordingTracks.recordingId, recordingId),
        eq(schema.recordingTracks.ownerEmail, ownerEmail.trim().toLowerCase()),
      ),
    );
}

/**
 * Removes a track upload the recording won't keep. One already completed is a
 * stored file by now, so it is deleted rather than cancelled. True once
 * nothing of it is left in storage.
 */
export async function discardTrackUpload(input: {
  recordingId: string;
  ownerEmail: string;
  storageMode: "own" | "hosted" | null;
  session: StoredResumableSession;
}): Promise<boolean> {
  const completedUrl = input.session.meta.completedUrl;
  if (typeof completedUrl !== "string" || !completedUrl) {
    return abortResumableUploadSession(input.session, {
      label: `track-${input.recordingId}`,
    });
  }
  // Bytes already counted stay counted, as they do when a burn deletes a
  // finalized track; the count only ever errs high.
  if (
    input.storageMode !== "hosted" ||
    input.session.meta.hostedBytesCounted === true
  ) {
    return deleteStoredMediaUrl(completedUrl, {
      storageMode: input.storageMode,
      recordingId: input.recordingId,
    }).catch((err: unknown) => {
      // Not discarded: the caller keeps the session so the delete is retried.
      console.warn(
        `[track-upload] completed track upload of ${input.recordingId} was not deleted:`,
        err instanceof Error ? err.message : String(err),
      );
      return false;
    });
  }
  // The helper throws the failure it was given once the file is gone, and
  // counts the bytes when it couldn't delete them.
  const discarded = new Error("Track upload discarded.");
  return deleteRejectedHostedUpload({
    recordingId: input.recordingId,
    ownerEmail: input.ownerEmail,
    url: completedUrl,
    additionalBytes: input.session.bytesUploaded,
    failure: discarded,
  }).catch((err: unknown) => err === discarded);
}

/**
 * Discards every track upload the recording still holds. A session whose file
 * a stored track already points to only loses its session; the file goes with
 * the track. Returns the uploads storage didn't confirm, whose sessions are
 * kept so permanent deletion still finds them.
 */
export async function discardTrackUploads(recording: {
  id: string;
  ownerEmail: string;
  storageMode: "own" | "hosted" | null;
}): Promise<string[]> {
  const left: string[] = [];
  const stored = new Set(
    (await listRecordingTracks(recording.id, recording.ownerEmail)).map(
      (row) => row.url,
    ),
  );
  for (const { track, session } of await listTrackSessions(recording.id)) {
    const completedUrl = session.meta.completedUrl;
    const discarded =
      (typeof completedUrl === "string" && stored.has(completedUrl)) ||
      (await discardTrackUpload({
        recordingId: recording.id,
        ownerEmail: recording.ownerEmail,
        storageMode: recording.storageMode,
        session,
      }));
    if (discarded) await deleteTrackSession(recording.id, track);
    else left.push(`unfinished ${track} track upload of ${recording.id}`);
  }
  return left;
}

/**
 * Deletes everything a recording holds of its separate tracks: unfinished
 * uploads, each stored track (dropping its row once storage confirms), and the
 * manifest, whose URL is cleared once it is gone. Reads the recording fresh,
 * so a manifest a finalize wrote after the caller's read is not missed. Returns
 * what is still stored, so the caller can hold the recording back the way it
 * does for the video itself.
 */
export async function deleteStoredRecordingTracks(recording: {
  id: string;
  ownerEmail: string;
  storageMode: "own" | "hosted" | null;
}): Promise<string[]> {
  const db = getDb();
  const found = await db
    .select({ richManifestUrl: schema.recordings.richManifestUrl })
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, recording.id),
        ownerEmailMatches(schema.recordings.ownerEmail, recording.ownerEmail),
      ),
    )
    .limit(1);
  const current = found.length ? found[0] : null;
  const left = await discardTrackUploads(recording);
  const tracks = await listRecordingTracks(recording.id, recording.ownerEmail);
  for (const track of tracks) {
    let deleted = false;
    try {
      deleted = await deleteStoredMediaUrl(track.url, {
        storageMode: recording.storageMode,
        recordingId: recording.id,
      });
    } catch (err) {
      console.warn(
        `[recording-tracks] could not delete the ${track.track} track of ${recording.id}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
    if (!deleted) {
      left.push(`${track.track} track of ${recording.id}`);
      continue;
    }
    await db
      .delete(schema.recordingTracks)
      .where(eq(schema.recordingTracks.id, track.id));
  }
  const manifestUrl = current?.richManifestUrl;
  if (manifestUrl) {
    let deleted = false;
    try {
      deleted = await deleteStoredMediaUrl(manifestUrl, {
        storageMode: recording.storageMode,
        recordingId: recording.id,
      });
    } catch (err) {
      console.warn(
        `[recording-tracks] could not delete the manifest of ${recording.id}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
    if (deleted) {
      await db
        .update(schema.recordings)
        .set({ richManifestUrl: null })
        .where(
          and(
            eq(schema.recordings.id, recording.id),
            eq(schema.recordings.richManifestUrl, manifestUrl),
          ),
        );
    } else {
      left.push(`track manifest of ${recording.id}`);
    }
  }
  return left;
}
