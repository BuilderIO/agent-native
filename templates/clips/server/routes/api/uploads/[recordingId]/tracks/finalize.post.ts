/**
 * Finalizes a rich recording's separate tracks once the recording itself is
 * finalized: closes and completes each track's upload, keeps a
 * `recording_tracks` row per track, writes `manifest.json`, then marks the
 * recording rich. Safe to call again: completed tracks are kept, and a
 * recording that is already rich answers with what it holds.
 *
 * Route: POST /api/uploads/:recordingId/tracks/finalize
 * Body: `finalizeRichRecordingSchema` (server/lib/rich-recording-manifest.ts).
 *
 * A track the recorder lists but never stored, or one storage refuses, is
 * left out and named in `droppedTracks`; the others still finalize. Track
 * uploads the recorder doesn't list are cancelled.
 */
import { randomUUID } from "node:crypto";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq, isNull, notInArray } from "drizzle-orm";
import {
  createError,
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";

import type { RichTrackId } from "../../../../../../shared/rich-recording.js";
import { isRetryableUploadInterruption } from "../../../../../../shared/upload-interruption.js";
import { getDb, schema } from "../../../../../db/index.js";
import {
  hasBurnedRedactions,
  isHeldForRedaction,
} from "../../../../../lib/pending-redactions.js";
import {
  claimLease,
  holdsLease,
  leaseHeld,
  releaseLease,
  renewLease,
} from "../../../../../lib/recording-leases.js";
import { deleteStoredMediaUrl } from "../../../../../lib/recording-media-cleanup.js";
import {
  richRecordingStopped,
  snapshotRichRecordingPolicy,
} from "../../../../../lib/recording-policy.js";
import {
  compareAndSetTrackSession,
  completeClosedTrackUpload,
  deleteStoredRecordingTracks,
  deleteTrackSessionIf,
  discardTrackUpload,
  getTrackSession,
  listRecordingTracks,
  listTrackSessions,
  type RecordingTrackRow,
  trackSessionGeneration,
} from "../../../../../lib/recording-tracks.js";
import {
  getEventOwnerContext,
  ownerEmailMatches,
} from "../../../../../lib/recordings.js";
import type { StoredResumableSession } from "../../../../../lib/resumable-session.js";
import { resolveResumableUploadProvider } from "../../../../../lib/resumable-upload-provider.js";
import {
  buildRichRecordingManifest,
  finalizeRichRecordingSchema,
  sanitizeTrackMeta,
} from "../../../../../lib/rich-recording-manifest.js";
import {
  deleteRejectedHostedUpload,
  uploadRecordingMedia,
} from "../../../../../lib/upload-recording-media.js";
import { addHostedClipRecordingBytes } from "../../../../../lib/video-storage.js";

type DroppedTrack = {
  id: RichTrackId;
  reason: "not_uploaded" | "storage_refused" | "storage_full";
};

/**
 * One finalize of a recording's tracks at a time, so none is counted twice. A
 * finalize renews it before each step that counts, stores or deletes, and
 * stops once it has lapsed, since another finalize may have taken over.
 */
const FINALIZE_LEASE_MS = 2 * 60 * 1000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function trackSummary(rows: RecordingTrackRow[]) {
  return rows.map((row) => ({
    id: row.track,
    bytes: row.bytes,
    complete: row.complete,
  }));
}

/**
 * Closes and completes one track's upload, once: the stored URL is kept on
 * the session before anything else, so a retry after a lost response reuses
 * it instead of completing the upload again.
 */
export async function completeTrackUpload(input: {
  recordingId: string;
  ownerEmail: string;
  track: RichTrackId;
  session: StoredResumableSession;
}): Promise<
  | { ok: true; url: string; session: StoredResumableSession }
  | { ok: false; retryable: boolean }
> {
  let session = input.session;
  const completedUrl = session.meta.completedUrl;
  if (typeof completedUrl === "string" && completedUrl) {
    return { ok: true, url: completedUrl, session };
  }
  const provider = await resolveResumableUploadProvider(session.providerId);
  if (!provider?.resumable) return { ok: false, retryable: true };

  if (!session.providerClosed) {
    const closed = await provider.resumable.relayChunk(
      { sessionId: session.sessionId, meta: session.meta },
      `bytes */${session.bytesUploaded}`,
      new Uint8Array(0),
    );
    if (!closed.ok || closed.status === 308) {
      return {
        ok: false,
        retryable: closed.status !== 404 && closed.status !== 410,
      };
    }
    const next: StoredResumableSession = {
      ...session,
      ...(closed.updatedMeta
        ? { meta: { ...session.meta, ...closed.updatedMeta } }
        : {}),
      providerClosed: true,
    };
    if (
      !(await compareAndSetTrackSession(
        input.recordingId,
        input.track,
        session,
        next,
      ))
    ) {
      return { ok: false, retryable: true };
    }
    session = next;
  }

  const url = await completeClosedTrackUpload({
    recordingId: input.recordingId,
    ownerEmail: input.ownerEmail,
    session,
  });
  if (!url) return { ok: false, retryable: true };
  const completed: StoredResumableSession = {
    ...session,
    meta: { ...session.meta, completedUrl: url },
  };
  await compareAndSetTrackSession(
    input.recordingId,
    input.track,
    session,
    completed,
  );
  return { ok: true, url, session: completed };
}

export async function handleFinalizeTracks(event: H3Event) {
  const recordingId = getRouterParam(event, "recordingId");
  if (!recordingId) {
    throw createError({ statusCode: 400, message: "Missing recordingId" });
  }
  let raw: unknown;
  try {
    raw = await readBody(event);
  } catch (err) {
    setResponseStatus(event, 400);
    return {
      ok: false,
      error: `The track finalize request is not valid JSON: ${errorMessage(err)}`,
    };
  }
  const parsed = finalizeRichRecordingSchema.safeParse(raw);
  if (!parsed.success) {
    setResponseStatus(event, 400);
    return {
      ok: false,
      error: "The track finalize request is not valid.",
      issues: parsed.error.issues.slice(0, 10).map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }
  const input = parsed.data;

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
    {
      userEmail: ownerEmail,
      ...(orgId === undefined ? {} : { orgId }),
      ...(authUserId === undefined ? {} : { authUserId }),
    },
    async () => {
      const db = getDb();
      const ownerKey = ownerEmail.trim().toLowerCase();
      const recordingWhere = and(
        eq(schema.recordings.id, recordingId),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
      );
      const found = await db
        .select({
          id: schema.recordings.id,
          status: schema.recordings.status,
          storageMode: schema.recordings.storageMode,
          uploadGenerationId: schema.recordings.uploadGenerationId,
          mediaFormat: schema.recordings.mediaFormat,
          richBytes: schema.recordings.richBytes,
          editsJson: schema.recordings.editsJson,
          trashedAt: schema.recordings.trashedAt,
          failureCode: schema.recordings.failureCode,
          failureReason: schema.recordings.failureReason,
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

      if (existing.mediaFormat === "rich") {
        const rows = await listRecordingTracks(recordingId, ownerEmail);
        return {
          ok: true,
          recordingId,
          mediaFormat: "rich" as const,
          richBytes: existing.richBytes,
          tracks: trackSummary(rows),
          alreadyFinalized: true,
        };
      }

      const generationId = existing.uploadGenerationId ?? null;
      if ((input.uploadGenerationId ?? null) !== generationId) {
        setResponseStatus(event, 409);
        return {
          ok: false,
          error: "A newer upload of this recording is active.",
          staleAttempt: true,
        };
      }
      // Hosted storage counts a recording's bytes once its video is in, and
      // the flattened video always goes first, so tracks wait for it.
      // An interrupted upload resumes on the same attempt, tracks included.
      if (existing.status === "failed") {
        setResponseStatus(event, 409);
        return isRetryableUploadInterruption(existing.failureReason)
          ? {
              ok: false,
              error:
                "The recording's upload was interrupted. Send this again once it resumes.",
              retryable: true,
            }
          : {
              ok: false,
              error: "The recording failed, so its tracks were not kept.",
              tracksStopped: true,
            };
      }
      if (existing.status === "uploading") {
        setResponseStatus(event, 409);
        return {
          ok: false,
          error: "Finalize the recording before its tracks.",
          recordingNotFinalized: true,
          retryable: true,
        };
      }
      // First, since a burn also stops the recording's tracks: anything
      // stored late is deleted rather than left behind a refusal.
      if (hasBurnedRedactions(existing.editsJson)) {
        // Everything uploaded or stored of its tracks predates the burn and
        // can still show what was redacted.
        const left = await deleteStoredRecordingTracks({
          id: recordingId,
          ownerEmail,
          storageMode: existing.storageMode,
        });
        if (left.length) {
          console.warn(
            `[track-finalize] still stored after a burned redaction: ${left.join(", ")}`,
          );
        }
        setResponseStatus(event, 409);
        return {
          ok: false,
          error:
            "Redactions were burned into this recording, so its separate tracks were not kept.",
          tracksStopped: true,
        };
      }

      const tracksOff = () => {
        setResponseStatus(event, 403);
        return {
          ok: false,
          error: "Separate tracks are off for this recording.",
          labDisabled: true,
          tracksStopped: true,
        };
      };
      if (
        !(await snapshotRichRecordingPolicy(ownerEmail, orgId, recordingId))
      ) {
        return tracksOff();
      }

      // The tracks can show what the owner marked for redaction, so they wait
      // until the marks are burned in, which discards them, or cleared.
      if (isHeldForRedaction(existing.editsJson, null)) {
        setResponseStatus(event, 409);
        return {
          ok: false,
          error:
            "This recording has redactions that aren't applied yet. Finalize its tracks again once they are applied or cleared.",
          redactionPending: true,
          retryable: true,
        };
      }

      const lease = await claimLease(
        `rich-finalize:${recordingId}`,
        FINALIZE_LEASE_MS,
      );
      if (!lease) {
        setResponseStatus(event, 409);
        return {
          ok: false,
          error:
            "This recording's tracks are already being finalized. Finalize again shortly.",
          retryable: true,
        };
      }
      const lapsed = () => {
        setResponseStatus(event, 409);
        return {
          ok: false,
          error:
            "This finalize ran too long, so another may have taken over. Finalize again.",
          retryable: true,
        };
      };
      try {
        const editsUnchanged = eq(
          schema.recordings.editsJson,
          existing.editsJson,
        );
        // The tracks belong to the upload attempt read here. A retry that
        // starts a new one, or an abort that fails the recording, keeps none.
        const attemptUnchanged = and(
          generationId === null
            ? isNull(schema.recordings.uploadGenerationId)
            : eq(schema.recordings.uploadGenerationId, generationId),
          notInArray(schema.recordings.status, ["uploading", "failed"]),
        );
        const listed = new Map(input.tracks.map((track) => [track.id, track]));
        const stored = new Map(
          (await listRecordingTracks(recordingId, ownerEmail)).map((row) => [
            row.track,
            row,
          ]),
        );
        const sessions = await listTrackSessions(recordingId);
        // Uploads the recorder no longer stands behind are cancelled, and so
        // are ones from an earlier upload generation or for a track already
        // stored. A session left behind by a stored track only loses its
        // session, since the track still points to the file.
        for (const { track, session } of sessions) {
          const current = trackSessionGeneration(session) === generationId;
          if (
            current &&
            listed.has(track) &&
            !stored.has(track) &&
            session.bytesUploaded > 0
          ) {
            continue;
          }
          if (
            (typeof session.meta.completedUrl === "string" &&
              session.meta.completedUrl === stored.get(track)?.url) ||
            (await discardTrackUpload({
              recordingId,
              ownerEmail,
              storageMode: existing.storageMode,
              session,
            }))
          ) {
            // Unless a chunk started a newer upload over it meanwhile.
            await deleteTrackSessionIf(recordingId, track, session);
          }
        }

        const dropped: DroppedTrack[] = [];
        for (const track of input.tracks) {
          if (stored.has(track.id)) continue;
          const uploaded = sessions.find(
            (entry) =>
              entry.track === track.id &&
              trackSessionGeneration(entry.session) === generationId,
          )?.session;
          if (!uploaded || uploaded.bytesUploaded <= 0) {
            dropped.push({ id: track.id, reason: "not_uploaded" });
            continue;
          }
          if (!(await renewLease(lease, FINALIZE_LEASE_MS))) return lapsed();

          let completed;
          try {
            completed = await completeTrackUpload({
              recordingId,
              ownerEmail,
              track: track.id,
              session: uploaded,
            });
          } catch (err) {
            console.warn(
              `[track-finalize] ${track.id} track of ${recordingId} did not complete:`,
              errorMessage(err),
            );
            completed = { ok: false as const, retryable: true };
          }
          if (!completed.ok) {
            if (completed.retryable) {
              setResponseStatus(event, 502);
              return {
                ok: false,
                error: `Storage did not finish the ${track.id} track. Finalize again.`,
                retryable: true,
              };
            }
            dropped.push({ id: track.id, reason: "storage_refused" });
            await deleteTrackSessionIf(recordingId, track.id, uploaded);
            continue;
          }

          let session = completed.session;
          if (
            existing.storageMode === "hosted" &&
            session.meta.hostedBytesCounted !== true
          ) {
            let accounting;
            try {
              accounting = await addHostedClipRecordingBytes({
                recordingId,
                ownerEmail,
                userId: authUserId ?? null,
                additionalBytes: session.bytesUploaded,
              });
            } catch (err) {
              // Most often the recording's own bytes aren't counted yet. The
              // completed track is kept on its session for the next try.
              console.warn(
                `[track-finalize] ${track.id} track of ${recordingId} could not be counted yet:`,
                errorMessage(err),
              );
              setResponseStatus(event, 409);
              return {
                ok: false,
                error:
                  "The recording isn't ready for its tracks yet. Finalize them again shortly.",
                recordingNotFinalized: true,
                retryable: true,
              };
            }
            if (!accounting.ok) {
              // The helper throws the failure it was given once the file is
              // gone, and counts the bytes when it couldn't delete them.
              const full = new Error("Hosted Clips storage is full.");
              const deleted = await deleteRejectedHostedUpload({
                recordingId,
                ownerEmail,
                url: completed.url,
                additionalBytes: session.bytesUploaded,
                failure: full,
              }).catch((err: unknown) => {
                if (err === full) return true;
                console.warn(
                  `[track-finalize] ${track.id} track of ${recordingId} over the hosted limit:`,
                  errorMessage(err),
                );
                return false;
              });
              dropped.push({ id: track.id, reason: "storage_full" });
              // A file storage kept keeps its session, the only thing that
              // points to it, so a retry or permanent deletion still finds it.
              if (deleted) {
                await deleteTrackSessionIf(recordingId, track.id, session);
              }
              continue;
            }
            // Marked before the row is written, so a retry never counts the
            // track twice. Losing the mark only counts it twice, never zero.
            const counted: StoredResumableSession = {
              ...session,
              meta: { ...session.meta, hostedBytesCounted: true },
            };
            await compareAndSetTrackSession(
              recordingId,
              track.id,
              session,
              counted,
            );
            session = counted;
          }

          const now = new Date().toISOString();
          const values = {
            ownerEmail: ownerKey,
            url: completed.url,
            contentType:
              typeof session.meta.contentType === "string"
                ? session.meta.contentType
                : "application/octet-stream",
            bytes: session.bytesUploaded,
            startMs: track.startMs,
            endMs: track.endMs,
            complete: track.complete,
            metaJson: JSON.stringify(sanitizeTrackMeta(track.id, track.meta)),
            updatedAt: now,
          };
          if (!(await renewLease(lease, FINALIZE_LEASE_MS))) return lapsed();
          // The recording's row stays locked while the track's row is written:
          // a redaction marked since the read either lands first, and the track
          // isn't kept, or waits, and the burn that follows it deletes the track.
          const kept = await db.transaction(async (tx) => {
            const unchanged = await tx
              .select({ id: schema.recordings.id })
              .from(schema.recordings)
              .where(
                and(
                  recordingWhere,
                  eq(schema.recordings.mediaFormat, "flat"),
                  editsUnchanged,
                  attemptUnchanged,
                  leaseHeld(lease),
                ),
              )
              .for("update")
              .limit(1);
            if (!unchanged.length) return "changed" as const;
            // A burn saves its stop before it changes this row, so the stop
            // shows here even once the owner clears the marks again.
            if (await richRecordingStopped(tx, ownerKey, recordingId)) {
              return "stopped" as const;
            }
            // A row another finalize wrote first is left alone, file and all.
            const inserted = await tx
              .insert(schema.recordingTracks)
              .values({
                id: randomUUID(),
                recordingId,
                track: track.id,
                createdAt: now,
                ...values,
              })
              .onConflictDoNothing({
                target: [
                  schema.recordingTracks.recordingId,
                  schema.recordingTracks.track,
                ],
              })
              .returning({ id: schema.recordingTracks.id });
            return inserted.length > 0
              ? ("kept" as const)
              : ("changed" as const);
          });
          if (kept === "changed" && !(await holdsLease(lease))) {
            return lapsed();
          }
          if (kept === "stopped") {
            // No finalize keeps this track now, so its upload goes too, unless
            // a stored track already points to the same file.
            const referenced = (
              await listRecordingTracks(recordingId, ownerEmail)
            ).some((row) => row.url === completed.url);
            if (
              referenced ||
              (await discardTrackUpload({
                recordingId,
                ownerEmail,
                storageMode: existing.storageMode,
                session,
              }))
            ) {
              await deleteTrackSessionIf(recordingId, track.id, session);
            }
            return tracksOff();
          }
          if (kept === "changed") {
            // The completed upload stays on its session for the next try, unless
            // a burn already discarded the session and left the file to this
            // one. A file a stored track points to is never this one's to delete.
            const current = await getTrackSession(recordingId, track.id);
            const referenced = (
              await listRecordingTracks(recordingId, ownerEmail)
            ).some((row) => row.url === completed.url);
            if (!referenced && current?.meta.completedUrl !== completed.url) {
              await discardTrackUpload({
                recordingId,
                ownerEmail,
                storageMode: existing.storageMode,
                session,
              });
            }
            setResponseStatus(event, 409);
            return {
              ok: false,
              error:
                "The recording changed while its tracks were finalized. Finalize again.",
              retryable: true,
            };
          }
          await deleteTrackSessionIf(recordingId, track.id, session);
        }

        const rows = await listRecordingTracks(recordingId, ownerEmail);
        if (rows.length === 0) {
          return {
            ok: true,
            recordingId,
            mediaFormat: "flat" as const,
            richBytes: 0,
            tracks: [],
            droppedTracks: dropped,
            tracksStopped: true,
          };
        }

        if (!(await renewLease(lease, FINALIZE_LEASE_MS))) return lapsed();
        const manifest = buildRichRecordingManifest(recordingId, input, rows);
        let manifestUrl: string;
        try {
          const uploaded = await uploadRecordingMedia({
            recordingId,
            ownerEmail,
            data: new TextEncoder().encode(JSON.stringify(manifest)),
            filename: "manifest.json",
            mimeType: "application/json",
            stableUrl: true,
            recordAsset: false,
          });
          if (!uploaded) throw new Error("No file storage took the manifest.");
          manifestUrl = uploaded.url;
        } catch (err) {
          console.warn(
            `[track-finalize] manifest of ${recordingId} was not stored:`,
            errorMessage(err),
          );
          setResponseStatus(event, 502);
          return {
            ok: false,
            error: "Storage did not take the track manifest. Finalize again.",
            retryable: true,
          };
        }

        const richBytes = rows.reduce((sum, row) => sum + row.bytes, 0);
        // Under the row lock and the stop check, like each track's row.
        const flipped = await db.transaction(async (tx) => {
          const unchanged = await tx
            .select({ id: schema.recordings.id })
            .from(schema.recordings)
            .where(
              and(
                recordingWhere,
                eq(schema.recordings.mediaFormat, "flat"),
                // A redaction marked since the read would make these tracks stale.
                editsUnchanged,
                attemptUnchanged,
                leaseHeld(lease),
              ),
            )
            .for("update")
            .limit(1);
          if (!unchanged.length) return "changed" as const;
          if (await richRecordingStopped(tx, ownerKey, recordingId)) {
            return "stopped" as const;
          }
          await tx
            .update(schema.recordings)
            .set({
              mediaFormat: "rich",
              richManifestUrl: manifestUrl,
              richBytes,
              updatedAt: new Date().toISOString(),
            })
            .where(recordingWhere);
          return "rich" as const;
        });
        if (flipped === "changed" && !(await holdsLease(lease))) {
          return lapsed();
        }
        if (flipped !== "rich") {
          // Another finalize finished first, the recording's edits changed, or
          // a burn stopped its tracks; this manifest copy is surplus either way.
          const surplusDeleted = await deleteStoredMediaUrl(manifestUrl, {
            storageMode: existing.storageMode,
            recordingId,
          }).catch((err: unknown) => {
            console.warn(
              `[track-finalize] surplus manifest of ${recordingId} could not be deleted:`,
              errorMessage(err),
            );
            return false;
          });
          if (!surplusDeleted) {
            console.warn(
              `[track-finalize] surplus manifest of ${recordingId} is left in storage: ${manifestUrl}`,
            );
          }
          if (flipped === "stopped") return tracksOff();
          const currentRows = await db
            .select({
              mediaFormat: schema.recordings.mediaFormat,
              richBytes: schema.recordings.richBytes,
            })
            .from(schema.recordings)
            .where(recordingWhere)
            .limit(1);
          const current = currentRows.length ? currentRows[0] : null;
          if (!current) {
            throw createError({
              statusCode: 404,
              message: "Recording not found",
            });
          }
          if (current.mediaFormat !== "rich") {
            setResponseStatus(event, 409);
            return {
              ok: false,
              error:
                "The recording changed while its tracks were finalized. Finalize again.",
              retryable: true,
            };
          }
          return {
            ok: true,
            recordingId,
            mediaFormat: "rich" as const,
            richBytes: current.richBytes,
            tracks: trackSummary(
              await listRecordingTracks(recordingId, ownerEmail),
            ),
            alreadyFinalized: true,
          };
        }

        return {
          ok: true,
          recordingId,
          mediaFormat: "rich" as const,
          richBytes,
          tracks: trackSummary(rows),
          ...(dropped.length ? { droppedTracks: dropped } : {}),
        };
      } finally {
        try {
          await releaseLease(lease);
        } catch (err) {
          // Expires on its own, so the next finalize waits out the TTL at worst.
          console.warn(
            `[track-finalize] lease of ${recordingId} was not released:`,
            errorMessage(err),
          );
        }
      }
    },
  );
}

export default defineEventHandler(handleFinalizeTracks);
