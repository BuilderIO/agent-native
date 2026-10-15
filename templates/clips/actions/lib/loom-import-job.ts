import { writeAppState } from "@agent-native/core/application-state";
import { uploadFile } from "@agent-native/core/file-upload";
import { and, asc, eq, gte, inArray, isNull, ne, or } from "drizzle-orm";

import { getDb, schema } from "../../server/db/index.js";
import { queueBuilderMediaCompression } from "../../server/lib/builder-media-compression.js";
import {
  ensureRecordingThumbnail,
  isRetryableRecordingThumbnailStatus,
} from "../../server/lib/ensure-recording-thumbnail.js";
import { dispatchPostFinalizeJob } from "../../server/lib/post-finalize-dispatch.js";
import { trackRecordingFailure } from "../../server/lib/recording-failures.js";
import { ownerEmailMatches } from "../../server/lib/recordings.js";
import { deleteS3ObjectByUrl } from "../../server/lib/s3-upload-provider.js";
import { transactionalEmailStore } from "../../server/lib/transactional-email-store.js";
import {
  UPLOAD_LEASE_MS,
  renewUploadLease,
} from "../../server/lib/upload-lease.js";
import {
  consumeHostedClipRecording,
  releaseHostedClipRecording,
  resolveClipsVideoStorage,
  verifyHostedClipMedia,
} from "../../server/lib/video-storage.js";
import {
  extractLoomVideoId,
  loomEmbedUrlForId,
  normalizeLoomShareUrl,
} from "../../shared/loom.js";
import {
  fetchLoomTranscript,
  loomTranscriptUnavailableMessage,
} from "./loom-transcript.js";
import { downloadLoomVideo, LoomVideoUnavailableError } from "./loom-video.js";

export type LoomImportJobResult = {
  status: "ready" | "failed";
  failureReason?: string;
};

const LOOM_IMPORT_LEASE_RENEWAL_MS = UPLOAD_LEASE_MS / 12;
const LOOM_IMPORT_LEASE_LOST_REASON =
  "The Loom import lease was lost before media was saved.";
const LOOM_IMPORT_LEASE_UNCONFIRMED_REASON =
  "The Loom import lease could not be confirmed before media was saved.";
const TAKEN_DOWN_FAILURE_CODE = "taken_down";
const TAKEN_DOWN_REASON =
  "This recording was removed from hosted Clips storage.";

function notTakenDown() {
  return or(
    isNull(schema.recordings.failureCode),
    ne(schema.recordings.failureCode, TAKEN_DOWN_FAILURE_CODE),
  );
}

