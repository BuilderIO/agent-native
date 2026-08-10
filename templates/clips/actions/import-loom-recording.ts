import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import { uploadFile } from "@agent-native/core/file-upload";
import { buildDeepLink } from "@agent-native/core/server";
import { extractLoomVideoId, normalizeLoomShareUrl } from "@shared/loom.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { queueBuilderMediaCompression } from "../server/lib/builder-media-compression.js";
import { dispatchPostFinalizeJob } from "../server/lib/post-finalize-dispatch.js";
import {
  getCurrentOwnerEmail,
  getDefaultRecordingVisibility,
  nanoid,
  ownerEmailMatches,
  parseSpaceIds,
  requireOrganizationAccess,
  stringifySpaceIds,
} from "../server/lib/recordings.js";
import { hasRequestVideoStorage } from "../server/lib/video-storage.js";
import {
  downloadDirectVideo,
  isCandidateDirectVideoUrl,
} from "./lib/direct-video.js";
import {
  enqueueFirstImportEmailIfEligible,
  failLoomImport,
} from "./lib/loom-import-job.js";

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

const LOOM_STORAGE_SETUP_REQUIRED_REASON =
  "Video storage is not connected yet. Connect Builder.io (free tier available) or configure S3-compatible storage, then retry this Loom import.";
const DIRECT_VIDEO_STORAGE_SETUP_REQUIRED_REASON =
  "Video storage is not connected yet. Connect Builder.io (free tier available) or configure S3-compatible storage, then retry this import.";

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
    "Import a public Loom share URL, or a direct link to a video file, into Clips as a playable recording. Loom links create the recording immediately and download/reupload Loom's public MP4 plus import Loom's public transcript in the background, since Loom's CDN plus a reupload can take longer than a single request should block on. Other direct video links (e.g. an MP4/WebM/MOV hosted by another screen recorder) are downloaded and reuploaded synchronously without transcript metadata — use request-transcript afterward. If storage is not connected, creates a waiting recording that can be retried after storage setup.",
  schema: ImportLoomRecordingSchema,
  run: async (args) => {
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
      if (
        existingRecording.sourceAppName?.trim().toLowerCase() !==
        sourceAppName.toLowerCase()
      ) {
        throw new Error(
          "Only a matching waiting import can be retried this way.",
        );
      }
      const isWaitingStorageRetry =
        existingRecording.status === "uploading" &&
        !existingRecording.videoUrl &&
        existingRecording.failureReason === storageSetupReason &&
        existingRecording.sourceWindowTitle === sourceUrl;
      const isRetryableLoomImport =
        isLoom &&
        !existingRecording.videoUrl &&
        existingRecording.sourceWindowTitle === sourceUrl &&
        (existingRecording.status === "processing" ||
          existingRecording.status === "failed" ||
          isWaitingStorageRetry);
      const isRetryable = isLoom
        ? isRetryableLoomImport
        : isWaitingStorageRetry;
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
    const defaultVisibility =
      await getDefaultRecordingVisibility(organizationId);

    const now = new Date().toISOString();
    const id = existingRecording?.id ?? nanoid();
    const createdAt = existingRecording?.createdAt ?? now;
    const oembed = isLoom ? await fetchLoomOembed(loomShareUrl!) : null;

    const spaceIds = (
      args.spaceIds ?? parseSpaceIds(existingRecording?.spaceIds)
    ).filter((value, index, arr) => value && arr.indexOf(value) === index);
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
      args.visibility ?? existingRecording?.visibility ?? defaultVisibility;
    const titleSource = args.title
      ? "manual"
      : (existingRecording?.titleSource ?? "upload");

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
      sourceAppName,
      sourceWindowTitle: sourceUrl,
      description: existingRecording?.description ?? "",
      thumbnailUrl:
        oembed?.thumbnail_url ?? existingRecording?.thumbnailUrl ?? null,
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
        await db
          .update(schema.recordings)
          .set({
            ...recordingValues,
            status: "uploading",
            videoUrl: null,
            failureReason: storageSetupReason,
            loomImportClaimId: null,
            loomImportClaimedAt: null,
          })
          .where(eq(schema.recordings.id, id));
      } else {
        await db.insert(schema.recordings).values({
          id,
          ...recordingValues,
          videoUrl: null,
          status: "uploading",
          failureReason: storageSetupReason,
          ownerEmail,
          createdAt,
        });
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
      await writeAppState("navigate", { view: "recording", recordingId: id });

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

    if (!(await hasRequestVideoStorage())) {
      return await saveWaitingForStorage(
        existingRecording?.videoSizeBytes ?? 0,
      );
    }

    if (isLoom) {
      // Storage is connected: create/refresh the row now and hand the slow
      // Loom download + reupload + transcript off to a durable background
      // job (post-finalize-worker.post.ts's "loom-import" kind /
      // runLoomImportJob). Loom's CDN plus a reupload can outlast a single
      // request; the worker claims the row (loomImportClaimId) and moves it
      // to "ready" or "failed" once done.
      const recordingValues = buildRecordingValues(
        existingRecording?.videoSizeBytes ?? 0,
      );
      if (existingRecording) {
        await db
          .update(schema.recordings)
          .set({
            ...recordingValues,
            status: "processing",
            videoUrl: null,
            failureReason: null,
            loomImportClaimId: null,
            loomImportClaimedAt: null,
          })
          .where(eq(schema.recordings.id, id));
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
      await writeAppState("navigate", { view: "recording", recordingId: id });

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

    // Direct video links stay synchronous: they typically download and
    // reupload well within a single request, and this keeps
    // request-transcript as the deliberate next step for a transcript.
    const media = await downloadDirectVideo(sourceUrl);
    const videoFormat = media.mimeType === "video/webm" ? "webm" : "mp4";
    const upload = await uploadFile({
      data: media.bytes,
      filename: `${id}.${videoFormat}`,
      mimeType: media.mimeType,
      ownerEmail,
      stableUrl: true,
      recordAsset: false,
    });

    if (upload === null) {
      return await saveWaitingForStorage(media.sizeBytes);
    }
    if (!upload?.url) {
      throw new Error(
        "File upload returned no URL. Check your storage provider configuration.",
      );
    }

    const videoUrl = upload.url;
    const recordingValues = buildRecordingValues(media.sizeBytes, videoFormat);
    if (existingRecording) {
      await db
        .update(schema.recordings)
        .set({
          ...recordingValues,
          status: "ready",
          videoUrl,
          failureReason: null,
          loomImportClaimId: null,
          loomImportClaimedAt: null,
        })
        .where(eq(schema.recordings.id, id));
    } else {
      await db.insert(schema.recordings).values({
        id,
        ...recordingValues,
        videoUrl,
        status: "ready",
        failureReason: null,
        ownerEmail,
        createdAt,
      });
    }

    void queueBuilderMediaCompression({
      recordingId: id,
      ownerEmail,
      videoUrl,
      mimeType: media.mimeType,
      providerId: upload.provider,
      assetDbId: upload.id,
      sourceSizeBytes: media.sizeBytes,
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
    await writeAppState("navigate", { view: "recording", recordingId: id });

    return {
      recordingId: id,
      title,
      status: "ready" as const,
      provider: providerId,
      sourceUrl,
      videoUrl,
      embedUrl: videoUrl,
      thumbnailUrl: oembed?.thumbnail_url ?? null,
      durationMs,
      importMode: "reuploaded" as const,
      storageProvider: upload.provider,
      videoSizeBytes: media.sizeBytes,
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
