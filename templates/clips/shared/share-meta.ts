import {
  AGENT_NATIVE_SOCIAL_IMAGE_ALT,
  AGENT_NATIVE_SOCIAL_IMAGE_HEIGHT,
  AGENT_NATIVE_SOCIAL_IMAGE_TYPE,
  AGENT_NATIVE_SOCIAL_IMAGE_WIDTH,
  type SocialMetaDescriptor,
} from "@agent-native/core/shared";

export const CLIPS_DEFAULT_TITLE = "Untitled recording";

export type ClipsShareMetaRecording = {
  title?: string | null;
  description?: string | null;
  thumbnailUrl?: string | null;
  animatedThumbnailUrl?: string | null;
};

export function hasGeneratedTitle(title: string | null | undefined): boolean {
  const trimmed = (title ?? "").trim();
  return Boolean(trimmed && trimmed !== CLIPS_DEFAULT_TITLE);
}

export function clipsSharePageTitle(title: string | null | undefined): string {
  return hasGeneratedTitle(title)
    ? `${title!.trim()} · Clips`
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
  return (
    recording?.thumbnailUrl || recording?.animatedThumbnailUrl || undefined
  );
}

function absoluteUrl(value: string, origin: string | null): string {
  if (!origin) return value;
  try {
    return new URL(value, origin).toString();
  } catch {
    return value;
  }
}

export function buildClipsShareMeta(options: {
  recording: ClipsShareMetaRecording | null;
  origin?: string | null;
  shareUrl?: string | null;
}): SocialMetaDescriptor[] {
  const { recording, origin = null, shareUrl = null } = options;
  const title = clipsSharePageTitle(recording?.title);
  const description = clipsShareDescription(recording);
  const image = preferredSocialImage(recording);
  const absoluteImage = image ? absoluteUrl(image, origin) : undefined;
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
