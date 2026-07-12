import { resolveBuilderCredentials } from "@agent-native/core/server";

import { deleteS3ObjectByUrl } from "./s3-upload-provider.js";

interface RecordingMediaUrls {
  id?: string;
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

interface RecordingMediaCleanupOptions {
  protectedUrls?: Iterable<string>;
}

export function recordingMediaUrls(recording: RecordingMediaUrls): string[] {
  const urls = [
    recording.videoUrl,
    recording.thumbnailUrl,
    recording.animatedThumbnailUrl,
  ];
  return [...new Set(urls.filter((url): url is string => Boolean(url)))];
}

function builderAssetUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "cdn.builder.io") return null;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

async function deleteBuilderAssetByUrl(url: string): Promise<boolean> {
  const assetUrl = builderAssetUrl(url);
  if (!assetUrl) return false;

  const credentials = await resolveBuilderCredentials();
  if (!credentials.privateKey || !credentials.publicKey) return false;

  const deleteUrl = new URL("/api/v1/assets/by-url", "https://cdn.builder.io");
  deleteUrl.searchParams.set("url", assetUrl);
  deleteUrl.searchParams.set("apiKey", credentials.publicKey);

  const res = await fetch(deleteUrl.toString(), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${credentials.privateKey}`,
    },
  });

  if (res.ok) return true;
  if (res.status === 404) return false;

  const text = await res.text().catch(() => "");
  throw new Error(
    `Builder.io asset delete failed (${res.status}): ${text || res.statusText}`,
  );
}

export async function deleteRecordingMediaObjects(
  recording: RecordingMediaUrls,
  options: RecordingMediaCleanupOptions = {},
): Promise<RecordingMediaCleanupResult> {
  const result: RecordingMediaCleanupResult = {
    attempted: 0,
    deleted: 0,
    skipped: 0,
    errors: [],
  };
  const protectedUrls = new Set(options.protectedUrls ?? []);

  for (const url of recordingMediaUrls(recording)) {
    result.attempted += 1;
    if (protectedUrls.has(url)) {
      result.skipped += 1;
      continue;
    }
    try {
      if (
        (await deleteS3ObjectByUrl(url)) ||
        (await deleteBuilderAssetByUrl(url))
      ) {
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
