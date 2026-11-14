/**
 * One chunk of one separate track of a rich recording
 * (shared/rich-recording.ts), relayed into its own resumable session at the
 * recording's storage provider.
 *
 * Route: POST /api/uploads/:recordingId/tracks/:track
 *   ?index=<n>&contentType=<type>[&uploadGenerationId=<id>]
 *
 * A track's chunks go in order, one at a time; a chunk already stored is
 * acknowledged again without being stored twice. The flattened video keeps
 * using `/chunk` and never waits on, or fails with, a track: at the size limit
 * the answer is 413 with `tracksStopped`, and the recorder stops sending
 * tracks while the recording goes on.
 *
 * Only for recordings whose owner had the "Rich recordings" lab on when the
 * first track arrived (`snapshotRichRecordingPolicy`). Once a redaction is
 * burned into the recording, its tracks are stopped: they were recorded before
 * the burn and can show what it hid.
 *
 * Each track has one upload session whatever the upload generation; the
 * session names the generation it was started under, and a chunk of a newer
 * generation cancels an older session and starts over.
 */
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import {
  createError,
  defineEventHandler,
  getHeader,
  getQuery,
  getRouterParam,
  readRawBody,
  setResponseStatus,
  type H3Event,
} from "h3";

import {
  isRichTrackId,
  normalizeRichTrackContentType,
} from "../../../../../../shared/rich-recording.js";
import { formatUploadBytes } from "../../../../../../shared/upload-limits.js";
import { getDb, schema } from "../../../../../db/index.js";
import { refuseContentUploadChunk } from "../../../../../lib/content-uploads.js";
import {
  hasBurnedRedactions,
  isHeldForRedaction,
} from "../../../../../lib/pending-redactions.js";
import { snapshotRichRecordingPolicy } from "../../../../../lib/recording-policy.js";
import {
  compareAndSetTrackSession,
  deleteTrackSession,
  discardTrackUpload,
  getTrackSession,
  listRecordingTracks,
  listTrackSessions,
  richBytesLimit,
  trackSessionGeneration,
  trackStorageFilename,
} from "../../../../../lib/recording-tracks.js";
import {
  getEventOwnerContext,
  ownerEmailMatches,
} from "../../../../../lib/recordings.js";
import type { StoredResumableSession } from "../../../../../lib/resumable-session.js";
import { abortResumableUploadSession } from "../../../../../lib/resumable-upload-cleanup.js";
import { resolveResumableUploadProvider } from "../../../../../lib/resumable-upload-provider.js";
import { resolveClipsVideoStorage } from "../../../../../lib/video-storage.js";

const MAX_CHUNK_BYTES = 4 * 1024 * 1024;

function boundedQueryString(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" &&
    first.length > 0 &&
    first.length <= 128 &&
    !/[\r\n]/.test(first)
    ? first
    : null;
}

function tracksStoppedReason(maxBytes: number): string {
  return `This recording's separate tracks reached their ${formatUploadBytes(maxBytes, "down")} limit, so Clips stopped keeping them. The recording itself goes on.`;
}

