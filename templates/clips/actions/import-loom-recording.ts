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
import {
  getCurrentOwnerEmail,
  nanoid,
  ownerEmailMatches,
  parseSpaceIds,
  requireOrganizationAccess,
  stringifySpaceIds,
} from "../server/lib/recordings.js";
import { hasRequestVideoStorage } from "../server/lib/video-storage.js";
import {
  fetchLoomTranscript,
  loomTranscriptUnavailableMessage,
} from "./lib/loom-transcript.js";
import { downloadLoomVideo } from "./lib/loom-video.js";

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
      "Loom share or embed URL, such as https://www.loom.com/share/...",
    ),
  title: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe("Optional title override; defaults to Loom's oEmbed title"),
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
      "Existing waiting Loom recording ID to retry after storage is connected",
    ),
});

const LOOM_STORAGE_SETUP_REQUIRED_REASON =
  "Video storage is not connected yet. Connect Builder.io or configure S3-compatible storage, then retry this Loom import.";

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
    "Import a public Loom share URL into Clips as a playable recording. Downloads Loom's public MP4, reuploads it to the configured Clips storage provider, and imports Loom's public transcript when available. If storage is not connected, creates a waiting recording that can be retried after storage setup.",
  schema: ImportLoomRecordingSchema,
  run: async (args) => {
    const shareUrl = normalizeLoomShareUrl(args.url);
    const loomId = extractLoomVideoId(args.url);
    if (!shareUrl || !loomId) {
      throw new Error("Paste a Loom share or embed URL.");
    }

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
        throw new Error("Waiting Loom recording not found.");
      }
      if (existingRecording.sourceAppName?.trim().toLowerCase() !== "loom") {
        throw new Error("Only Loom recordings can be retried this way.");
      }
      const existingSourceUrl = normalizeLoomShareUrl(
        existingRecording.sourceWindowTitle ?? "",
      );
      const isWaitingStorageRetry =
        existingRecording.status === "uploading" &&
        !existingRecording.videoUrl &&
        existingRecording.failureReason ===
          LOOM_STORAGE_SETUP_REQUIRED_REASON &&
        existingSourceUrl === shareUrl;
      if (!isWaitingStorageRetry) {
        throw new Error(
          "Only a waiting-storage Loom import can be retried in place.",
        );
      }
    }

    const { organizationId } = await requireOrganizationAccess(
      existingRecording?.organizationId ?? args.organizationId,
    );

    const now = new Date().toISOString();
    const id = existingRecording?.id ?? nanoid();
    const oembed = await fetchLoomOembed(shareUrl);

    const spaceIds = (
      args.spaceIds ?? parseSpaceIds(existingRecording?.spaceIds)
    ).filter((value, index, arr) => value && arr.indexOf(value) === index);
    const title =
      args.title?.trim() ||
      (existingRecording?.title &&
      existingRecording.title !== "Untitled recording"
        ? existingRecording.title
        : null) ||
      oembed.title?.trim() ||
      `Loom recording ${loomId.slice(0, 8)}`;
    const durationMs = boundedDurationMs(oembed.duration);
    const width = boundedDimension(oembed.width ?? oembed.thumbnail_width);
    const height = boundedDimension(oembed.height ?? oembed.thumbnail_height);
    const folderId = args.folderId ?? existingRecording?.folderId ?? null;
    const visibility =
      args.visibility ?? existingRecording?.visibility ?? "public";
    const titleSource = args.title
      ? "manual"
      : (existingRecording?.titleSource ?? "upload");

    const buildRecordingValues = (videoSizeBytes: number) => ({
      organizationId,
      orgId: organizationId,
      folderId,
      spaceIds: stringifySpaceIds(spaceIds),
      title,
      titleSource,
      sourceAppName: "Loom",
      sourceWindowTitle: shareUrl,
      description: existingRecording?.description ?? "",
      thumbnailUrl:
        oembed.thumbnail_url ?? existingRecording?.thumbnailUrl ?? null,
      durationMs,
      videoFormat: "mp4" as const,
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
            failureReason: LOOM_STORAGE_SETUP_REQUIRED_REASON,
          })
          .where(eq(schema.recordings.id, id));
      } else {
        await db.insert(schema.recordings).values({
          id,
          ...recordingValues,
          videoUrl: null,
          status: "uploading",
          failureReason: LOOM_STORAGE_SETUP_REQUIRED_REASON,
          ownerEmail,
          createdAt: now,
        });
      }

      await writeAppState(`recording-upload-${id}`, {
        recordingId: id,
        status: "waiting_storage",
        failureReason: LOOM_STORAGE_SETUP_REQUIRED_REASON,
        progress: 100,
        provider: "loom",
        sourceUrl: shareUrl,
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
        provider: "loom" as const,
        sourceUrl: shareUrl,
        thumbnailUrl: oembed.thumbnail_url ?? null,
        durationMs,
        importMode: "reuploaded" as const,
        videoSizeBytes,
        note: LOOM_STORAGE_SETUP_REQUIRED_REASON,
      };
    };

    if (!(await hasRequestVideoStorage())) {
      return await saveWaitingForStorage(
        existingRecording?.videoSizeBytes ?? 0,
      );
    }

    const media = await downloadLoomVideo({ loomId, shareUrl });
    const upload = await uploadFile({
      data: media.bytes,
      filename: `${id}.mp4`,
      mimeType: media.mimeType,
      ownerEmail,
      stableUrl: true,
      recordAsset: false,
    });

    const recordingValues = buildRecordingValues(media.sizeBytes);
    if (upload === null) {
      return await saveWaitingForStorage(media.sizeBytes);
    }

    if (!upload?.url) {
      throw new Error(
        "File upload returned no URL. Check your storage provider configuration.",
      );
    }

    const videoUrl = upload.url;
    if (existingRecording) {
      await db
        .update(schema.recordings)
        .set({
          ...recordingValues,
          videoUrl,
          status: "ready",
          failureReason: null,
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
        createdAt: now,
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
      console.warn("[clips] Loom media compression queue failed", {
        recordingId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    let transcript: Awaited<ReturnType<typeof fetchLoomTranscript>> = null;
    try {
      transcript = await fetchLoomTranscript({ shareUrl, durationMs });
    } catch (err) {
      console.warn(
        `[clips] Loom transcript import skipped for ${loomId}:`,
        (err as Error)?.message ?? String(err),
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

    await writeAppState("refresh-signal", { ts: Date.now() });
    await writeAppState("navigate", { view: "recording", recordingId: id });

    return {
      recordingId: id,
      title,
      status: "ready" as const,
      provider: "loom" as const,
      sourceUrl: shareUrl,
      videoUrl,
      embedUrl: videoUrl,
      thumbnailUrl: oembed.thumbnail_url ?? null,
      durationMs,
      transcriptStatus: transcript
        ? ("ready" as const)
        : ("unavailable" as const),
      importMode: "reuploaded" as const,
      storageProvider: upload.provider,
      videoSizeBytes: media.sizeBytes,
      note: transcript
        ? "Imported as a Clips-hosted MP4 with Loom's public transcript."
        : "Imported as a Clips-hosted MP4. Loom did not expose an importable transcript; use request-transcript to transcribe the uploaded media.",
    };
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const recordingId = (result as { recordingId?: unknown }).recordingId;
    if (typeof recordingId !== "string") return null;
    return {
      url: recordingDeepLink(recordingId),
      label: "Open imported Loom clip in Clips",
      view: "recording",
    };
  },
});
