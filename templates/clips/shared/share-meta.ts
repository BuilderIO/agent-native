import {
  AGENT_NATIVE_SOCIAL_IMAGE_ALT,
  AGENT_NATIVE_SOCIAL_IMAGE_HEIGHT,
  AGENT_NATIVE_SOCIAL_IMAGE_TYPE,
  AGENT_NATIVE_SOCIAL_IMAGE_WIDTH,
  isHumanReadableDocumentTitle,
  normalizeDocumentTitle,
  type SocialMetaDescriptor,
} from "@agent-native/core/shared";

import { buildAgentApiUrls } from "./agent-context";

export const CLIPS_DEFAULT_TITLE = "Untitled recording";

export type ClipsShareMetaRecording = {
  id?: string | null;
  title?: string | null;
  description?: string | null;
  thumbnailUrl?: string | null;
  animatedThumbnailUrl?: string | null;
  visibility?: string | null;
  status?: string | null;
  archivedAt?: string | null;
  trashedAt?: string | null;
};

const SOCIAL_FRAME_AT_MS = 350;

export type PreferredThumbnailVariant = "still" | "animated";

export function preferredThumbnailVariant(
  recording: Pick<
    ClipsShareMetaRecording,
    "thumbnailUrl" | "animatedThumbnailUrl"
  > | null,
): PreferredThumbnailVariant | null {
  if (recording?.thumbnailUrl?.trim()) return "still";
  if (recording?.animatedThumbnailUrl?.trim()) return "animated";
  return null;
}

export function hasGeneratedTitle(title: string | null | undefined): boolean {
  const trimmed = (title ?? "").trim();
  return Boolean(
    isHumanReadableDocumentTitle(trimmed) && trimmed !== CLIPS_DEFAULT_TITLE,
  );
}

export function clipsSharePageTitle(title: string | null | undefined): string {
  const safeTitle = normalizeDocumentTitle(title, CLIPS_DEFAULT_TITLE);
  return hasGeneratedTitle(safeTitle)
    ? `${safeTitle} · Clips`
    : "Clip recording · Clips";
}

export function displayRecordingTitle(
  title: string | null | undefined,
): string {
  return hasGeneratedTitle(title) ? (title ?? "").trim() : "Untitled Clip";
}

export function clipsShareDescription(
  recording: ClipsShareMetaRecording | null,
): string {
  const description = recording?.description?.trim();
  if (description) return description.slice(0, 160);
  if (hasGeneratedTitle(recording?.title)) {
    return `Watch "${recording!.title!.trim()}" on Clips.`;
  }
  return "Watch this screen recording on Clips.";
}

export function preferredSocialImage(
  recording: ClipsShareMetaRecording | null,
): string | undefined {
  const variant = preferredThumbnailVariant(recording);
  return variant === "still"
    ? recording?.thumbnailUrl?.trim()
    : variant === "animated"
      ? recording?.animatedThumbnailUrl?.trim()
      : undefined;
}

function absoluteUrl(value: string, origin: string | null): string {
  if (!origin) return value;
  try {
    return new URL(value, origin).toString();
  } catch {
    return value;
  }
}

function appPath(path: string, basePath: string): string {
  const normalizedBasePath = basePath.trim().replace(/\/+$/, "");
  return normalizedBasePath ? `${normalizedBasePath}${path}` : path;
}

function canUseGeneratedSocialFrame(
  recording: ClipsShareMetaRecording | null,
): recording is ClipsShareMetaRecording & {
  id: string;
  visibility: "public";
  status: "ready";
} {
  return Boolean(
    recording?.id &&
    recording.visibility === "public" &&
    recording.status === "ready" &&
    !recording.archivedAt &&
    !recording.trashedAt,
  );
}

export function resolveClipsSocialImageUrl(options: {
  recording: ClipsShareMetaRecording | null;
  origin?: string | null;
  basePath?: string;
}): string | undefined {
  const { recording, origin = null, basePath = "" } = options;
  const storedImage = preferredSocialImage(recording);

  if (storedImage) {
    if (recording?.id && recording.visibility === "public") {
      return absoluteUrl(
        appPath(`/api/thumbnail/${encodeURIComponent(recording.id)}`, basePath),
        origin,
      );
    }
    return absoluteUrl(storedImage, origin);
  }

  if (!origin || !canUseGeneratedSocialFrame(recording)) return undefined;

  return buildAgentApiUrls(recording.id, {
    origin,
    basePath,
  }).frameUrl(SOCIAL_FRAME_AT_MS);
}

export function buildClipsShareMeta(options: {
  recording: ClipsShareMetaRecording | null;
  origin?: string | null;
  basePath?: string;
  shareUrl?: string | null;
}): SocialMetaDescriptor[] {
  const { recording, origin = null, basePath = "", shareUrl = null } = options;
  const title = clipsSharePageTitle(recording?.title);
  const description = clipsShareDescription(recording);
  const absoluteImage = resolveClipsSocialImageUrl({
    recording,
    origin,
    basePath,
  });
  const alt = hasGeneratedTitle(recording?.title)
    ? recording!.title!.trim()
    : AGENT_NATIVE_SOCIAL_IMAGE_ALT;

  return [
    { title },
    { name: "description", content: description },
    ...(shareUrl ? [{ property: "og:url", content: shareUrl }] : []),
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "video.other" },
    ...(absoluteImage
      ? [
          { property: "og:image", content: absoluteImage },
          { property: "og:image:secure_url", content: absoluteImage },
          {
            property: "og:image:type",
            content: AGENT_NATIVE_SOCIAL_IMAGE_TYPE,
          },
          {
            property: "og:image:width",
            content: AGENT_NATIVE_SOCIAL_IMAGE_WIDTH,
          },
          {
            property: "og:image:height",
            content: AGENT_NATIVE_SOCIAL_IMAGE_HEIGHT,
          },
          { property: "og:image:alt", content: alt },
        ]
      : []),
    {
      name: "twitter:card",
      content: absoluteImage ? "summary_large_image" : "summary",
    },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    ...(absoluteImage
      ? [
          { name: "twitter:image", content: absoluteImage },
          { name: "twitter:image:alt", content: alt },
        ]
      : []),
  ];
}
