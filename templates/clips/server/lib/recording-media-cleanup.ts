import { deleteS3ObjectByUrl } from "./s3-upload-provider.js";

interface RecordingMediaUrls {
  id: string;
  videoUrl?: string | null;
  thumbnailUrl?: string | null;
  animatedThumbnailUrl?: string | null;
}

export interface RecordingMediaCleanupResult {
  attempted: number;
  deleted: number;
  skipped: number;
  errors: Array<{ url: string; error: string }>;
}

function mediaUrlsForRecording(recording: RecordingMediaUrls): string[] {
  const urls = [
    recording.videoUrl,
    recording.thumbnailUrl,
    recording.animatedThumbnailUrl,
  ];
  return [...new Set(urls.filter((url): url is string => Boolean(url)))];
}

export async function deleteRecordingMediaObjects(
  recording: RecordingMediaUrls,
): Promise<RecordingMediaCleanupResult> {
  const result: RecordingMediaCleanupResult = {
    attempted: 0,
    deleted: 0,
    skipped: 0,
    errors: [],
  };

  for (const url of mediaUrlsForRecording(recording)) {
    result.attempted += 1;
    try {
      if (await deleteS3ObjectByUrl(url)) {
        result.deleted += 1;
      } else {
        result.skipped += 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push({ url, error: message });
      console.warn("[clips] failed to delete recording media object", {
        recordingId: recording.id,
        url,
        error: message,
      });
    }
  }

  return result;
}
