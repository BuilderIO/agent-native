import { fail } from "@agent-native/core/action";
import {
  deletePrivateBlob,
  getActivePrivateBlobProviderForRequest,
  isPrivateBlobConfiguredForRequest,
  putPrivateBlob,
  resolveAttachment,
  type PrivateBlobHandle,
} from "@agent-native/core/private-blob";

import { isValidReplayScreenshotBlobHandle } from "./replay-screenshot-private-blob.js";
import { deleteVisualEditSnapshotBlobs } from "./visual-edit-snapshot-blobs.js";

export const MAX_REPLAY_SCREENSHOT_BYTES = 10 * 1024 * 1024;

export type ReplayScreenshotMimeType =
  | "image/png"
  | "image/jpeg"
  | "image/webp";

export interface StoredReplayScreenshotBlob {
  blobHandle: PrivateBlobHandle;
  mimeType: ReplayScreenshotMimeType;
  sizeBytes: number;
}

export type ReplayScreenshotStorage =
  | { kind: "private-provider"; providerId: string }
  | { kind: "encrypted-public-upload" };

export async function resolveReplayScreenshotStorage(
  allowEncryptedPublicUploadFallback: boolean,
): Promise<ReplayScreenshotStorage> {
  const provider = await getActivePrivateBlobProviderForRequest();
  if (provider) return { kind: "private-provider", providerId: provider.id };
  if (
    allowEncryptedPublicUploadFallback === true &&
    (await isPrivateBlobConfiguredForRequest())
  ) {
    return { kind: "encrypted-public-upload" };
  }
  fail(
    "Replay screenshots require a configured private blob provider. Set allowEncryptedPublicUploadFallback to true only when approved to use the app's encrypted public-upload fallback.",
    { errorCode: "private_blob_provider_required", statusCode: 503 },
  );
}

export function detectImageMimeType(
  data: Uint8Array,
): ReplayScreenshotMimeType | null {
  if (
    data.byteLength >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    data.byteLength >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    data.byteLength >= 12 &&
    String.fromCharCode(...data.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...data.subarray(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export function validateReplayScreenshotBytes(
  data: Uint8Array,
): ReplayScreenshotMimeType {
  const mimeType = detectImageMimeType(data);
  if (!mimeType) {
    fail("Screenshot bytes must be a PNG, JPEG, or WebP image.", {
      errorCode: "invalid_replay_screenshot_image",
      statusCode: 400,
    });
  }
  if (data.byteLength === 0 || data.byteLength > MAX_REPLAY_SCREENSHOT_BYTES) {
    fail("Each replay screenshot must be 10 MiB or smaller.", {
      errorCode: "replay_screenshot_too_large",
      statusCode: 413,
    });
  }
  return mimeType;
}

export async function resolveAttachmentScreenshotBytes(args: {
  attachmentRef: string;
  requesterEmail: string;
}): Promise<Uint8Array> {
  const resolved = await resolveAttachment(args.attachmentRef, {
    ownerEmail: args.requesterEmail,
    orgId: null,
  });
  if (resolved.status !== "ok") {
    fail(attachmentFailureMessage(resolved.status), {
      errorCode: `attachment_${resolved.status}`,
      statusCode:
        resolved.status === "forbiddenScope"
          ? 403
          : resolved.status === "storageUnavailable"
            ? 503
            : 400,
      details: {
        attachmentStatus: resolved.status,
        reason: resolved.reason,
        retryable: resolved.status === "storageUnavailable",
      },
    });
  }
  validateReplayScreenshotBytes(resolved.file.data);
  return resolved.file.data;
}

export function attachmentFailureMessage(status: string): string {
  if (status === "forbiddenScope") {
    return "Screenshot attachments must be personal files owned by the current user.";
  }
  if (status === "storageUnavailable") {
    return "The screenshot attachment storage is unavailable. Retry with the same attachment reference.";
  }
  return "A screenshot attachment is missing, expired, or invalid. Reattach it and retry.";
}

export async function storeReplayScreenshotBytesAsPrivateBlob(args: {
  data: Uint8Array;
  blobOwnerEmail: string;
  providerId?: string;
  rowId: string;
  designId: string;
  replayId: string;
}): Promise<StoredReplayScreenshotBlob> {
  const mimeType = validateReplayScreenshotBytes(args.data);
  const sizeBytes = args.data.byteLength;
  const blobHandle = await putPrivateBlob({
    data: args.data,
    filename: `session-replay-${args.rowId}.${mimeType === "image/jpeg" ? "jpg" : mimeType.slice(6)}`,
    mimeType,
    ownerEmail: args.blobOwnerEmail,
    metadata: { designId: args.designId, replayId: args.replayId },
  });
  if (!blobHandle) {
    fail("The private blob provider could not store a replay screenshot.", {
      errorCode: "private_blob_write_failed",
      statusCode: 503,
    });
  }
  if (
    !isValidReplayScreenshotBlobHandle(blobHandle) ||
    (args.providerId && blobHandle.provider !== args.providerId)
  ) {
    await discardPrivateBlobs([blobHandle]);
    fail("Replay screenshots must use an opaque private blob storage handle.", {
      errorCode: "private_blob_provider_mismatch",
      statusCode: 503,
    });
  }
  return { blobHandle, mimeType, sizeBytes };
}

/**
 * Copies a personal attachment into private blob storage, owned by the design
 * owner, so `/api/design-board-replay-screenshots/:id` can serve it to anyone
 * with viewer access to the design.
 */
export async function storeAttachmentAsPrivateBlob(args: {
  attachmentRef: string;
  requesterEmail: string;
  blobOwnerEmail: string;
  providerId?: string;
  rowId: string;
  designId: string;
  replayId: string;
}): Promise<StoredReplayScreenshotBlob> {
  return storeReplayScreenshotBytesAsPrivateBlob({
    data: await resolveAttachmentScreenshotBytes({
      attachmentRef: args.attachmentRef,
      requesterEmail: args.requesterEmail,
    }),
    blobOwnerEmail: args.blobOwnerEmail,
    providerId: args.providerId,
    rowId: args.rowId,
    designId: args.designId,
    replayId: args.replayId,
  });
}

/** Deletes blobs no committed row references; anything the provider cannot delete now is queued for retry. */
export async function discardPrivateBlobs(
  handles: readonly PrivateBlobHandle[],
): Promise<void> {
  const pending = (
    await Promise.all(
      handles.map(async (handle) => {
        try {
          const result = await deletePrivateBlob(handle);
          return result.deleted ? null : handle;
        } catch {
          return handle;
        }
      }),
    )
  ).filter((handle): handle is PrivateBlobHandle => handle !== null);
  if (pending.length === 0) return;
  try {
    await deleteVisualEditSnapshotBlobs(
      pending.map((handle) => JSON.stringify(handle)),
    );
  } catch (error) {
    console.warn(
      "[design-journey-canvas] Private blob cleanup could not be queued:",
      error,
    );
  }
}
