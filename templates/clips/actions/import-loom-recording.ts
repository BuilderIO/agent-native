import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  nanoid,
  requireOrganizationAccess,
  stringifySpaceIds,
} from "../server/lib/recordings.js";
import {
  extractLoomEmbedUrlFromHtml,
  extractLoomVideoId,
  loomEmbedUrlForId,
  normalizeLoomShareUrl,
} from "@shared/loom.js";
import {
  fetchLoomTranscript,
  loomTranscriptUnavailableMessage,
} from "./lib/loom-transcript.js";
import { localRecordingVideoRoute } from "../server/lib/player-video-url.js";

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
});

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
    "Import a public Loom share URL into Clips as a playable recording. Creates a ready recording that uses Loom's embedded player, thumbnail, title, duration metadata, and a public Loom transcript when available. Loom imports are embed-backed; upload the original video file instead when Clips-native editing or upload-based transcription is required.",
  schema: ImportLoomRecordingSchema,
  run: async (args) => {
    const shareUrl = normalizeLoomShareUrl(args.url);
    const loomId = extractLoomVideoId(args.url);
    if (!shareUrl || !loomId) {
      throw new Error("Paste a Loom share or embed URL.");
    }

    const oembed = await fetchLoomOembed(shareUrl);
    const embedUrl =
      extractLoomEmbedUrlFromHtml(oembed.html) ?? loomEmbedUrlForId(loomId);
    const now = new Date().toISOString();
    const id = nanoid();
    const videoUrl = localRecordingVideoRoute(id);
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const { organizationId } = await requireOrganizationAccess(
      args.organizationId,
    );
    const spaceIds = (args.spaceIds ?? []).filter(
      (value, index, arr) => value && arr.indexOf(value) === index,
    );
    const title =
      args.title?.trim() ||
      oembed.title?.trim() ||
      `Loom recording ${loomId.slice(0, 8)}`;
    const durationMs = boundedDurationMs(oembed.duration);

    await db.insert(schema.recordings).values({
      id,
      organizationId,
      orgId: organizationId,
      folderId: args.folderId ?? null,
      spaceIds: stringifySpaceIds(spaceIds),
      title,
      titleSource: args.title ? "manual" : "upload",
      sourceAppName: "Loom",
      sourceWindowTitle: shareUrl,
      description: "",
      thumbnailUrl: oembed.thumbnail_url ?? null,
      durationMs,
      videoUrl,
      videoFormat: "mp4",
      videoSizeBytes: 0,
      width: boundedDimension(oembed.width ?? oembed.thumbnail_width),
      height: boundedDimension(oembed.height ?? oembed.thumbnail_height),
      hasAudio: true,
      hasCamera: false,
      status: "ready",
      uploadProgress: 100,
      visibility: args.visibility ?? "public",
      ownerEmail,
      createdAt: now,
      updatedAt: now,
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

    await db.insert(schema.recordingTranscripts).values({
      recordingId: id,
      ownerEmail,
      language: transcript?.language ?? "en",
      segmentsJson: transcript ? JSON.stringify(transcript.segments) : "[]",
      fullText: transcript?.fullText ?? "",
      status: transcript ? "ready" : "failed",
      failureReason: transcript ? null : loomTranscriptUnavailableMessage(),
      createdAt: now,
      updatedAt: now,
    });

    await writeAppState("refresh-signal", { ts: Date.now() });
    await writeAppState("navigate", { view: "recording", recordingId: id });

    return {
      recordingId: id,
      title,
      status: "ready" as const,
      provider: "loom" as const,
      sourceUrl: shareUrl,
      embedUrl: videoUrl,
      thumbnailUrl: oembed.thumbnail_url ?? null,
      durationMs,
      transcriptStatus: transcript
        ? ("ready" as const)
        : ("unavailable" as const),
      note: transcript
        ? "Imported as a Loom embed with Loom's public transcript. Upload the original video file when Clips-native editing or upload-based transcription is required."
        : "Imported as a Loom embed. Loom did not expose an importable transcript; upload the original video file when Clips-native editing or transcription is required.",
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
