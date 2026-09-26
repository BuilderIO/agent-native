import {
  BUILDER_ASSETS_WRITE_SCOPE,
  resolveBuilderRequestAuthorization,
} from "@agent-native/core/server";

import { deleteS3ObjectByUrl } from "./s3-upload-provider.js";

interface RecordingMediaUrls {
  id?: string;
  videoUrl?: string | null;
  thumbnailUrl?: string | null;
  animatedThumbnailUrl?: string | null;
  filmstripUrl?: string | null;
  /** A screenshot's served picture and its unmarked base. */
  imageUrl?: string | null;
  baseImageUrl?: string | null;
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
    recording.filmstripUrl,
    recording.imageUrl,
    recording.baseImageUrl,
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

/**
 * `"absent"` when the asset was already gone: a retry after a delete whose
 * response was lost. The DELETE's own 404 cannot say that — it is also what a
 * key without rights to the asset gets — so it only counts once the public
 * URL has stopped serving it too.
 */
async function deleteBuilderAssetByUrl(
  url: string,
): Promise<"deleted" | "absent" | false> {
  const assetUrl = builderAssetUrl(url);
  if (!assetUrl) return false;

  const authorization = await resolveBuilderRequestAuthorization({
    requiredScope: BUILDER_ASSETS_WRITE_SCOPE,
  });
  if (
    !authorization ||
    (authorization.source === "legacy" && !authorization.legacyPublicKey)
  ) {
    return false;
  }

  const deleteUrl = new URL("/api/v1/assets/by-url", "https://cdn.builder.io");
  deleteUrl.searchParams.set("url", assetUrl);
  if (authorization.legacyPublicKey) {
    deleteUrl.searchParams.set("apiKey", authorization.legacyPublicKey);
  }

  const res = await fetch(deleteUrl.toString(), {
    method: "DELETE",
    headers: {
      Authorization: authorization.authorization,
    },
  });

  if (res.ok) return "deleted";
  if (res.status === 404) {
    const probe = await fetch(assetUrl, { method: "HEAD" });
    return probe.status === 404 || probe.status === 410 ? "absent" : false;
  }

  const text = await res.text().catch(() => "");
  throw new Error(
    `Builder.io asset delete failed (${res.status}): ${text || res.statusText}`,
  );
}

/**
 * Delete exactly one stored media object.
 *
 * Redaction needs this: when a screenshot's blurred version replaces the
 * original, the original file has to leave storage, or the unblurred pixels
 * are still one URL away — which is the whole failure mode redaction exists to
 * prevent. Reports whether the object is actually gone so the caller can
 * refuse to claim a redaction that only half happened — including when it was
 * already gone, so a retry can finish.
 */
export async function deleteStoredMediaUrl(url: string): Promise<boolean> {
  if (!url || url.startsWith("data:")) return false;
  if (await deleteS3ObjectByUrl(url)) return true;
  return (await deleteBuilderAssetByUrl(url)) !== false;
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
        (await deleteBuilderAssetByUrl(url)) === "deleted"
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
