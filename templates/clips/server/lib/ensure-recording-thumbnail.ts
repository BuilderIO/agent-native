import { randomUUID } from "node:crypto";

import {
  compareAndSetAppState,
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import {
  deleteUploadedFile,
  uploadFile,
  type FileUploadResult,
} from "@agent-native/core/file-upload";
import { and, eq, isNull, ne, or } from "drizzle-orm";

import { parseEdits } from "../../app/lib/timestamp-mapping.js";
import { isLoomEmbedBackedRecording } from "../../shared/loom.js";
import { getDb, schema } from "../db/index.js";
import {
  loadRecordingMediaBytes,
  type PublicAgentRecording,
} from "./public-agent-context.js";
import { ownerEmailMatches } from "./recordings.js";
import { extractJpegFrame, VideoFrameExtractionError } from "./video-frame.js";

export const RECORDING_THUMBNAIL_AT_MS = 350;

export type EnsureRecordingThumbnailStatus =
  | "generated"
  | "already-set"
  | "not-found"
  | "skipped-not-ready"
  | "skipped-no-media"
  | "skipped-loom-embed"
  | "skipped-media-fetch"
  | "skipped-frame-extraction"
  | "skipped-upload-failed"
  | "skipped-race"
  | "skipped-lease";

export function isRetryableRecordingThumbnailStatus(
  status: EnsureRecordingThumbnailStatus,
): boolean {
  return (
    status === "skipped-media-fetch" ||
    status === "skipped-frame-extraction" ||
    status === "skipped-upload-failed" ||
    status === "skipped-race" ||
    status === "skipped-lease"
  );
}

export interface EnsureRecordingThumbnailResult {
  recordingId: string;
  status: EnsureRecordingThumbnailStatus;
  changed: boolean;
  thumbnailUrl?: string | null;
  detail?: string;
}

type EnsureRecordingThumbnailParams = {
  recordingId: string;
  ownerEmail: string;
  mediaBytes?: Uint8Array;
  thumbnailBytes?: Uint8Array;
  mimeType?: string;
  thumbnailMimeType?: "image/jpeg" | "image/png";
  allowInlineFallback?: boolean;
  replaceNonEditorThumbnail?: boolean;
};

const RECORDING_THUMBNAIL_LEASE_MS = 5 * 60 * 1000;
const RECORDING_THUMBNAIL_LEASE_PREFIX = "recording-thumbnail-lease-";
const RECORDING_THUMBNAIL_ASSET_PREFIX = "recording-thumbnail-asset-";

type RecordingThumbnailLease = {
  key: string;
  token: string;
  expiresAt: number;
};

type GeneratedThumbnailAsset = {
  url: string;
  provider: string;
  id?: string;
};

function recordingThumbnailLeaseKey(recordingId: string): string {
  return `${RECORDING_THUMBNAIL_LEASE_PREFIX}${recordingId}`;
}

function recordingThumbnailAssetKey(recordingId: string): string {
  return `${RECORDING_THUMBNAIL_ASSET_PREFIX}${recordingId}`;
}

function hasActiveThumbnailLease(
  value: Record<string, unknown> | null,
  now: number,
): boolean {
  return (
    typeof value?.token === "string" &&
    typeof value.expiresAt === "number" &&
    value.expiresAt > now
  );
}

export async function claimRecordingThumbnailLease(
  recordingId: string,
): Promise<RecordingThumbnailLease | null> {
  const key = recordingThumbnailLeaseKey(recordingId);
  const previous = await readAppState(key);
  const now = Date.now();
  if (hasActiveThumbnailLease(previous, now)) return null;

  const lease = {
    token: randomUUID(),
    expiresAt: now + RECORDING_THUMBNAIL_LEASE_MS,
  };
  if (!(await compareAndSetAppState(key, previous, lease))) return null;
  return { key, token: lease.token, expiresAt: lease.expiresAt };
}

export async function releaseRecordingThumbnailLease(
  lease: RecordingThumbnailLease,
): Promise<void> {
  try {
    await compareAndSetAppState(
      lease.key,
      {
        token: lease.token,
        expiresAt: lease.expiresAt,
      },
      null,
    );
  } catch (error) {
    console.warn("[clips] recording thumbnail lease release failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ponytail: process-local single-flight plus a five-minute SQL lease keeps
// separate production isolates from decoding and uploading the same clip.
const inFlightThumbnailEnsures = new Map<
  string,
  Promise<EnsureRecordingThumbnailResult>
>();
function thumbnailEnsureKey(params: EnsureRecordingThumbnailParams): string {
  return JSON.stringify([params.ownerEmail.toLowerCase(), params.recordingId]);
}

function fallbackMimeType(videoFormat: string | null | undefined): string {
  return videoFormat === "mp4" ? "video/mp4" : "video/webm";
}

function normalizeMimeType(
  mimeType: string | null | undefined,
  videoFormat: string | null | undefined,
): string {
  const normalized = mimeType?.split(";")[0]?.trim().toLowerCase();
  return normalized?.startsWith("video/")
    ? (mimeType ?? fallbackMimeType(videoFormat))
    : fallbackMimeType(videoFormat);
}

async function extractThumbnailFrame(
  mediaBytes: Uint8Array,
  mimeType: string,
): Promise<Uint8Array> {
  try {
    return await extractJpegFrame({
      mediaBytes,
      mimeType,
      atMs: RECORDING_THUMBNAIL_AT_MS,
    });
  } catch (error) {
    if (
      !(error instanceof VideoFrameExtractionError) ||
      error.code !== "NO_VIDEO"
    ) {
      throw error;
    }

    return extractJpegFrame({
      mediaBytes,
      mimeType,
      atMs: 0,
    });
  }
}

async function loadRecording(
  recordingId: string,
  ownerEmail: string,
): Promise<PublicAgentRecording | null> {
  const [recording] = await getDb()
    .select()
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, recordingId),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
      ),
    );
  return recording ?? null;
}

async function loadGeneratedThumbnailAsset(
  recordingId: string,
): Promise<GeneratedThumbnailAsset | null> {
  let value: Record<string, unknown> | null;
  try {
    value = await readAppState(recordingThumbnailAssetKey(recordingId));
  } catch (error) {
    console.warn("[clips] generated recording thumbnail asset lookup failed", {
      recordingId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  if (typeof value?.url !== "string" || typeof value.provider !== "string") {
    return null;
  }
  return {
    url: value.url,
    provider: value.provider,
    ...(typeof value.id === "string" ? { id: value.id } : {}),
  };
}

async function rememberGeneratedThumbnailAsset(
  recordingId: string,
  asset: FileUploadResult,
): Promise<void> {
  await writeAppState(recordingThumbnailAssetKey(recordingId), {
    url: asset.url,
    provider: asset.provider,
    ...(asset.id ? { id: asset.id } : {}),
  }).catch((error) => {
    console.warn(
      "[clips] generated recording thumbnail asset tracking failed",
      {
        recordingId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  });
}

async function hasAnotherRecordingReference(
  recordingId: string,
  url: string,
  ownerEmail: string,
): Promise<boolean> {
  const [reference] = await getDb()
    .select({ id: schema.recordings.id })
    .from(schema.recordings)
    .where(
      and(
        ne(schema.recordings.id, recordingId),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
        or(
          eq(schema.recordings.videoUrl, url),
          eq(schema.recordings.thumbnailUrl, url),
          eq(schema.recordings.animatedThumbnailUrl, url),
          eq(schema.recordings.filmstripUrl, url),
        ),
      ),
    )
    .limit(1);
  return Boolean(reference);
}

async function cleanupReplacedGeneratedThumbnail(
  recordingId: string,
  ownerEmail: string,
  previousThumbnailUrl: string | null,
  nextThumbnailUrl: string,
): Promise<void> {
  if (!previousThumbnailUrl || previousThumbnailUrl === nextThumbnailUrl) {
    return;
  }

  const previousAsset = await loadGeneratedThumbnailAsset(recordingId);
  if (!previousAsset || previousAsset.url !== previousThumbnailUrl) return;

  try {
    if (
      await hasAnotherRecordingReference(
        recordingId,
        previousAsset.url,
        ownerEmail,
      )
    ) {
      return;
    }
    const deleted = await deleteUploadedFile(previousAsset.provider, {
      url: previousAsset.url,
      ...(previousAsset.id ? { id: previousAsset.id } : {}),
    });
    if (!deleted) {
      console.warn("[clips] replaced recording thumbnail cleanup unavailable", {
        recordingId,
        provider: previousAsset.provider,
      });
    }
  } catch (error) {
    console.warn("[clips] replaced recording thumbnail cleanup failed", {
      recordingId,
      provider: previousAsset.provider,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function cleanupUnreferencedThumbnail(
  uploaded: FileUploadResult,
  recordingId: string,
  ownerEmail: string,
): Promise<PublicAgentRecording | null | undefined> {
  const current = await loadRecording(recordingId, ownerEmail).catch(
    (error) => {
      console.warn(
        "[clips] generated recording thumbnail cleanup skipped because the recording could not be re-read",
        {
          recordingId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return undefined;
    },
  );
  if (current === undefined || current?.thumbnailUrl === uploaded.url) {
    return current;
  }

  try {
    const deleted = await deleteUploadedFile(uploaded.provider, {
      url: uploaded.url,
      ...(uploaded.id ? { id: uploaded.id } : {}),
    });
    if (!deleted) {
      console.warn(
        "[clips] generated recording thumbnail cleanup unavailable",
        {
          recordingId,
          provider: uploaded.provider,
        },
      );
    }
  } catch (error) {
    console.warn("[clips] generated recording thumbnail cleanup failed", {
      recordingId,
      provider: uploaded.provider,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return current;
}

/**
 * Best-effort terminal-status write, independent of the compare-and-set
 * thumbnail update above: a recording with no video (or a Loom-embed-backed
 * recording, which has no local media) will never get a generated thumbnail,
 * so mark it 'none' rather than leaving thumbnail_status stuck at 'pending'
 * forever for the sweeper to keep retrying. Logged and swallowed — this is
 * observability, not the operation the caller asked for.
 */
async function setThumbnailStatus(
  recordingId: string,
  status: "none" | "failed",
  reason: string,
): Promise<void> {
  try {
    await getDb()
      .update(schema.recordings)
      .set({
        thumbnailStatus: status,
        thumbnailFailureReason: reason.slice(0, 300),
      })
      .where(eq(schema.recordings.id, recordingId));
  } catch (error) {
    console.warn("[clips] recording thumbnail status persist failed", {
      recordingId,
      status,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Called by the post-finalize worker once thumbnail retries are exhausted. */
export function markThumbnailFailed(
  recordingId: string,
  reason: string,
): Promise<void> {
  return setThumbnailStatus(recordingId, "failed", reason);
}

/**
 * Persist one still thumbnail when the upload path did not already provide
 * one. Supplied frames can arrive before the recording is ready; generated
 * frames wait for playable media. The update is compare-and-set so a user or
 * another upload cannot be overwritten while frame extraction runs.
 */
async function ensureRecordingThumbnailOnce(
  params: EnsureRecordingThumbnailParams,
): Promise<EnsureRecordingThumbnailResult> {
  const {
    recordingId,
    ownerEmail,
    mediaBytes: suppliedBytes,
    thumbnailBytes: suppliedThumbnail,
  } = params;
  const recording = await loadRecording(recordingId, ownerEmail);

  if (!recording) return { recordingId, status: "not-found", changed: false };

  const existingThumbnailUrl = recording.thumbnailUrl?.trim() || null;
  const suppliedThumbnailBytes = suppliedThumbnail?.byteLength
    ? suppliedThumbnail
    : undefined;
  const hasEditorThumbnail = Boolean(parseEdits(recording.editsJson).thumbnail);
  const replaceExisting = Boolean(
    params.replaceNonEditorThumbnail &&
    existingThumbnailUrl &&
    !hasEditorThumbnail,
  );

  if (existingThumbnailUrl && !replaceExisting) {
    return {
      recordingId,
      status: "already-set",
      changed: false,
      thumbnailUrl: existingThumbnailUrl,
    };
  }
  if (recording.status !== "ready" && !suppliedThumbnailBytes) {
    return { recordingId, status: "skipped-not-ready", changed: false };
  }
  if (!recording.videoUrl && !suppliedBytes && !suppliedThumbnailBytes) {
    await setThumbnailStatus(recordingId, "none", "skipped-no-media");
    return { recordingId, status: "skipped-no-media", changed: false };
  }

  const lease = await claimRecordingThumbnailLease(recordingId);
  if (!lease) {
    return {
      recordingId,
      status: "skipped-lease",
      changed: false,
      detail: "Another thumbnail producer is working on this recording.",
    };
  }

  try {
    let bytes = suppliedBytes;
    let mimeType = normalizeMimeType(params.mimeType, recording.videoFormat);
    if (!bytes && !suppliedThumbnailBytes) {
      if (!recording.videoUrl) {
        await setThumbnailStatus(recordingId, "none", "skipped-no-media");
        return { recordingId, status: "skipped-no-media", changed: false };
      }
      try {
        if (isLoomEmbedBackedRecording(recording)) {
          await setThumbnailStatus(recordingId, "none", "skipped-loom-embed");
          return { recordingId, status: "skipped-loom-embed", changed: false };
        }
        const media = await loadRecordingMediaBytes(recording);
        bytes = media.bytes;
        mimeType = media.mimeType;
      } catch (error) {
        console.warn("[clips] recording thumbnail media fetch skipped", {
          recordingId,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          recordingId,
          status: "skipped-media-fetch",
          changed: false,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    }

    if (!bytes?.byteLength && !suppliedThumbnailBytes) {
      await setThumbnailStatus(recordingId, "none", "skipped-no-media");
      return { recordingId, status: "skipped-no-media", changed: false };
    }

    let frame = suppliedThumbnailBytes;
    if (!frame) {
      try {
        frame = await extractThumbnailFrame(bytes!, mimeType);
      } catch (error) {
        console.warn("[clips] recording thumbnail frame extraction skipped", {
          recordingId,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          recordingId,
          status: "skipped-frame-extraction",
          changed: false,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const thumbnailMimeType = suppliedThumbnailBytes
      ? (params.thumbnailMimeType ?? "image/jpeg")
      : "image/jpeg";
    const thumbnailExtension =
      thumbnailMimeType === "image/png" ? "png" : "jpg";
    let uploaded: FileUploadResult | null = null;
    let uploadError: unknown;
    try {
      uploaded = await uploadFile({
        data: frame,
        filename: `thumb-${recordingId}.${thumbnailExtension}`,
        mimeType: thumbnailMimeType,
        ownerEmail,
        recordAsset: false,
      });
    } catch (error) {
      uploadError = error;
      console.warn("[clips] recording thumbnail upload skipped", {
        recordingId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    let url = uploaded?.url;
    if (!url) {
      if (uploadError || !params.allowInlineFallback) {
        return {
          recordingId,
          status: "skipped-upload-failed",
          changed: false,
          detail:
            uploadError instanceof Error
              ? uploadError.message
              : "No file upload provider configured.",
        };
      }
      const base64 = Buffer.from(frame).toString("base64");
      url = `data:${thumbnailMimeType};base64,${base64}`;
    }

    let updated: Array<{ id: string; thumbnailUrl: string | null }>;
    try {
      updated = await getDb()
        .update(schema.recordings)
        .set({
          thumbnailUrl: url,
          thumbnailStatus: "generated",
          thumbnailFailureReason: null,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(schema.recordings.id, recordingId),
            ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
            recording.videoUrl
              ? eq(schema.recordings.videoUrl, recording.videoUrl)
              : isNull(schema.recordings.videoUrl),
            recording.thumbnailUrl !== null && replaceExisting
              ? eq(schema.recordings.thumbnailUrl, recording.thumbnailUrl)
              : recording.thumbnailUrl == null
                ? isNull(schema.recordings.thumbnailUrl)
                : eq(schema.recordings.thumbnailUrl, recording.thumbnailUrl),
            recording.editsJson == null
              ? isNull(schema.recordings.editsJson)
              : eq(schema.recordings.editsJson, recording.editsJson),
          ),
        )
        .returning({
          id: schema.recordings.id,
          thumbnailUrl: schema.recordings.thumbnailUrl,
        });
    } catch (error) {
      if (uploaded) {
        await cleanupUnreferencedThumbnail(uploaded, recordingId, ownerEmail);
      }
      throw error;
    }

    if (updated.length !== 1 || updated[0]?.thumbnailUrl !== url) {
      const current = uploaded
        ? await cleanupUnreferencedThumbnail(uploaded, recordingId, ownerEmail)
        : await loadRecording(recordingId, ownerEmail);
      if (current?.thumbnailUrl) {
        return {
          recordingId,
          status: "already-set",
          changed: false,
          thumbnailUrl: current.thumbnailUrl,
        };
      }
      return {
        recordingId,
        status: "skipped-race",
        changed: false,
        detail: "Recording changed while its thumbnail was uploading.",
      };
    }

    if (uploaded) {
      await cleanupReplacedGeneratedThumbnail(
        recordingId,
        ownerEmail,
        existingThumbnailUrl,
        url,
      );
      await rememberGeneratedThumbnailAsset(recordingId, uploaded);
    }
    await writeAppState("refresh-signal", { ts: Date.now() }).catch(() => {});

    return {
      recordingId,
      status: "generated",
      changed: true,
      thumbnailUrl: url,
    };
  } finally {
    await releaseRecordingThumbnailLease(lease);
  }
}

export async function ensureRecordingThumbnail(
  params: EnsureRecordingThumbnailParams,
): Promise<EnsureRecordingThumbnailResult> {
  const key = thumbnailEnsureKey(params);
  const pending = inFlightThumbnailEnsures.get(key);
  if (pending) return pending;

  const current = ensureRecordingThumbnailOnce(params);
  inFlightThumbnailEnsures.set(key, current);
  try {
    return await current;
  } finally {
    if (inFlightThumbnailEnsures.get(key) === current) {
      inFlightThumbnailEnsures.delete(key);
    }
  }
}
