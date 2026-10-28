import {
  BUILDER_ASSETS_WRITE_SCOPE,
  resolveBuilderRequestAuthorization,
} from "@agent-native/core/server";
import { track } from "@agent-native/core/tracking";

import { isImageRecording } from "../../shared/recording-kind.js";
import { subtractHostedClipRetainedBytes } from "./hosted-clip-allowance.js";
import {
  deleteS3ObjectByUrl,
  isUrlInS3Storage,
  s3ObjectSizeBytesByUrl,
} from "./s3-upload-provider.js";
import { screenshotLeftoverUrls } from "./screenshot-edits.js";

interface RecordingMediaUrls {
  id?: string;
  storageMode?: "own" | "hosted" | null;
  videoUrl?: string | null;
  thumbnailUrl?: string | null;
  animatedThumbnailUrl?: string | null;
  filmstripUrl?: string | null;
  /** A screenshot's served picture and its unmarked base. */
  imageUrl?: string | null;
  baseImageUrl?: string | null;
  /** Lists a screenshot's replaced files that are still to be deleted. */
  editsJson?: string | null;
  kind?: string | null;
}

export interface RecordingMediaCleanupResult {
  attempted: number;
  deleted: number;
  skipped: number;
  /** Hosted recordings only: URLs outside the bucket, which are not ours to delete. */
  external: number;
  errors: Array<{ url: string; error: string }>;
}

interface RecordingMediaCleanupOptions {
  protectedUrls?: Iterable<string>;
}

/**
 * Nothing else points at these, so if the row goes without them they stay in
 * storage for good — and they are the unredacted originals. Unreadable edits
 * are refused rather than read as "none".
 */
function screenshotLeftovers(recording: RecordingMediaUrls): string[] {
  if (!isImageRecording(recording)) return [];
  const leftovers = screenshotLeftoverUrls(recording.editsJson);
  if (!leftovers) {
    throw new Error(
      "This screenshot's saved edits could not be read, so the files it replaced cannot be found to delete. Nothing was deleted.",
    );
  }
  return leftovers;
}

export function recordingMediaUrls(recording: RecordingMediaUrls): string[] {
  const urls = [
    recording.videoUrl,
    recording.thumbnailUrl,
    recording.animatedThumbnailUrl,
    recording.filmstripUrl,
    recording.imageUrl,
    recording.baseImageUrl,
    ...screenshotLeftovers(recording),
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
    // A redaction waits on this; a provider that never answers must not
    // hold the save open until the platform kills it.
    signal: AbortSignal.timeout(15_000),
  });

  if (res.ok) return "deleted";
  if (res.status === 404) {
    // The URL as stored, since that is what serves the bytes; a throwaway
    // query keeps a CDN edge from answering with the copy it cached before
    // the delete. A probe that fails either way leaves it "not gone".
    const probeUrl = new URL(url);
    probeUrl.searchParams.set("deleted-check", String(Date.now()));
    probeUrl.hash = "";
    const probe = await fetch(probeUrl.toString(), {
      method: "HEAD",
      signal: AbortSignal.timeout(5_000),
    });
    return probe.status === 404 || probe.status === 410 ? "absent" : false;
  }

  const text = await res.text().catch(() => "");
  throw new Error(
    `Builder.io asset delete failed (${res.status}): ${text || res.statusText}`,
  );
}

/**
 * The object is gone but the ledger still holds its bytes, and nothing retries
 * the subtraction, so the over-count has to be visible to someone.
 */
function reportHostedByteAccountingFailure(
  recordingId: string,
  reason:
    | "size_unreadable"
    | "ledger_update_failed"
    | "superseded_delete_unconfirmed",
  error: unknown,
): void {
  console.error("[clips] hosted retained bytes not reduced after delete", {
    recordingId,
    reason,
    error: error instanceof Error ? error.message : String(error),
  });
  try {
    track("clips_hosted_byte_accounting_failed", {
      app_name: "clips",
      template_name: "clips",
      recording_id: recordingId,
      reason,
    });
  } catch {
    // coercion-ok: analytics is best-effort; the error log above already carries the failure.
  }
}

