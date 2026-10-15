import { defineAction, fail } from "@agent-native/core/action";
import {
  writeAppState,
  writeAppStateForCurrentTab,
} from "@agent-native/core/application-state";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import { uploadFile } from "@agent-native/core/file-upload";
import { buildDeepLink } from "@agent-native/core/server";
import { extractLoomVideoId, normalizeLoomShareUrl } from "@shared/loom.js";
import { MAX_UPLOAD_BYTES } from "@shared/upload-limits.js";
import { and, eq, isNull, ne, or } from "drizzle-orm";
import { z } from "zod";

import { parseEdits } from "../app/lib/timestamp-mapping.js";
import { getDb, schema } from "../server/db/index.js";
import { queueBuilderMediaCompression } from "../server/lib/builder-media-compression.js";
import { dispatchPostFinalizeJob } from "../server/lib/post-finalize-dispatch.js";
import { trackRecordingCreated } from "../server/lib/recording-created.js";
import {
  getCurrentOwnerEmail,
  getDefaultRecordingVisibility,
  nanoid,
  ownerEmailMatches,
  parseSpaceIds,
  requireOrganizationAccess,
  stringifySpaceIds,
} from "../server/lib/recordings.js";
import { deleteS3ObjectByUrl } from "../server/lib/s3-upload-provider.js";
import {
  uploadLeaseExpiry,
  WAITING_STORAGE_EXPIRED_REASON,
  waitingStorageLeaseExpiry,
} from "../server/lib/upload-lease.js";
import {
  consumeHostedClipRecording,
  hasRequestVideoStorage,
  releaseHostedClipRecording,
  resolveClipsVideoStorage,
  STORAGE_SETUP_REQUIRED_REASON,
  verifyHostedClipMedia,
} from "../server/lib/video-storage.js";
import {
  downloadDirectVideo,
  isCandidateDirectVideoUrl,
} from "./lib/direct-video.js";
import {
  enqueueFirstImportEmailIfEligible,
  failLoomImport,
} from "./lib/loom-import-job.js";
import { validateRecordingScope } from "./lib/recording-scope.js";

export { enqueueFirstImportEmailIfEligible };

const LoomOembedSchema = z
  .object({
    type: z.literal("video"),
    html: z.string(),
    title: z.string().optional(),
    width: z.number().nullable().optional(),
    height: z.number().nullable().optional(),
    thumbnail_width: z.number().nullable().optional(),
    thumbnail_height: z.number().nullable().optional(),
    thumbnail_url: z.string().url().optional(),
    duration: z.number().nullable().optional(),
    provider_name: z.string().optional(),
  })
  .passthrough();

const ImportLoomRecordingSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .describe(
      "Loom share/embed URL, or a direct link to an MP4/WebM video file",
    ),
  title: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe(
      "Optional title override; defaults to Loom's oEmbed title when available",
    ),
  folderId: z.string().nullish().describe("Optional folder ID"),
  spaceIds: z
    .array(z.string().min(1))
    .nullish()
    .describe(
      "Space IDs the imported recording should belong to, used when importing from a space",
    ),
  organizationId: z
    .string()
    .optional()
    .describe(
      "Organization the recording belongs to; defaults to the caller's active org",
    ),
  visibility: z
    .enum(["private", "org", "public"])
    .optional()
    .describe("Initial share visibility for the recording"),
  recordingId: z
    .string()
    .optional()
    .describe(
      "Existing waiting recording ID to retry after storage is connected",
    ),
});

const LOOM_STORAGE_SETUP_REQUIRED_REASON = `${STORAGE_SETUP_REQUIRED_REASON} Then retry this Loom import.`;
const DIRECT_VIDEO_STORAGE_SETUP_REQUIRED_REASON = `${STORAGE_SETUP_REQUIRED_REASON} Then retry this import.`;
const TAKEN_DOWN_FAILURE_CODE = "taken_down";
const TAKEN_DOWN_REASON =
  "This recording was removed from hosted Clips storage.";

function notTakenDown() {
  return or(
    isNull(schema.recordings.failureCode),
    ne(schema.recordings.failureCode, TAKEN_DOWN_FAILURE_CODE),
  );
}