async function startLoomImportLeaseRenewal(input: {
  recordingId: string;
  ownerEmail: string;
  claimId: string;
}) {
  let lost = false;
  let renewalFailed = false;
  let stopped = false;
  let renewalInFlight: Promise<void> | null = null;

  const renew = async () => {
    try {
      const result = await renewUploadLease(input.recordingId, {
        ownerEmail: input.ownerEmail,
        loomImportClaimId: input.claimId,
      });
      if (!result.held) {
        lost = true;
      } else {
        renewalFailed = false;
      }
    } catch (err) {
      renewalFailed = true;
      console.warn("[clips] Loom import lease renewal failed", {
        recordingId: input.recordingId,
        claimId: input.claimId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  await renew();
  const timer =
    lost || renewalFailed
      ? null
      : setInterval(() => {
          if (stopped || lost || renewalInFlight) return;

          renewalInFlight = renew().finally(() => {
            renewalInFlight = null;
          });
        }, LOOM_IMPORT_LEASE_RENEWAL_MS);

  return {
    get failureReason() {
      if (lost) return LOOM_IMPORT_LEASE_LOST_REASON;
      return renewalFailed ? LOOM_IMPORT_LEASE_UNCONFIRMED_REASON : null;
    },
    async stop() {
      if (!stopped) {
        stopped = true;
        if (timer) clearInterval(timer);
      }
      await renewalInFlight;
    },
  };
}

export async function enqueueFirstImportEmailIfEligible(
  input: { recordingId: string; ownerEmail: string; createdAt: string },
  db: ReturnType<typeof getDb> = getDb(),
): Promise<void> {
  const { enabledAt } = await transactionalEmailStore.ensureEnabledAt();
  if (input.createdAt < enabledAt) return;

  const [firstReadyImport] = await db
    .select({ id: schema.recordings.id })
    .from(schema.recordings)
    .where(
      and(
        ownerEmailMatches(schema.recordings.ownerEmail, input.ownerEmail),
        eq(schema.recordings.status, "ready"),
        inArray(schema.recordings.sourceAppName, ["Loom", "Video link"]),
        gte(schema.recordings.createdAt, enabledAt),
      ),
    )
    .orderBy(asc(schema.recordings.createdAt), asc(schema.recordings.id))
    .limit(1);
  if (firstReadyImport?.id !== input.recordingId) return;

  await transactionalEmailStore.enqueueOrConvergeFirstImport(
    input.ownerEmail,
    input.recordingId,
    input.ownerEmail,
  );
}

export async function failLoomImport(
  recordingId: string,
  failureReason: string,
  claimId?: string,
  failureCode = "loom_import_failed",
): Promise<LoomImportJobResult> {
  console.error("[loom-import] failed", {
    recordingId,
    claimId,
    failureReason,
  });
  const now = new Date().toISOString();
  const [updated] = await getDb()
    .update(schema.recordings)
    .set({
      status: "failed",
      failureCode,
      failureReason,
      loomImportClaimId: null,
      loomImportClaimedAt: null,
      updatedAt: now,
    })
    .where(
      claimId
        ? and(
            eq(schema.recordings.id, recordingId),
            eq(schema.recordings.status, "processing"),
            notTakenDown(),
            eq(schema.recordings.loomImportClaimId, claimId),
          )
        : and(
            eq(schema.recordings.id, recordingId),
            eq(schema.recordings.status, "processing"),
            notTakenDown(),
          ),
    )
    .returning({
      id: schema.recordings.id,
      ownerEmail: schema.recordings.ownerEmail,
      uploadAttemptId: schema.recordings.uploadAttemptId,
      recordingPlatform: schema.recordings.recordingPlatform,
    });
  if (!updated) return { status: "failed", failureReason };
  trackRecordingFailure({
    recordingId,
    userId: updated.ownerEmail,
    uploadAttemptId: updated.uploadAttemptId,
    platform: updated.recordingPlatform ?? "import",
    failureCode: "loom_import_failed",
  });

  try {
    await writeAppState(`recording-upload-${recordingId}`, {
      recordingId,
      status: "failed",
      failureReason,
      updatedAt: now,
    });
    await writeAppState("refresh-signal", { ts: Date.now() });
  } catch (err) {
    console.warn("[clips] Loom failure state update failed", {
      recordingId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return { status: "failed", failureReason };
}

export async function runLoomImportJob({
  recordingId,
  ownerEmail,
  claimId,
}: {
  recordingId: string;
  ownerEmail: string;
  claimId: string;
}): Promise<LoomImportJobResult> {
  const db = getDb();
  const [recording] = await db
    .select({
      id: schema.recordings.id,
      durationMs: schema.recordings.durationMs,
      sourceWindowTitle: schema.recordings.sourceWindowTitle,
      loomImportClaimId: schema.recordings.loomImportClaimId,
      createdAt: schema.recordings.createdAt,
      storageMode: schema.recordings.storageMode,
      videoUrl: schema.recordings.videoUrl,
      videoSizeBytes: schema.recordings.videoSizeBytes,
      videoFormat: schema.recordings.videoFormat,
      status: schema.recordings.status,
      failureCode: schema.recordings.failureCode,
    })
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, recordingId),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
      ),
    );

  const shareUrl = normalizeLoomShareUrl(recording?.sourceWindowTitle ?? "");
  const loomId = shareUrl ? extractLoomVideoId(shareUrl) : null;
  if (recording?.failureCode === TAKEN_DOWN_FAILURE_CODE) {
    return { status: "failed", failureReason: TAKEN_DOWN_REASON };
  }
  if (
    !recording ||
    recording.status !== "processing" ||
    recording.loomImportClaimId !== claimId ||
    !shareUrl ||
    !loomId
  ) {
    return failLoomImport(
      recordingId,
      "This Loom recording is missing its source URL.",
      claimId,
    );
  }

  console.log("[loom-import] job started", { recordingId, claimId });

  const lease = await startLoomImportLeaseRenewal({
    recordingId,
    ownerEmail,
    claimId,
  });
  if (lease.failureReason) {
    return { status: "failed", failureReason: lease.failureReason };
  }
  let media: Awaited<ReturnType<typeof downloadLoomVideo>> | null = null;
  let upload: Awaited<ReturnType<typeof uploadFile>> | null = null;
  let resolvedStorageMode = recording.storageMode;
  let uploadSizeMismatch = false;

  // An upload that never reached recordings.videoUrl is invisible to the
  // reaper, which would leave the object stored and the reservation held.
  // Linking it before the failure is recorded hands both to the reaper's
  // delete-then-release path. Returns whether the link landed.
  const linkUnlinkedHostedUpload = async (): Promise<boolean> => {
    if (!upload?.url || resolvedStorageMode !== "hosted") return false;
    try {
      const linked = await db
        .update(schema.recordings)
        .set({ videoUrl: upload.url })
        .where(
          and(
            eq(schema.recordings.id, recordingId),
            ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
            eq(schema.recordings.loomImportClaimId, claimId),
            eq(schema.recordings.status, "processing"),
            notTakenDown(),
          ),
        )
        .returning({ id: schema.recordings.id });
      return linked.length > 0;
    } catch (error) {
      console.error("[clips] Failed hosted Loom upload could not be linked", {
        recordingId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  };

  const cleanupUnlinkedHostedUploadAfterTakedown = async () => {
    if (!upload?.url || resolvedStorageMode !== "hosted") return;
    try {
      const [current] = await db
        .select({ failureCode: schema.recordings.failureCode })
        .from(schema.recordings)
        .where(
          and(
            eq(schema.recordings.id, recordingId),
            ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
          ),
        );
      if (current?.failureCode !== TAKEN_DOWN_FAILURE_CODE) return;

      const deleted = await deleteS3ObjectByUrl(upload.url, {
        storageMode: "hosted",
        recordingId,
      });
      if (!deleted) {
        console.warn(
          "[clips] Unlinked hosted Loom upload cleanup unavailable",
          {
            recordingId,
          },
        );
      }
    } catch (error) {
      console.warn("[clips] Unlinked hosted Loom upload cleanup failed", {
        recordingId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  try {
    const storage = await resolveClipsVideoStorage({
      intent: "existing",
      recordingId,
      email: ownerEmail,
    });
    if (storage.mode === "none") {
      const failureCode = storage.denyReason ?? "storage_setup_required";
      return await failLoomImport(
        recordingId,
        `Clips video storage is unavailable (${failureCode}).`,
        claimId,
        failureCode,
      );
    }
    if (storage.mode === "hosted" && !storage.provider) {
      // guard:allow-bare-error — invariant: a hosted storage resolution always includes its server-side provider.
      throw new Error("Hosted Clips storage provider is unavailable.");
    }
    resolvedStorageMode = storage.mode;

    let videoUrl = "";
    let videoSizeBytes = 0;
    let videoFormat = recording.videoFormat ?? "mp4";
    let usingLoomEmbed = false;
    const reusableHostedUrl =
      storage.mode === "hosted" ? recording.videoUrl : null;

    if (reusableHostedUrl) {
      videoSizeBytes = await verifyHostedClipMedia({
        recordingId,
        videoUrl: reusableHostedUrl,
      });
      if (lease.failureReason) {
        return { status: "failed", failureReason: lease.failureReason };
      }
      const consumed = await consumeHostedClipRecording({
        recordingId,
        ownerEmail,
        actualBytes: videoSizeBytes,
      });
      if (!consumed.ok) {
        return await failLoomImport(
          recordingId,
          `Hosted Clips storage could not retain this video (${consumed.reason}).`,
          claimId,
          consumed.reason,
        );
      }
      videoUrl = reusableHostedUrl;
    } else {
      try {
        media = await downloadLoomVideo({
          loomId,
          shareUrl,
          expectedDurationMs: recording.durationMs,
          ...(storage.mode === "hosted"
            ? { maxBytes: storage.maxClipBytes }
            : {}),
        });
        console.log("[loom-import] download complete", {
          recordingId,
          bytes: media.sizeBytes,
          mimeType: media.mimeType,
        });
      } catch (err) {
        if (err instanceof LoomVideoUnavailableError) {
          console.warn(
            "[loom-import] MP4 unavailable or could not be verified; keeping Loom embed",
            {
              recordingId,
              loomId,
            },
          );
        } else {
          throw err;
        }
      }
      if (lease.failureReason) {
        return { status: "failed", failureReason: lease.failureReason };
      }

      upload = media
        ? storage.provider
          ? await storage.provider.upload({
              data: media.bytes,
              filename: `${recordingId}.mp4`,
              mimeType: media.mimeType,
              ownerEmail,
              stableUrl: true,
              recordAsset: false,
            })
          : await uploadFile({
              data: media.bytes,
              filename: `${recordingId}.mp4`,
              mimeType: media.mimeType,
              ownerEmail,
              stableUrl: true,
              recordAsset: false,
            })
        : null;
      if (media && !upload?.url) {
        // guard:allow-bare-error — invariant: the background job catch persists provider failures on the recording before returning.
        throw new Error(
          "File upload returned no URL. Check your storage provider configuration.",
        );
      }

      if (upload) {
        console.log("[loom-import] reupload complete", {
          recordingId,
          videoUrl: upload.url,
        });
        videoUrl = upload.url;
        videoSizeBytes = media?.sizeBytes ?? 0;
        videoFormat = media?.mimeType === "video/webm" ? "webm" : "mp4";

        if (storage.mode === "hosted") {
          const verifiedBytes = await verifyHostedClipMedia({
            recordingId,
            videoUrl,
          });
          if (
            verifiedBytes !== media?.sizeBytes ||
            verifiedBytes > storage.maxClipBytes
          ) {
            uploadSizeMismatch = true;
            // guard:allow-bare-error — invariant: the provider's verified object size must match the downloaded bytes before consumption.
            throw new Error(
              "Hosted Clips media size does not match the downloaded file.",
            );
          }
          videoSizeBytes = verifiedBytes;
          const [persisted] = await db
            .update(schema.recordings)
            .set({
              videoUrl,
              videoSizeBytes,
              videoFormat,
              updatedAt: new Date().toISOString(),
            })
            .where(
              and(
                eq(schema.recordings.id, recordingId),
                ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
                eq(schema.recordings.loomImportClaimId, claimId),
                eq(schema.recordings.status, "processing"),
                notTakenDown(),
              ),
            )
            .returning({ id: schema.recordings.id });
          if (!persisted) {
            throw new Error(LOOM_IMPORT_LEASE_LOST_REASON);
          }
          const consumed = await consumeHostedClipRecording({
            recordingId,
            ownerEmail,
            actualBytes: verifiedBytes,
          });
          if (!consumed.ok) {
            return await failLoomImport(
              recordingId,
              `Hosted Clips storage could not retain this video (${consumed.reason}).`,
              claimId,
              consumed.reason,
            );
          }
        }
      }
      if (!upload) usingLoomEmbed = true;

      await lease.stop();
      if (lease.failureReason) {
        return { status: "failed", failureReason: lease.failureReason };
      }

      if (usingLoomEmbed) {
        videoUrl = loomEmbedUrlForId(loomId);
        if (storage.mode === "hosted") {
          const [cleared] = await db
            .update(schema.recordings)
            .set({ storageMode: null, videoUrl, videoSizeBytes: 0 })
            .where(
              and(
                eq(schema.recordings.id, recordingId),
                ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
                eq(schema.recordings.loomImportClaimId, claimId),
                eq(schema.recordings.status, "processing"),
                notTakenDown(),
              ),
            )
            .returning({ id: schema.recordings.id });
          if (!cleared) {
            throw new Error(LOOM_IMPORT_LEASE_LOST_REASON);
          }
          resolvedStorageMode = null;
          await releaseHostedClipRecording({ recordingId, ownerEmail });
        }
      }
    }

    const now = new Date().toISOString();
    const [mediaReady] = await db
      .update(schema.recordings)
      .set({
        videoUrl,
        videoSizeBytes,
        videoFormat,
        storageMode: resolvedStorageMode,
        status: "ready",
        failureReason: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.recordings.id, recordingId),
          ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
          eq(schema.recordings.loomImportClaimId, claimId),
          eq(schema.recordings.status, "processing"),
          notTakenDown(),
        ),
      )
      .returning({ id: schema.recordings.id });
    if (!mediaReady) {
      console.warn("[loom-import] lease lost before ready", {
        recordingId,
        claimId,
      });
      return { status: "failed", failureReason: LOOM_IMPORT_LEASE_LOST_REASON };
    }
    console.log("[loom-import] recording ready", { recordingId });

    if (media && upload) {
      const thumbnail = await ensureRecordingThumbnail({
        recordingId,
        ownerEmail,
        mediaBytes: media.bytes,
        mimeType: media.mimeType,
        replaceNonEditorThumbnail: true,
      }).catch((err) => {
        console.warn("[clips] Loom thumbnail generation skipped", {
          recordingId,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      });
      if (thumbnail?.status === "skipped-frame-extraction") {
        console.warn("[clips] Loom thumbnail frame extraction skipped", {
          recordingId,
          detail: thumbnail.detail,
        });
      }
      if (!thumbnail || isRetryableRecordingThumbnailStatus(thumbnail.status)) {
        await dispatchPostFinalizeJob({
          recordingId,
          kind: "thumbnail",
          requireAccepted: true,
        }).catch((err) => {
          console.warn("[clips] Loom thumbnail retry queue failed", {
            recordingId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    }

    if (media && upload) {
      void queueBuilderMediaCompression({
        recordingId,
        ownerEmail,
        videoUrl: upload.url,
        mimeType: media.mimeType,
        providerId: upload.provider,
        assetDbId: upload.id,
        sourceSizeBytes: media.sizeBytes,
      }).catch((err) => {
        console.warn("[clips] Loom media compression queue failed", {
          recordingId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    try {
      let transcript: Awaited<ReturnType<typeof fetchLoomTranscript>> = null;
      try {
        transcript = await fetchLoomTranscript({
          shareUrl,
          durationMs: recording.durationMs,
        });
      } catch (err) {
        console.warn(
          `[clips] Loom transcript import skipped for ${loomId}:`,
          err instanceof Error ? err.message : String(err),
        );
      }

      const transcriptValues = {
        ownerEmail,
        language: transcript?.language ?? "en",
        segmentsJson: transcript ? JSON.stringify(transcript.segments) : "[]",
        fullText: transcript?.fullText ?? "",
        status: transcript ? ("ready" as const) : ("failed" as const),
        failureReason: transcript ? null : loomTranscriptUnavailableMessage(),
        updatedAt: now,
      };
      const [existingTranscript] = await db
        .select({ recordingId: schema.recordingTranscripts.recordingId })
        .from(schema.recordingTranscripts)
        .where(eq(schema.recordingTranscripts.recordingId, recordingId));
      if (existingTranscript) {
        await db
          .update(schema.recordingTranscripts)
          .set(transcriptValues)
          .where(eq(schema.recordingTranscripts.recordingId, recordingId));
      } else {
        await db.insert(schema.recordingTranscripts).values({
          recordingId,
          ...transcriptValues,
          createdAt: now,
        });
      }
    } catch (err) {
      console.warn("[clips] Loom transcript persistence skipped", {
        recordingId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      await enqueueFirstImportEmailIfEligible(
        { recordingId, ownerEmail, createdAt: recording.createdAt },
        db,
      );
    } catch (err) {
      console.warn("[clips] First-import email enqueue failed", {
        recordingId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      await writeAppState(`recording-upload-${recordingId}`, {
        recordingId,
        status: "ready",
        progress: 100,
        videoUrl,
        updatedAt: now,
      });
      await writeAppState("refresh-signal", { ts: Date.now() });
    } catch (err) {
      console.warn("[clips] Loom ready state update skipped", {
        recordingId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      await db
        .update(schema.recordings)
        .set({ loomImportClaimId: null, loomImportClaimedAt: null })
        .where(
          and(
            eq(schema.recordings.id, recordingId),
            ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
            eq(schema.recordings.loomImportClaimId, claimId),
          ),
        );
    } catch (err) {
      console.warn("[clips] Loom import lease release failed", {
        recordingId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return { status: "ready" };
  } catch (err) {
    await lease.stop();
    const linked = await linkUnlinkedHostedUpload();
    if (!linked) {
      await cleanupUnlinkedHostedUploadAfterTakedown();
    }
    if (lease.failureReason) {
      return { status: "failed", failureReason: lease.failureReason };
    }
    // Only a confirmed size mismatch marks the object unusable; a transient read
    // failure leaves a complete upload the retry may still reuse and re-verify.
    return failLoomImport(
      recordingId,
      err instanceof Error ? err.message : String(err),
      claimId,
      linked && uploadSizeMismatch
        ? "media_verification_failed"
        : "loom_import_failed",
    );
  } finally {
    await lease.stop();
  }
}
