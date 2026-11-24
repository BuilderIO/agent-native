import { listYouTubeChannelVideos, type YouTubeVideo } from "../../youtube.js";
import { youtubeConfigFingerprint } from "../config.js";
import { ContentStepStop, type ContentStep } from "../step.js";
import type { ContentItemInput, ContentSnapshotInput } from "../store.js";
import { utcDate } from "./daily-metrics.js";

export const YOUTUBE_METRICS = {
  views: "youtube_views",
  likes: "youtube_likes",
  comments: "youtube_comments",
} as const;

const MAX_VIDEOS = 10_000;

export function youtubeVideoItem(video: YouTubeVideo): ContentItemInput {
  return {
    source: "youtube",
    externalId: video.id,
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`,
    title: video.title,
    author: video.channelTitle,
    authors: [video.channelTitle],
    publishedAt: video.publishedAt,
    metadata: {
      channelId: video.channelId,
      durationSeconds: video.durationSeconds,
    },
  };
}

export const youtubeStep: ContentStep = {
  id: "youtube",
  async run({ collection, now, signal }) {
    const channels = collection.config.youtube.channels;
    if (channels.length === 0) {
      throw new ContentStepStop({
        status: "not_configured",
        errorCode: "youtube_channels_not_configured",
        errorMessage:
          "Name the YouTube channels to collect with configure-content-collection's youtubeChannels.",
      });
    }
    const result = await listYouTubeChannelVideos(channels, {
      maxVideos: MAX_VIDEOS,
      ...(signal ? { signal } : {}),
    });
    const readDate = utcDate(now);
    const snapshots: ContentSnapshotInput[] = [];
    for (const video of result.videos) {
      const counts = {
        [YOUTUBE_METRICS.views]: video.viewCount,
        [YOUTUBE_METRICS.likes]: video.likeCount,
        [YOUTUBE_METRICS.comments]: video.commentCount,
      };
      for (const [metric, value] of Object.entries(counts)) {
        if (value === null) continue;
        snapshots.push({
          itemSource: "youtube",
          itemExternalId: video.id,
          metricDate: readDate,
          metric,
          value,
        });
      }
    }
    return {
      items: result.videos.map(youtubeVideoItem),
      snapshots,
      outcome: {
        rowCount: snapshots.length,
        windowStart: readDate,
        windowEnd: readDate,
        configFingerprint: youtubeConfigFingerprint(channels),
        detail: `${result.videos.length} videos from ${result.channels
          .map((channel) => channel.title)
          .join(", ")}.`,
      },
    };
  },
};
