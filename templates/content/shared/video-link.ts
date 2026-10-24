import { isClipRecordingId } from "./clip-embed-block";

/**
 * What the video block's Link tab does with a pasted link. Content never
 * fetches the link from its server to decide: a Clips link is recognized by
 * its origin and route, a video page by its host, and anything else is
 * loaded by the reader's own browser. A file name proves nothing: a link
 * ending in .mp4 can still answer with a sign-in page.
 */
export type VideoLinkVerdict =
  | { kind: "clip"; recordingId: string }
  | { kind: "probe" }
  | {
      kind: "refused";
      reason: "invalid" | "clips-disabled" | "clips-page" | "video-page";
    };

export type ResolvedVideoLink =
  | { kind: "clip"; recordingId: string }
  | { kind: "video"; src: string }
  | {
      kind: "refused";
      reason:
        | "invalid"
        | "clips-disabled"
        | "clips-page"
        | "video-page"
        | "not-video";
    };

export interface VideoLinkOptions {
  /** App URLs of the Clips deployments whose links this Content can play. */
  clipsOrigins: readonly string[];
  clipsEnabled: boolean;
}

// Clips' recording routes: app/routes/_app.r.$recordingId.tsx,
// share.$shareId.tsx and embed.$shareId.tsx. A share id is the recording id.
const CLIPS_RECORDING_ROUTES = new Set(["r", "share", "embed"]);

// Hosts that serve their own player page rather than a video file, so a
// `<video>` element can never play their links.
const VIDEO_PAGE_HOSTS = [
  "youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "vimeo.com",
  "loom.com",
  "dailymotion.com",
  "twitch.tv",
  "tiktok.com",
  "wistia.com",
];

function parseHttpUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (!URL.canParse(trimmed)) return null;
  const url = new URL(trimmed);
  return url.protocol === "https:" || url.protocol === "http:" ? url : null;
}

function basePathOf(appUrl: URL): string {
  return appUrl.pathname.replace(/\/+$/, "");
}

/** The path below a Clips mount, or null when the link isn't on one. */
function clipsPathFor(
  url: URL,
  clipsOrigins: readonly string[],
): string | null {
  for (const origin of clipsOrigins) {
    const app = parseHttpUrl(origin);
    if (!app || app.origin !== url.origin) continue;
    const base = basePathOf(app);
    if (!base) return url.pathname;
    if (url.pathname === base || url.pathname.startsWith(`${base}/`)) {
      return url.pathname.slice(base.length) || "/";
    }
  }
  return null;
}

function recordingIdFromClipsPath(path: string): string | null {
  const segments = path.split("/").filter(Boolean);
  if (segments.length !== 2) return null;
  const [route, id] = segments;
  if (!CLIPS_RECORDING_ROUTES.has(route!)) return null;
  return isClipRecordingId(id) ? id : null;
}

function isVideoPageHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return VIDEO_PAGE_HOSTS.some(
    (page) => host === page || host.endsWith(`.${page}`),
  );
}

export function classifyVideoLink(
  input: string,
  options: VideoLinkOptions,
): VideoLinkVerdict {
  const url = parseHttpUrl(input);
  if (!url) return { kind: "refused", reason: "invalid" };

  const clipsPath = clipsPathFor(url, options.clipsOrigins);
  if (clipsPath !== null) {
    const recordingId = recordingIdFromClipsPath(clipsPath);
    if (!recordingId) return { kind: "refused", reason: "clips-page" };
    return options.clipsEnabled
      ? { kind: "clip", recordingId }
      : { kind: "refused", reason: "clips-disabled" };
  }

  if (isVideoPageHost(url.hostname)) {
    return { kind: "refused", reason: "video-page" };
  }
  return { kind: "probe" };
}

export async function resolveVideoLink(
  input: string,
  options: VideoLinkOptions & {
    /** Whether the reader's browser loads the link as a video. */
    probe: (src: string) => Promise<boolean>;
  },
): Promise<ResolvedVideoLink> {
  const verdict = classifyVideoLink(input, options);
  const src = input.trim();
  switch (verdict.kind) {
    case "clip":
    case "refused":
      return verdict;
    case "probe":
      return (await options.probe(src))
        ? { kind: "video", src }
        : { kind: "refused", reason: "not-video" };
  }
}
