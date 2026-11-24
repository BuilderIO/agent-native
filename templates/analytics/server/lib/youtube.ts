import { resolveCredential } from "./credentials";
import { requireRequestCredentialContext } from "./credentials-context";

const API_BASE = "https://www.googleapis.com/youtube/v3";
export const YOUTUBE_PAGE_SIZE = 50;

export type YouTubeChannel = {
  id: string;
  title: string;
  uploadsPlaylistId: string;
};

export type YouTubeVideo = {
  id: string;
  channelId: string;
  channelTitle: string;
  title: string;
  publishedAt: string;
  durationSeconds: number | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
};

function youtubeError(message: string, errorCode: string, statusCode?: number) {
  return Object.assign(new Error(message), {
    errorCode,
    ...(statusCode ? { statusCode } : {}),
  });
}

async function apiKey(): Promise<string> {
  const ctx = requireRequestCredentialContext("YOUTUBE_API_KEY");
  const key = await resolveCredential("YOUTUBE_API_KEY", ctx);
  if (!key) {
    throw youtubeError(
      "No YouTube Data API key is saved. Add one under Data Sources → YouTube.",
      "youtube_api_key_missing",
      424,
    );
  }
  return key;
}

async function get<T>(
  key: string,
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  const url = new URL(`${API_BASE}/${path}`);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  url.searchParams.set("key", key);
  const res = await fetch(url, signal ? { signal } : {});
  if (res.ok) return (await res.json()) as T;
  // coercion-ok: an error body that isn't JSON still throws youtube_request_failed below.
  const body = (await res.json().catch(() => null)) as {
    error?: {
      message?: string;
      errors?: Array<{ reason?: string }>;
      details?: Array<{ reason?: string }>;
    };
  } | null;
  const reasons = new Set(
    [...(body?.error?.errors ?? []), ...(body?.error?.details ?? [])].map(
      (entry) => entry.reason ?? "",
    ),
  );
  const detail = body?.error?.message ?? `HTTP ${res.status}`;
  if (reasons.has("quotaExceeded") || reasons.has("dailyLimitExceeded")) {
    throw youtubeError(
      `The YouTube Data API key is over its daily quota: ${detail}`,
      "youtube_quota_exceeded",
    );
  }
  if (
    res.status === 403 ||
    reasons.has("API_KEY_INVALID") ||
    reasons.has("keyInvalid") ||
    reasons.has("keyExpired")
  ) {
    throw youtubeError(
      `YouTube refused the saved API key. Check that it is valid and that the YouTube Data API v3 is enabled on its Google Cloud project: ${detail}`,
      "youtube_api_key_rejected",
    );
  }
  throw youtubeError(
    `YouTube Data API ${path} returned ${res.status}: ${detail}`,
    "youtube_request_failed",
  );
}

export function durationSeconds(value: string | undefined): number | null {
  const parts = value?.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/,
  );
  if (!parts || value === "P" || value?.endsWith("T")) return null;
  const [days = "0", hours = "0", minutes = "0", seconds = "0"] =
    parts.slice(1);
  const total =
    ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 +
    Number(seconds);
  return total > 0 ? total : null;
}

function count(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  return Number(value);
}

export async function listYouTubeChannelVideos(
  channels: string[],
  options: { maxVideos: number; signal?: AbortSignal },
): Promise<{ channels: YouTubeChannel[]; videos: YouTubeVideo[] }> {
  const key = await apiKey();
  const signal = options.signal;
  const found: YouTubeChannel[] = [];
  const videos: YouTubeVideo[] = [];
  let listed = 0;
  for (const channel of channels) {
    const lookup: Record<string, string> = channel.startsWith("@")
      ? { forHandle: channel }
      : { id: channel };
    const response = await get<{
      items?: Array<{
        id: string;
        snippet?: { title?: string };
        contentDetails?: { relatedPlaylists?: { uploads?: string } };
      }>;
    }>(key, "channels", { part: "snippet,contentDetails", ...lookup }, signal);
    const item = response.items?.[0];
    const uploadsPlaylistId = item?.contentDetails?.relatedPlaylists?.uploads;
    if (!item || !uploadsPlaylistId) {
      throw youtubeError(
        `YouTube has no channel ${channel}. Check the collection's YouTube channels.`,
        "youtube_channel_not_found",
      );
    }
    if (found.some((known) => known.id === item.id)) continue;
    const resolved = {
      id: item.id,
      title: item.snippet?.title ?? channel,
      uploadsPlaylistId,
    };
    found.push(resolved);

    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const page = await get<{
        nextPageToken?: string;
        items?: Array<{ contentDetails?: { videoId?: string } }>;
      }>(
        key,
        "playlistItems",
        {
          part: "contentDetails",
          playlistId: uploadsPlaylistId,
          maxResults: String(YOUTUBE_PAGE_SIZE),
          ...(pageToken ? { pageToken } : {}),
        },
        signal,
      );
      for (const entry of page.items ?? []) {
        if (entry.contentDetails?.videoId) {
          ids.push(entry.contentDetails.videoId);
        }
      }
      if (listed + ids.length > options.maxVideos) {
        throw youtubeError(
          `The collection's YouTube channels have more than ${options.maxVideos} uploads in all; refusing a partial video list.`,
          "youtube_too_many_videos",
        );
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    listed += ids.length;

    for (let start = 0; start < ids.length; start += YOUTUBE_PAGE_SIZE) {
      const batch = ids.slice(start, start + YOUTUBE_PAGE_SIZE);
      const page = await get<{
        items?: Array<{
          id: string;
          snippet?: {
            channelId?: string;
            channelTitle?: string;
            title?: string;
            publishedAt?: string;
          };
          contentDetails?: { duration?: string };
          statistics?: {
            viewCount?: string;
            likeCount?: string;
            commentCount?: string;
          };
        }>;
      }>(
        key,
        "videos",
        { part: "snippet,contentDetails,statistics", id: batch.join(",") },
        signal,
      );
      for (const video of page.items ?? []) {
        if (!video.snippet?.publishedAt) continue;
        videos.push({
          id: video.id,
          channelId: video.snippet.channelId ?? resolved.id,
          channelTitle: video.snippet.channelTitle ?? resolved.title,
          title: video.snippet.title ?? video.id,
          publishedAt: video.snippet.publishedAt,
          durationSeconds: durationSeconds(video.contentDetails?.duration),
          viewCount: count(video.statistics?.viewCount),
          likeCount: count(video.statistics?.likeCount),
          commentCount: count(video.statistics?.commentCount),
        });
      }
    }
  }
  return { channels: found, videos };
}

export async function testYouTubeApiKey(key: string): Promise<void> {
  await get(key, "videoCategories", { part: "id", regionCode: "US" });
}