/**
 * Deletes one hosted object and, once the provider confirms, lowers the
 * recording's retained bytes by what it held. An object whose size cannot be
 * read is still deleted and leaves the ledger high: bytes over-counted until
 * the clip is removed beat bytes under-counted against the global cap. Either
 * accounting failure is reported, since the deletion result stays `true`.
 */
async function deleteHostedMediaObject(
  url: string,
  recordingId: string | undefined,
): Promise<boolean> {
  let sizeBytes: number | null = null;
  let sizeError: unknown = null;
  if (recordingId) {
    try {
      sizeBytes = await s3ObjectSizeBytesByUrl(url, {
        recordingId,
        storageMode: "hosted",
      });
    } catch (error) {
      sizeError = error;
    }
  }
  const deleted = await deleteS3ObjectByUrl(url, {
    storageMode: "hosted",
    recordingId,
  });
  if (deleted && recordingId) {
    if (sizeError) {
      reportHostedByteAccountingFailure(
        recordingId,
        "size_unreadable",
        sizeError,
      );
    } else if (sizeBytes) {
      try {
        await subtractHostedClipRetainedBytes({
          recordingId,
          deletedBytes: sizeBytes,
        });
      } catch (error) {
        reportHostedByteAccountingFailure(
          recordingId,
          "ledger_update_failed",
          error,
        );
      }
    }
  }
  return deleted;
}

/**
 * Removes the hosted object a successful swap just replaced, so it neither
 * lingers in the bucket nor stays in the retained-byte ledger: once the row
 * points at the new URL, permanent delete can no longer find the old one. The
 * user's action already succeeded, so a delete that fails or goes unconfirmed
 * is reported, not thrown. URLs outside the bucket are not ours to delete.
 * With no `replacementUrl` it removes an upload that never became referenced.
 */
export async function deleteSupersededHostedMedia(
  previousUrl: string | null | undefined,
  options: { recordingId: string; replacementUrl?: string },
): Promise<void> {
  if (!previousUrl || previousUrl === options.replacementUrl) return;
  try {
    if (
      (await isUrlInS3Storage(previousUrl, { storageMode: "hosted" })) === false
    ) {
      return;
    }
    if (await deleteHostedMediaObject(previousUrl, options.recordingId)) return;
    reportHostedByteAccountingFailure(
      options.recordingId,
      "superseded_delete_unconfirmed",
      new Error("The provider did not confirm deleting the superseded object."),
    );
  } catch (error) {
    reportHostedByteAccountingFailure(
      options.recordingId,
      "superseded_delete_unconfirmed",
      error,
    );
  }
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
export async function deleteStoredMediaUrl(
  url: string,
  options: {
    storageMode?: "own" | "hosted" | null;
    recordingId?: string;
  } = {},
): Promise<boolean> {
  if (!url || url.startsWith("data:")) return false;
  if (options.storageMode === "hosted") {
    return deleteHostedMediaObject(url, options.recordingId);
  }
  const deletedFromS3 = await deleteS3ObjectByUrl(url);
  if (deletedFromS3) {
    return true;
  }
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
    external: 0,
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
      if (recording.storageMode === "hosted") {
        if (
          (await isUrlInS3Storage(url, { storageMode: "hosted" })) === false
        ) {
          result.external += 1;
          continue;
        }
        const deleted = await deleteHostedMediaObject(url, recording.id);
        if (deleted) {
          result.deleted += 1;
        } else {
          result.skipped += 1;
        }
        continue;
      }
      const deletedFromS3 = await deleteS3ObjectByUrl(url);
      if (deletedFromS3 || (await deleteBuilderAssetByUrl(url)) === "deleted") {
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