export async function handleTrackChunk(event: H3Event) {
  const recordingId = getRouterParam(event, "recordingId");
  if (!recordingId) {
    throw createError({ statusCode: 400, message: "Missing recordingId" });
  }
  const track = getRouterParam(event, "track");
  if (!isRichTrackId(track)) {
    throw createError({ statusCode: 404, message: "Unknown track" });
  }

  const query = getQuery(event);
  const uploadGenerationId = boundedQueryString(query.uploadGenerationId);
  const index = Number(query.index);
  if (!Number.isInteger(index) || index < 0 || index > 999_999) {
    throw createError({ statusCode: 400, message: "Invalid chunk index" });
  }
  const contentType = normalizeRichTrackContentType(track, query.contentType);
  if (!contentType) {
    throw createError({
      statusCode: 400,
      message: `Unsupported or missing contentType for the ${track} track`,
    });
  }

  const contentLength = Number(getHeader(event, "content-length") || 0);
  if (contentLength > MAX_CHUNK_BYTES) {
    setResponseStatus(event, 413);
    return { ok: false, error: "Chunk too large" };
  }

  let ownerEmail: string;
  let orgId: string | undefined;
  let authUserId: string | undefined;
  try {
    const context = await getEventOwnerContext(event);
    ownerEmail = context.userEmail;
    orgId = context.orgId;
    authUserId = context.authUserId;
  } catch {
    throw createError({ statusCode: 401, message: "Unauthorized" });
  }

  return runWithRequestContext(
    { userEmail: ownerEmail, orgId, authUserId },
    async () => {
      const recordingWhere = and(
        eq(schema.recordings.id, recordingId),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
      );
      const found = await getDb()
        .select({
          id: schema.recordings.id,
          storageMode: schema.recordings.storageMode,
          uploadGenerationId: schema.recordings.uploadGenerationId,
          mediaFormat: schema.recordings.mediaFormat,
          editsJson: schema.recordings.editsJson,
          trashedAt: schema.recordings.trashedAt,
          failureCode: schema.recordings.failureCode,
        })
        .from(schema.recordings)
        .where(recordingWhere)
        .limit(1);
      const existing = found.length ? found[0] : null;
      if (
        !existing ||
        existing.trashedAt ||
        existing.failureCode === "taken_down"
      ) {
        throw createError({ statusCode: 404, message: "Recording not found" });
      }
      await refuseContentUploadChunk(recordingId);

      const generationId = existing.uploadGenerationId ?? null;
      if (uploadGenerationId !== generationId) {
        setResponseStatus(event, 409);
        return {
          ok: false,
          error: "A newer upload of this recording is active.",
          staleAttempt: true,
        };
      }
      if (existing.mediaFormat === "rich") {
        setResponseStatus(event, 409);
        return {
          ok: false,
          error: "This recording's tracks are already finalized.",
          tracksFinalized: true,
        };
      }
      // Pending redaction marks don't stop the chunks of a track upload under
      // way: the burn that applies them discards every track upload, and
      // finalize waits until they're settled. A new upload checks once saved.
      if (hasBurnedRedactions(existing.editsJson)) {
        setResponseStatus(event, 409);
        return {
          ok: false,
          error:
            "Redactions were burned into this recording, so Clips stopped keeping its separate tracks. The recording itself goes on.",
          tracksStopped: true,
        };
      }

      if (
        !(await snapshotRichRecordingPolicy(ownerEmail, orgId, recordingId))
      ) {
        setResponseStatus(event, 403);
        return {
          ok: false,
          error:
            "Separate tracks are off for this recording. Turn on Rich recordings in Labs before recording.",
          labDisabled: true,
          tracksStopped: true,
        };
      }

      const raw = await readRawBody(event, false);
      const bytes = raw ? new Uint8Array(raw) : new Uint8Array(0);
      if (bytes.byteLength > MAX_CHUNK_BYTES) {
        setResponseStatus(event, 413);
        return { ok: false, error: "Chunk too large" };
      }
      if (bytes.byteLength === 0) {
        throw createError({ statusCode: 400, message: "Empty chunk body" });
      }

      const rows = await listRecordingTracks(recordingId, ownerEmail);
      if (rows.some((row) => row.track === track)) {
        setResponseStatus(event, 409);
        return {
          ok: false,
          error: `The ${track} track is already stored.`,
          tracksFinalized: true,
        };
      }

      const label = `track-${track}-${recordingId}`;
      let session = await getTrackSession(recordingId, track);
      // A session from an earlier upload generation is replaced below.
      const stale =
        session && trackSessionGeneration(session) !== generationId
          ? session
          : null;
      if (stale) session = null;
      if (session && index <= (session.lastCommittedIndex ?? -1)) {
        return {
          ok: true,
          track,
          index,
          bytesUploaded: session.bytesUploaded,
          duplicate: true,
        };
      }
      if (session?.providerClosed) {
        setResponseStatus(event, 409);
        return { ok: false, error: "This track's upload is already closed." };
      }
      const expectedIndex = (session?.lastCommittedIndex ?? -1) + 1;
      if (index !== expectedIndex) {
        setResponseStatus(event, 409);
        return {
          ok: false,
          error: `Track chunks go in order; send chunk ${expectedIndex} next.`,
          expectedIndex,
        };
      }

      // Chunks of different tracks can pass this check together, so the
      // tracks can end up to a few chunks over the limit, never more.
      const maxBytes = richBytesLimit(existing.storageMode);
      const stored =
        rows.reduce((sum, row) => sum + row.bytes, 0) +
        (await listTrackSessions(recordingId))
          .filter(
            (entry) => trackSessionGeneration(entry.session) === generationId,
          )
          .reduce((sum, entry) => sum + entry.session.bytesUploaded, 0);
      if (stored + bytes.byteLength > maxBytes) {
        setResponseStatus(event, 413);
        return {
          ok: false,
          error: tracksStoppedReason(maxBytes),
          tracksStopped: true,
          bytesReceived: stored,
          maxBytes,
        };
      }

      if (!session) {
        if (
          stale &&
          !(await discardTrackUpload({
            recordingId,
            ownerEmail,
            storageMode: existing.storageMode,
            session: stale,
          }))
        ) {
          setResponseStatus(event, 503);
          return {
            ok: false,
            error:
              "Clips couldn't cancel an earlier upload of this track. Send the chunk again.",
            retryable: true,
          };
        }
        let provider;
        try {
          provider = (
            await resolveClipsVideoStorage({
              intent: "existing",
              recordingId,
              email: ownerEmail,
              userId: authUserId,
            })
          ).provider;
        } catch (err) {
          console.warn(
            `[track-chunk] storage for ${recordingId} could not be resolved:`,
            err instanceof Error ? err.message : String(err),
          );
          setResponseStatus(event, 503);
          return {
            ok: false,
            error: "Track storage could not be reached. Send the chunk again.",
            retryable: true,
          };
        }
        if (!provider?.resumable) {
          setResponseStatus(event, 409);
          return {
            ok: false,
            error:
              "This recording's storage can't take separate tracks, so Clips stopped keeping them. The recording itself goes on.",
            errorCode: "track_storage_unavailable",
            tracksStopped: true,
          };
        }
        let started;
        try {
          started = await provider.resumable.startSession(
            trackStorageFilename(recordingId, track),
            contentType,
            maxBytes,
          );
        } catch (err) {
          console.warn(
            `[track-chunk] ${track} upload of ${recordingId} could not start:`,
            err instanceof Error ? err.message : String(err),
          );
          setResponseStatus(event, 503);
          return {
            ok: false,
            error:
              "Track storage could not start an upload. Send the chunk again.",
            retryable: true,
          };
        }
        const fresh: StoredResumableSession = {
          providerId: provider.id,
          sessionId: started.sessionId,
          meta: {
            ...started.meta,
            stableUrl: true,
            recordAsset: false,
            clipsHiddenUpload: true,
            contentType,
            uploadGenerationId: generationId,
          },
          bytesUploaded: 0,
          lastCommittedIndex: -1,
        };
        if (
          !(await compareAndSetTrackSession(recordingId, track, stale, fresh))
        ) {
          await abortResumableUploadSession(fresh, { provider, label });
          setResponseStatus(event, 409);
          return {
            ok: false,
            error: "Another request started this track. Send the chunk again.",
            retryable: true,
          };
        }
        // A burn that read the track sessions before this one was saved can't
        // cancel it, so the upload cancels itself once redactions are waiting
        // or burned. Saving first, then checking, leaves no gap between them.
        const fenced = await getDb()
          .select({ editsJson: schema.recordings.editsJson })
          .from(schema.recordings)
          .where(recordingWhere)
          .limit(1);
        const editsJson = fenced.length ? fenced[0].editsJson : null;
        if (
          editsJson === null ||
          hasBurnedRedactions(editsJson) ||
          isHeldForRedaction(editsJson, null)
        ) {
          if (await abortResumableUploadSession(fresh, { provider, label })) {
            const current = await getTrackSession(recordingId, track);
            if (current?.sessionId === fresh.sessionId) {
              await deleteTrackSession(recordingId, track);
            }
          }
          setResponseStatus(event, 409);
          return {
            ok: false,
            error:
              "This recording has redactions, so Clips stopped keeping its separate tracks. The recording itself goes on.",
            tracksStopped: true,
          };
        }
        session = fresh;
      }

      const provider = await resolveResumableUploadProvider(session.providerId);
      if (!provider?.resumable) {
        setResponseStatus(event, 502);
        return {
          ok: false,
          error: "This track's upload storage is not configured.",
        };
      }

      const start = session.bytesUploaded;
      const contentRange = `bytes ${start}-${start + bytes.byteLength - 1}/*`;
      let relayed;
      try {
        relayed = await provider.resumable.relayChunk(
          { sessionId: session.sessionId, meta: session.meta },
          contentRange,
          bytes,
          { mimeType: contentType },
        );
      } catch (err) {
        console.warn(
          `[track-chunk] ${track} chunk ${index} of ${recordingId} failed:`,
          err instanceof Error ? err.message : String(err),
        );
        setResponseStatus(event, 502);
        return {
          ok: false,
          error: "Storage did not take this track chunk. Send it again.",
          retryable: true,
        };
      }
      if (!relayed.ok) {
        const restartRequired =
          relayed.status === 404 || relayed.status === 410;
        setResponseStatus(event, restartRequired ? 409 : 502);
        return {
          ok: false,
          error: `Storage refused this track chunk (${relayed.status}).`,
          ...(restartRequired ? { tracksStopped: true } : { retryable: true }),
        };
      }

      const next: StoredResumableSession = {
        ...session,
        ...(relayed.updatedMeta
          ? { meta: { ...session.meta, ...relayed.updatedMeta } }
          : {}),
        bytesUploaded: start + bytes.byteLength,
        lastCommittedIndex: index,
      };
      if (
        !(await compareAndSetTrackSession(recordingId, track, session, next))
      ) {
        // Storage has the chunk but this request couldn't record it.
        const current = await getTrackSession(recordingId, track);
        if (
          current?.sessionId === session.sessionId &&
          (current.lastCommittedIndex ?? -1) >= index
        ) {
          // Another request stored the same chunk and recorded it.
          return {
            ok: true,
            track,
            index,
            bytesUploaded: current.bytesUploaded,
            duplicate: true,
          };
        }
        // The upload was closed, discarded or replaced meanwhile, or storage
        // now holds bytes its record doesn't: sending again can't fix either.
        // An upload discarded meanwhile may have taken this chunk after it was
        // cancelled, so it's cancelled again, unless finalize stored the track.
        if (
          current?.sessionId !== session.sessionId &&
          !(await listRecordingTracks(recordingId, ownerEmail)).some(
            (row) => row.track === track,
          )
        ) {
          await abortResumableUploadSession(session, { provider, label });
        }
        setResponseStatus(event, 409);
        return {
          ok: false,
          error:
            "This track's upload changed while the chunk was stored, so Clips stopped keeping it. The recording itself goes on.",
          tracksStopped: true,
        };
      }
      return { ok: true, track, index, bytesUploaded: next.bytesUploaded };
    },
  );
}

export default defineEventHandler(handleTrackChunk);