function storageDenialReason(reason: string | undefined): never {
  const denyReason = reason ?? "storage_setup_required";
  fail(
    `Hosted Clips storage is unavailable for this account (${denyReason}).`,
    {
      errorCode: denyReason,
      statusCode: denyReason === "exhausted" ? 402 : 403,
      details: { denyReason },
    },
  );
}

function recordingDeepLink(recordingId: string): string {
  return buildDeepLink({
    app: "clips",
    view: "recording",
    params: { recordingId },
    to: `/r/${encodeURIComponent(recordingId)}`,
  });
}

function boundedDimension(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 0;
  return Math.max(0, Math.min(16_384, Math.round(value ?? 0)));
}

function boundedDurationMs(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 0;
  return Math.max(
    0,
    Math.min(24 * 60 * 60 * 1000, Math.round((value ?? 0) * 1000)),
  );
}

async function fetchLoomOembed(shareUrl: string) {
  const endpoint = new URL("https://www.loom.com/v1/oembed");
  endpoint.searchParams.set("url", shareUrl);

  const res = await ssrfSafeFetch(
    endpoint.href,
    {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    },
    { maxRedirects: 2 },
  );
  if (!res.ok) {
    throw new Error(
      `Loom could not load that video (${res.status} ${res.statusText}). Make sure the link is viewable.`,
    );
  }

  const parsed = LoomOembedSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error("Loom returned an unexpected embed response.");
  }
  return parsed.data;
}

