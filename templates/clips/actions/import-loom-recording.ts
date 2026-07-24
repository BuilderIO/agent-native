import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import { uploadFile } from "@agent-native/core/file-upload";
import { buildDeepLink } from "@agent-native/core/server";
import { extractLoomVideoId, normalizeLoomShareUrl } from "@shared/loom.js";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { queueBuilderMediaCompression } from "../server/lib/builder-media-compression.js";
import {
  getCurrentOwnerEmail,
  getOrganizationDefaultVisibility,
  nanoid,
  ownerEmailMatches,
  parseSpaceIds,
  requireOrganizationAccess,
  stringifySpaceIds,
} from "../server/lib/recordings.js";
import { transactionalEmailStore } from "../server/lib/transactional-email-store.js";
import { hasRequestVideoStorage } from "../server/lib/video-storage.js";
import {
  downloadDirectVideo,
  isCandidateDirectVideoUrl,
} from "./lib/direct-video.js";
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
      "Loom share/embed URL, or a direct link to a video file (mp4/webm/mov/m4v)",
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
  "Video storage is not connected yet. Connect Builder.io or configure S3-compatible storage, then retry this Loom import.";
const DIRECT_VIDEO_STORAGE_SETUP_REQUIRED_REASON =
  "Video storage is not connected yet. Connect Builder.io or configure S3-compatible storage, then retry this import.";

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

  await transactionalEmailStore.enqueue(
    `first-import:${input.ownerEmail.trim().toLowerCase()}`,
    {
      type: "first-import",
      recipient: input.ownerEmail,
      recordingIds: [input.recordingId],
      requestedBy: input.ownerEmail,
    },
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
    "Import a public Loom share URL, or a direct link to a video file, into Clips as a playable recording. Loom links download Loom's public MP4 and import Loom's public transcript when available. Other direct video links (e.g. an MP4/WebM/MOV hosted by another screen recorder) are downloaded and reuploaded without transcript metadata — use request-transcript afterward. If storage is not connected, creates a waiting recording that can be retried after storage setup.",
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
      if (!isWaitingStorageRetry) {
        throw new Error(
          "Only a waiting-storage import can be retried in place.",
        );
      }
    }

    const { organizationId } = await requireOrganizationAccess(
      existingRecording?.organizationId ?? args.organizationId,
    );
    const defaultVisibility =
      await getOrganizationDefaultVisibility(organizationId);

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

    const buildRecordingValues = (videoSizeBytes: number) => ({
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
            failureReason: storageSetupReason,
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

    const media = isLoom
      ? await downloadLoomVideo({ loomId: loomId!, shareUrl: loomShareUrl! })
      : await downloadDirectVideo(sourceUrl);
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

    let transcript: Awaited<ReturnType<typeof fetchLoomTranscript>> = null;
    if (isLoom) {
      try {
        transcript = await fetchLoomTranscript({
          shareUrl: loomShareUrl!,
          durationMs,
        });
      } catch (err) {
        console.warn(
          `[clips] Loom transcript import skipped for ${loomId}:`,
          (err as Error)?.message ?? String(err),
        );
      }
    }

    const transcriptValues = {
      ownerEmail,
      language: transcript?.language ?? "en",
      segmentsJson: transcript ? JSON.stringify(transcript.segments) : "[]",
      fullText: transcript?.fullText ?? "",
      status: transcript ? ("ready" as const) : ("failed" as const),
      failureReason: transcript
        ? null
        : isLoom
          ? loomTranscriptUnavailableMessage()
          : "Transcript import isn't available for direct video links yet. Use request-transcript to transcribe the uploaded media.",
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
      transcriptStatus: transcript
        ? ("ready" as const)
        : ("unavailable" as const),
      importMode: "reuploaded" as const,
      storageProvider: upload.provider,
      videoSizeBytes: media.sizeBytes,
      note:
        transcript && isLoom
          ? "Imported as a Clips-hosted MP4 with Loom's public transcript."
          : isLoom
            ? "Imported as a Clips-hosted MP4. Loom did not expose an importable transcript; use request-transcript to transcribe the uploaded media."
            : "Imported as a Clips-hosted MP4. Use request-transcript to transcribe the uploaded media.",
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
