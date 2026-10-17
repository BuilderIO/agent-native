import { fail } from "@agent-native/core/action";
import {
  writeAppState,
  writeAppStateForCurrentTab,
} from "@agent-native/core/application-state";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import {
  extractYouTubeVideoId,
  YOUTUBE_SOURCE_APP_NAME,
  youtubeEmbedUrl,
  youtubeWatchUrl,
} from "@shared/youtube.js";
import { z } from "zod";

import { getDb, schema } from "../../server/db/index.js";
import { trackRecordingCreated } from "../../server/lib/recording-created.js";
import {
  getCurrentOwnerEmail,
  getDefaultRecordingVisibility,
  nanoid,
  requireOrganizationAccess,
  stringifySpaceIds,
} from "../../server/lib/recordings.js";
import { validateRecordingScope } from "./recording-scope.js";

export const YOUTUBE_IMPORT_NOTE =
  "This clip plays in YouTube's embedded player. Clips stores no copy of the video, so there are no frames to extract and nothing to edit or transcribe. Add a transcript with import-transcript (YouTube's own transcript panel text works); comments, chapters and transcript highlighting follow YouTube's playback.";

const YouTubeOembedSchema = z
  .object({
    type: z.literal("video"),
    title: z.string().optional(),
    author_name: z.string().optional(),
    width: z.number().nullable().optional(),
    height: z.number().nullable().optional(),
    thumbnail_url: z.string().url().optional(),
  })
  .passthrough();

type YouTubeOembed = z.infer<typeof YouTubeOembedSchema>;

export type YouTubeImportArgs = {
  url: string;
  title?: string;
  folderId?: string | null;
  spaceIds?: string[] | null;
  organizationId?: string;
  visibility?: "private" | "org" | "public";
  recordingId?: string;
};

export async function fetchYouTubeOembed(
  watchUrl: string,
): Promise<YouTubeOembed> {
  const endpoint = new URL("https://www.youtube.com/oembed");
  endpoint.searchParams.set("url", watchUrl);
  endpoint.searchParams.set("format", "json");

  const res = await ssrfSafeFetch(
    endpoint.href,
    {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    },
    { maxRedirects: 2 },
  );
  if (res.status === 401 || res.status === 403) {
    fail(
      "This YouTube video is private or its owner doesn't allow playing it outside YouTube, so Clips can't embed it.",
      { errorCode: "youtube_embed_unavailable", statusCode: 422 },
    );
  }
  if (res.status === 400 || res.status === 404) {
    fail(
      "YouTube has no public video at that link. It may have been removed, or the link may be incomplete.",
      { errorCode: "youtube_video_not_found", statusCode: 404 },
    );
  }
  if (!res.ok) {
    fail(
      `YouTube didn't return the video's details (${res.status}). Try again in a moment.`,
      { errorCode: "youtube_unreachable", statusCode: 502 },
    );
  }

  const parsed = YouTubeOembedSchema.safeParse(await res.json());
  if (!parsed.success) {
    fail("YouTube returned an unexpected response for that video.", {
      errorCode: "youtube_unreachable",
      statusCode: 502,
    });
  }
  return parsed.data;
}

// oEmbed reports the default embed's size, not the video's, so only its
// shape is kept: a 16:9 video becomes 1280x720 and a Short 720x1280.
function playerDimensions(oembed: YouTubeOembed): {
  width: number;
  height: number;
} {
  const width = oembed.width ?? 0;
  const height = oembed.height ?? 0;
  if (!(width > 0 && height > 0)) return { width: 1280, height: 720 };
  return width >= height
    ? { width: 1280, height: Math.round((1280 * height) / width) }
    : { width: Math.round((1280 * width) / height), height: 1280 };
}

/**
 * Creates an embed-backed clip for a YouTube video. Only YouTube's public
 * oEmbed metadata is fetched: YouTube's terms don't allow downloading the
 * video, so it plays through YouTube's embedded player.
 */
export async function importYouTubeVideo(
  args: YouTubeImportArgs,
  actionContext: { userEmail?: string | null } | undefined,
) {
  const videoId = extractYouTubeVideoId(args.url);
  if (!videoId) {
    fail(
      "That YouTube link doesn't point to a video. Paste a watch, Shorts, or youtu.be link.",
      { errorCode: "youtube_url_invalid", statusCode: 400 },
    );
  }
  if (args.recordingId) {
    fail(
      "YouTube imports finish immediately, so there's nothing to retry. Import the link again instead.",
      { errorCode: "youtube_retry_unsupported", statusCode: 400 },
    );
  }

  const db = getDb();
  const ownerEmail = getCurrentOwnerEmail();
  const { organizationId } = await requireOrganizationAccess(
    args.organizationId,
  );
  const spaceIds = await validateRecordingScope(db, {
    organizationId,
    ownerEmail,
    spaceIds: args.spaceIds ?? [],
    folderId: args.folderId,
  });
  const sourceUrl = youtubeWatchUrl(videoId);
  const videoUrl = youtubeEmbedUrl(videoId);
  const oembed = await fetchYouTubeOembed(sourceUrl);
  const title =
    args.title?.trim() || oembed.title?.trim() || `YouTube video ${videoId}`;
  const { width, height } = playerDimensions(oembed);
  const visibility =
    args.visibility ??
    (await getDefaultRecordingVisibility(
      organizationId,
      actionContext?.userEmail ?? ownerEmail,
    ));
  const id = nanoid();
  const now = new Date().toISOString();
  const thumbnailUrl = oembed.thumbnail_url ?? null;

  await db.insert(schema.recordings).values({
    id,
    organizationId,
    orgId: organizationId,
    folderId: args.folderId ?? null,
    spaceIds: stringifySpaceIds(spaceIds),
    title,
    titleSource: args.title ? "manual" : "upload",
    recordingPlatform: "import",
    storageMode: null,
    failureCode: null,
    failureReason: null,
    sourceAppName: YOUTUBE_SOURCE_APP_NAME,
    sourceWindowTitle: sourceUrl,
    description: "",
    thumbnailUrl,
    // Only YouTube's player knows the length; the first editor to open the
    // clip records it (see set-embed-duration).
    durationMs: 0,
    videoUrl,
    videoFormat: "mp4",
    videoSizeBytes: 0,
    width,
    height,
    hasAudio: true,
    hasCamera: false,
    status: "ready",
    uploadProgress: 100,
    visibility,
    ownerEmail,
    createdAt: now,
    updatedAt: now,
  });
  trackRecordingCreated({
    recordingId: id,
    userId: ownerEmail,
    platform: "import",
    source: "import",
    hasAudio: true,
    hasCamera: false,
  });

  await writeAppState(`recording-upload-${id}`, {
    recordingId: id,
    status: "ready",
    progress: 100,
    videoUrl,
    provider: "youtube",
    sourceUrl,
    durationMs: 0,
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
    provider: "youtube" as const,
    sourceUrl,
    videoUrl,
    embedUrl: videoUrl,
    thumbnailUrl,
    durationMs: 0,
    importMode: "embed" as const,
    framesAvailable: false,
    note: YOUTUBE_IMPORT_NOTE,
  };
}