export default defineAction({
  description:
    "Import a public Loom share URL, or a direct link to a video file, into Clips as a playable recording. Loom links create the recording immediately and download/reupload Loom's public MP4 when available, or keep a playable Loom embed when Loom allows playback but not MP4 export; public transcripts are imported in the background. Other direct video links (e.g. an MP4/WebM/MOV hosted by another screen recorder) are downloaded and reuploaded synchronously without transcript metadata — use request-transcript afterward. If storage is not connected, creates a waiting recording that can be retried after storage setup.",
  schema: ImportLoomRecordingSchema,
  run: async (args, actionContext) => {
    const loomId = extractLoomVideoId(args.url);
    const isLoom = Boolean(loomId);
    const loomShareUrl = isLoom ? normalizeLoomShareUrl(args.url) : null;
    if (isLoom && !loomShareUrl) {
      throw new Error("Paste a Loom share or embed URL.");
    }
    if (!isLoom && !isCandidateDirectVideoUrl(args.url)) {
      throw new Error(
        "Paste a Loom share URL, or a direct link to a video file.",
      );
    }
    const sourceUrl = isLoom ? loomShareUrl! : args.url.trim();
    const sourceAppName = isLoom ? "Loom" : "Video link";
    const storageSetupReason = isLoom
      ? LOOM_STORAGE_SETUP_REQUIRED_REASON
      : DIRECT_VIDEO_STORAGE_SETUP_REQUIRED_REASON;
    const providerId = isLoom ? ("loom" as const) : ("video-link" as const);

    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    let existingRecording: typeof schema.recordings.$inferSelect | null = null;
    if (args.recordingId) {
      [existingRecording] = await db
        .select()
        .from(schema.recordings)
        .where(
          and(
            eq(schema.recordings.id, args.recordingId),
            ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
          ),
        );
      if (!existingRecording) {
        throw new Error("Waiting recording not found.");
      }
      if (existingRecording.failureCode === TAKEN_DOWN_FAILURE_CODE) {
        throw new Error(TAKEN_DOWN_REASON);
      }
      if (
        existingRecording.sourceAppName?.trim().toLowerCase() !==
        sourceAppName.toLowerCase()
      ) {
        throw new Error(
          "Only a matching waiting import can be retried this way.",
        );
      }
      // Still parked, or failed by the reaper once its waiting lease ran out:
      // the source URL is kept, so either retries in place.
      const isWaitingStorageRetry =
        !existingRecording.videoUrl &&
        existingRecording.sourceWindowTitle === sourceUrl &&
        ((existingRecording.status === "uploading" &&
          existingRecording.failureReason === storageSetupReason) ||
          (existingRecording.status === "failed" &&
            existingRecording.failureReason ===
              WAITING_STORAGE_EXPIRED_REASON));
      const isRetryableLoomImport =
        isLoom &&
        existingRecording.sourceWindowTitle === sourceUrl &&
        ((!existingRecording.videoUrl &&
          (existingRecording.status === "processing" ||
            existingRecording.status === "failed" ||
            isWaitingStorageRetry)) ||
          (existingRecording.status === "failed" &&
            existingRecording.storageMode === "hosted" &&
            Boolean(existingRecording.videoUrl)));
      const isRetryableHostedVideoLink =
        !isLoom &&
        existingRecording.status === "failed" &&
        existingRecording.storageMode === "hosted" &&
        existingRecording.sourceWindowTitle === sourceUrl;
      const isRetryable = isLoom
        ? isRetryableLoomImport
        : isWaitingStorageRetry || isRetryableHostedVideoLink;
      if (!isRetryable) {
        throw new Error(
          isLoom
            ? "Only an incomplete Loom import can be retried in place."
            : "Only a waiting-storage import can be retried in place.",
        );
      }
    }

    const { organizationId } = await requireOrganizationAccess(
      existingRecording?.organizationId ?? args.organizationId,
    );
    const now = new Date().toISOString();
    const id = existingRecording?.id ?? nanoid();
    const createdAt = existingRecording?.createdAt ?? now;
    const spaceIds = await validateRecordingScope(db, {
      organizationId,
      ownerEmail,
      spaceIds: args.spaceIds ?? parseSpaceIds(existingRecording?.spaceIds),
      folderId: args.folderId ?? existingRecording?.folderId,
    });
    const oembed = isLoom ? await fetchLoomOembed(loomShareUrl!) : null;
    const title =
      args.title?.trim() ||
      (existingRecording?.title &&
      existingRecording.title !== "Untitled recording"
        ? existingRecording.title
        : null) ||
      oembed?.title?.trim() ||
      (isLoom
        ? `Loom recording ${loomId!.slice(0, 8)}`
        : `Imported video ${id.slice(0, 8)}`);
    const durationMs = boundedDurationMs(oembed?.duration);
    const width = boundedDimension(oembed?.width ?? oembed?.thumbnail_width);
    const height = boundedDimension(oembed?.height ?? oembed?.thumbnail_height);
    const folderId = args.folderId ?? existingRecording?.folderId ?? null;
    const visibility =
      args.visibility ??
      existingRecording?.visibility ??
      (await getDefaultRecordingVisibility(
        organizationId,
        actionContext?.userEmail ?? ownerEmail,
      ));
    const titleSource = args.title
      ? "manual"
      : (existingRecording?.titleSource ?? "upload");
    const existingEditorThumbnail = Boolean(
      parseEdits(existingRecording?.editsJson).thumbnail,
    );
    const storage = await resolveClipsVideoStorage({
      intent: existingRecording ? "existing" : "new",
      recordingId: id,
      email: ownerEmail,
      requestHeaders: actionContext?.requestHeaders,
    });
    if (storage.mode === "none" && storage.denyReason !== "disabled") {
      storageDenialReason(storage.denyReason);
    }
    if (storage.mode === "hosted" && !storage.provider) {
      // guard:allow-bare-error — invariant: a hosted storage resolution always includes its server-side provider.
      throw new Error("Hosted Clips storage provider is unavailable.");
    }
    const ownStorageAvailable =
      storage.mode !== "own" ||
      Boolean(storage.provider) ||
      (await hasRequestVideoStorage());
    const storageMode =
      storage.mode === "none"
        ? (existingRecording?.storageMode ?? null)
        : storage.mode === "hosted" ||
            ownStorageAvailable ||
            existingRecording?.storageMode === "own"
          ? storage.mode === "hosted"
            ? "hosted"
            : "own"
          : null;
    const maxImportBytes =
      storage.mode === "hosted" ? storage.maxClipBytes : MAX_UPLOAD_BYTES;
    const releaseHostedReservation = async (force = false) => {
      if (
        storage.mode !== "hosted" ||
        (!force && storage.reservationCreated !== true)
      ) {
        return;
      }
      await releaseHostedClipRecording({
        recordingId: id,
        ownerEmail,
      });
    };
    const updateExistingRecording = async (values: Record<string, unknown>) => {
      const [updated] = await db
        .update(schema.recordings)
        .set(values)
        .where(and(eq(schema.recordings.id, id), notTakenDown()))
        .returning({ id: schema.recordings.id });
      if (!updated) throw new Error(TAKEN_DOWN_REASON);
    };

    // Each import path below inserts the row in exactly one branch.
    const trackImportedRowCreated = () =>
      trackRecordingCreated({
        recordingId: id,
        userId: ownerEmail,
        platform: "import",
        source: "import",
        hasAudio: true,
        hasCamera: false,
      });
    const buildRecordingValues = (
      videoSizeBytes: number,
      videoFormat: "mp4" | "webm" = "mp4",
    ) => ({
      organizationId,
      orgId: organizationId,
      folderId,
      spaceIds: stringifySpaceIds(spaceIds),
      title,
      titleSource,
      recordingPlatform: "import" as const,
      storageMode,
      failureCode: null,
      sourceAppName,
      sourceWindowTitle: sourceUrl,
      description: existingRecording?.description ?? "",
      thumbnailUrl:
        oembed?.thumbnail_url ??
        (existingEditorThumbnail ? existingRecording?.thumbnailUrl : null) ??
        null,
      durationMs,
      videoFormat,
      videoSizeBytes,
      width,
      height,
      hasAudio: true,
      hasCamera: false,
      uploadProgress: 100,
      visibility,
      updatedAt: now,
    });

    const saveWaitingForStorage = async (videoSizeBytes: number) => {
      const recordingValues = buildRecordingValues(videoSizeBytes);
      if (existingRecording) {
        await updateExistingRecording({
          ...recordingValues,
          status: "uploading",
          videoUrl: null,
          failureReason: storageSetupReason,
          uploadLeaseExpiresAt: waitingStorageLeaseExpiry(),
          loomImportClaimId: null,
          loomImportClaimedAt: null,
        });
      } else {
        await db.insert(schema.recordings).values({
          id,
          ...recordingValues,
          videoUrl: null,
          status: "uploading",
          failureReason: storageSetupReason,
          uploadLeaseExpiresAt: waitingStorageLeaseExpiry(),
          ownerEmail,
          createdAt,
        });
        trackImportedRowCreated();
      }

      await writeAppState(`recording-upload-${id}`, {
        recordingId: id,
        status: "waiting_storage",
        failureReason: storageSetupReason,
        progress: 100,
        provider: providerId,
        sourceUrl,
        durationMs,
        width,
        height,
        hasAudio: true,
        hasCamera: false,
        updatedAt: now,
      });
      await writeAppState("refresh-signal", { ts: Date.now() });
      await writeAppStateForCurrentTab("navigate", {
        view: "recording",
        recordingId: id,
      });

      return {
        recordingId: id,
        title,
        status: "waiting_storage" as const,
        storageSetupRequired: true,
        provider: providerId,
        sourceUrl,
        thumbnailUrl: oembed?.thumbnail_url ?? null,
        durationMs,
        importMode: "reuploaded" as const,
        videoSizeBytes,
        note: storageSetupReason,
      };
    };

    if (
      storage.mode === "none" ||
      (storage.mode === "own" && !ownStorageAvailable)
    ) {
      return await saveWaitingForStorage(
        existingRecording?.videoSizeBytes ?? 0,
      );
    }

    const failedHostedUrl =
      existingRecording?.status === "failed" &&
      existingRecording.storageMode === "hosted"
        ? existingRecording.videoUrl
        : null;
    // An object that failed verification against its download is never
    // promoted: delete it, then let the retry download and verify afresh.
    const staleUnverifiedUrl =
      existingRecording?.failureCode === "media_verification_failed"
        ? failedHostedUrl
        : null;
    const reusableHostedUrl = staleUnverifiedUrl ? null : failedHostedUrl;
    if (staleUnverifiedUrl) {
      const deleted = await deleteS3ObjectByUrl(staleUnverifiedUrl, {
        storageMode: "hosted",
        recordingId: id,
      });
      if (!deleted) {
        fail(
          "The earlier unverified upload for this import could not be deleted. Try again shortly.",
          { errorCode: "stale_hosted_media_cleanup_failed", statusCode: 502 },
        );
      }
    }

    if (isLoom) {
      const recordingValues = {
        ...buildRecordingValues(existingRecording?.videoSizeBytes ?? 0),
        uploadLeaseExpiresAt: uploadLeaseExpiry(),
      };
      try {
        if (existingRecording) {
          await updateExistingRecording({
            ...recordingValues,
            status: "processing",
            videoUrl: reusableHostedUrl,
            failureReason: null,
            loomImportClaimId: null,
            loomImportClaimedAt: null,
          });
        } else {
          await db.insert(schema.recordings).values({
            id,
            ...recordingValues,
            videoUrl: null,
            status: "processing",
            failureReason: null,
            ownerEmail,
            createdAt,
          });
          trackImportedRowCreated();
        }
      } catch (error) {
        await releaseHostedReservation();
        throw error;
      }

      await writeAppState(`recording-upload-${id}`, {
        recordingId: id,
        status: "processing",
        progress: 100,
        provider: providerId,
        sourceUrl,
        durationMs,
        width,
        height,
        hasAudio: true,
        hasCamera: false,
        updatedAt: now,
      });
      await writeAppState("refresh-signal", { ts: Date.now() });
      await writeAppStateForCurrentTab("navigate", {
        view: "recording",
        recordingId: id,
      });

      try {
        console.log("[import-loom-recording] dispatching loom-import job", {
          recordingId: id,
          provider: providerId,
        });
        await dispatchPostFinalizeJob({
          recordingId: id,
          kind: "loom-import",
          requireAccepted: true,
        });
        console.log("[import-loom-recording] loom-import job accepted", {
          recordingId: id,
        });
      } catch (err) {
        const failureReason = `Could not start the Loom import: ${
          err instanceof Error ? err.message : String(err)
        }`;
        await failLoomImport(id, failureReason);
        throw new Error(failureReason);
      }

      return {
        recordingId: id,
        title,
        status: "processing" as const,
        provider: providerId,
        sourceUrl,
        thumbnailUrl: oembed?.thumbnail_url ?? null,
        durationMs,
        importMode: "reuploaded" as const,
        note: "Downloading and importing this Loom recording in the background.",
      };
    }

    const initialValues = {
      ...buildRecordingValues(existingRecording?.videoSizeBytes ?? 0),
      uploadProgress: 0,
      uploadLeaseExpiresAt: uploadLeaseExpiry(),
    };
    try {
      if (existingRecording) {
        await updateExistingRecording({
          ...initialValues,
          status: "processing",
          videoUrl: reusableHostedUrl,
          failureReason: null,
          loomImportClaimId: null,
          loomImportClaimedAt: null,
        });
      } else {
        await db.insert(schema.recordings).values({
          id,
          ...initialValues,
          videoUrl: null,
          status: "processing",
          failureReason: null,
          ownerEmail,
          createdAt,
        });
        trackImportedRowCreated();
      }
    } catch (error) {
      await releaseHostedReservation();
      throw error;
    }

    let media: Awaited<ReturnType<typeof downloadDirectVideo>> | null = null;
    let upload: Awaited<ReturnType<typeof uploadFile>> = null;
    let videoUrl = reusableHostedUrl ?? "";
    let videoSizeBytes = existingRecording?.videoSizeBytes ?? 0;
    let videoFormat: "mp4" | "webm" =
      existingRecording?.videoFormat === "webm" ? "webm" : "mp4";
    let hostedVerifiedBytes: number | null = null;
    let uploadSizeMismatch = false;
    // Set before the provider is called: once true, an object or session may
    // exist, so the reservation is no longer certain to be unused.
    let uploadAttempted = false;
    try {
      if (reusableHostedUrl) {
        hostedVerifiedBytes = await verifyHostedClipMedia({
          recordingId: id,
          videoUrl: reusableHostedUrl,
        });
        videoSizeBytes = hostedVerifiedBytes;
        const consumed = await consumeHostedClipRecording({
          recordingId: id,
          ownerEmail,
          actualBytes: hostedVerifiedBytes,
        });
        if (!consumed.ok) {
          fail(
            "Hosted Clips storage is full. Connect Builder.io storage to keep saving clips.",
            {
              errorCode: consumed.reason,
              statusCode: 507,
              details: { denyReason: consumed.reason },
            },
          );
        }
      } else {
        media = await downloadDirectVideo(sourceUrl, {
          maxBytes: maxImportBytes,
        });
        videoSizeBytes = media.sizeBytes;
        videoFormat = media.mimeType === "video/webm" ? "webm" : "mp4";
        const uploadInput = {
          data: media.bytes,
          filename: `${id}.${videoFormat}`,
          mimeType: media.mimeType,
          ownerEmail,
          stableUrl: true,
          recordAsset: false,
        };
        uploadAttempted = true;
        upload = storage.provider
          ? await storage.provider.upload(uploadInput)
          : await uploadFile(uploadInput);

        if (upload === null) {
          return await saveWaitingForStorage(media.sizeBytes);
        }
        if (!upload.url) {
          fail(
            "File upload returned no URL. Check your storage provider configuration.",
            { errorCode: "file_upload_missing_url", statusCode: 502 },
          );
        }
        videoUrl = upload.url;

        if (storage.mode === "hosted") {
          hostedVerifiedBytes = await verifyHostedClipMedia({
            recordingId: id,
            videoUrl,
          });
          if (hostedVerifiedBytes !== media.sizeBytes) {
            uploadSizeMismatch = true;
            // guard:allow-bare-error — invariant: provider verification must match the exact downloaded object before it can be retained.
            throw new Error(
              "Hosted Clips media size does not match the downloaded file.",
            );
          }
          const consumed = await consumeHostedClipRecording({
            recordingId: id,
            ownerEmail,
            actualBytes: hostedVerifiedBytes,
          });
          if (!consumed.ok) {
            fail(
              "Hosted Clips storage is full. Connect Builder.io storage to keep saving clips.",
              {
                errorCode: consumed.reason,
                statusCode: 507,
                details: { denyReason: consumed.reason },
              },
            );
          }
        }
      }

      const recordingValues = buildRecordingValues(videoSizeBytes, videoFormat);
      const [completed] = await db
        .update(schema.recordings)
        .set({
          ...recordingValues,
          status: "ready",
          videoUrl,
          failureReason: null,
          loomImportClaimId: null,
          loomImportClaimedAt: null,
        })
        .where(
          and(
            eq(schema.recordings.id, id),
            eq(schema.recordings.status, "processing"),
            notTakenDown(),
          ),
        )
        .returning({ id: schema.recordings.id });
      if (!completed) throw new Error(TAKEN_DOWN_REASON);
    } catch (error) {
      let failureStorageMode = storageMode;
      let failureVideoUrl =
        storage.mode === "hosted" &&
        (hostedVerifiedBytes !== null || reusableHostedUrl !== null)
          ? videoUrl
          : null;
      let failureSizeBytes =
        storage.mode === "hosted" && reusableHostedUrl !== null
          ? (hostedVerifiedBytes ?? existingRecording?.videoSizeBytes ?? 0)
          : storage.mode === "hosted" && hostedVerifiedBytes !== null
            ? hostedVerifiedBytes
            : 0;

      if (
        storage.mode === "hosted" &&
        storage.reservationCreated === true &&
        reusableHostedUrl === null &&
        !uploadAttempted
      ) {
        try {
          await releaseHostedReservation();
          failureStorageMode = null;
        } catch (releaseError) {
          console.warn("[clips] Hosted import reservation release failed", {
            recordingId: id,
            error:
              releaseError instanceof Error
                ? releaseError.message
                : String(releaseError),
          });
        }
      } else if (
        storage.mode === "hosted" &&
        upload?.url &&
        hostedVerifiedBytes === null
      ) {
        let cleaned = false;
        try {
          cleaned = await deleteS3ObjectByUrl(upload.url, {
            storageMode: "hosted",
            recordingId: id,
          });
        } catch {
          cleaned = false;
        }
        // An unconfirmed delete must not drop the only handle: the reaper and
        // permanent delete find the object through the row's videoUrl.
        if (!cleaned) failureVideoUrl = upload.url;
        if (cleaned && storage.reservationCreated === true) {
          try {
            await releaseHostedReservation();
            failureStorageMode = null;
          } catch (releaseError) {
            console.warn("[clips] Hosted import reservation release failed", {
              recordingId: id,
              error:
                releaseError instanceof Error
                  ? releaseError.message
                  : String(releaseError),
            });
          }
        }
      }

      await db
        .update(schema.recordings)
        .set({
          status: "failed",
          failureCode: uploadSizeMismatch
            ? "media_verification_failed"
            : "video_link_import_failed",
          failureReason: error instanceof Error ? error.message : String(error),
          storageMode: failureStorageMode,
          videoUrl: failureVideoUrl,
          videoSizeBytes: failureSizeBytes,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(schema.recordings.id, id),
            eq(schema.recordings.status, "processing"),
            notTakenDown(),
          ),
        );
      throw error;
    }

    await dispatchPostFinalizeJob({
      recordingId: id,
      kind: "thumbnail",
      requireAccepted: true,
    });

    const videoMimeType =
      media?.mimeType ?? (videoFormat === "webm" ? "video/webm" : "video/mp4");
    const storageProviderId = upload?.provider ?? storage.provider?.id;
    void queueBuilderMediaCompression({
      recordingId: id,
      ownerEmail,
      videoUrl,
      mimeType: videoMimeType,
      providerId: storageProviderId,
      assetDbId: upload?.id,
      sourceSizeBytes: media?.sizeBytes ?? videoSizeBytes,
    }).catch((err) => {
      console.warn("[clips] Video import media compression queue failed", {
        recordingId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    const transcriptValues = {
      ownerEmail,
      language: "en",
      segmentsJson: "[]",
      fullText: "",
      status: "failed" as const,
      failureReason:
        "Transcript import isn't available for direct video links yet. Use request-transcript to transcribe the uploaded media.",
      updatedAt: now,
    };
    const [existingTranscript] = await db
      .select({ recordingId: schema.recordingTranscripts.recordingId })
      .from(schema.recordingTranscripts)
      .where(eq(schema.recordingTranscripts.recordingId, id));
    if (existingTranscript) {
      await db
        .update(schema.recordingTranscripts)
        .set(transcriptValues)
        .where(eq(schema.recordingTranscripts.recordingId, id));
    } else {
      await db.insert(schema.recordingTranscripts).values({
        recordingId: id,
        ...transcriptValues,
        createdAt: now,
      });
    }

    try {
      await enqueueFirstImportEmailIfEligible(
        { recordingId: id, ownerEmail, createdAt },
        db,
      );
    } catch (err) {
      console.warn("[clips] First-import email enqueue failed", {
        recordingId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await writeAppState(`recording-upload-${id}`, {
      recordingId: id,
      status: "ready",
      progress: 100,
      videoUrl,
      provider: providerId,
      sourceUrl,
      durationMs,
      width,
      height,
      hasAudio: true,
      hasCamera: false,
      updatedAt: now,
    });
    await writeAppState("refresh-signal", { ts: Date.now() });
    await writeAppStateForCurrentTab("navigate", {
      view: "recording",
      recordingId: id,
    });

    return {
      recordingId: id,
      title,
      status: "ready" as const,
      provider: providerId,
      sourceUrl,
      videoUrl,
      embedUrl: videoUrl,
      thumbnailUrl: buildRecordingValues(videoSizeBytes, videoFormat)
        .thumbnailUrl,
      durationMs,
      importMode: "reuploaded" as const,
      storageProvider: storageProviderId,
      videoSizeBytes,
      note: "Imported as a Clips-hosted video. Use request-transcript to transcribe the uploaded media.",
    };
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const recordingId = (result as { recordingId?: unknown }).recordingId;
    if (typeof recordingId !== "string") return null;
    return {
      url: recordingDeepLink(recordingId),
      label: "Open imported clip in Clips",
      view: "recording",
    };
  },
});
