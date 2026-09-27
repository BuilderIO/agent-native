import { randomUUID } from "node:crypto";

import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  compareAndSetAppState,
  readAppState,
} from "../../application-state/index.js";
import {
  appStateCompareAndSet,
  appStateGet,
  appStateListByKeyPrefix,
} from "../../application-state/store.js";
import { ssrfSafeFetch } from "../../extensions/url-safety.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
  runWithRequestContext,
} from "../../server/request-context.js";
import { deleteUploadedFile, uploadFile } from "../registry.js";

const MAX_REMOTE_FETCH_BYTES = 25 * 1024 * 1024;

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
  "image/heic",
  "image/heif",
]);
export const UPLOAD_RECEIPT_PREFIX = "file-upload-receipt:";
const UPLOAD_RECEIPT_STAGED_TTL_MS = 24 * 60 * 60 * 1000;
const UPLOAD_RECEIPT_PENDING_TTL_MS = 5 * 60 * 1000;
const UPLOAD_RECEIPT_DELETE_LEASE_MS = 5 * 60 * 1000;
const UPLOAD_RECEIPT_RETRY_DELAY_MS = 15 * 60 * 1000;
const UPLOAD_RECEIPT_CLEANUP_BATCH_SIZE = 50;
const UPLOAD_RECEIPT_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const UPLOAD_RECEIPT_RESERVATION_WAIT_MS = 5_000;
const UPLOAD_RECEIPT_RESERVATION_POLL_MS = 100;
const UPLOAD_RECEIPT_IMPORT_BATCH_LIMIT = 2_048;
let uploadReceiptCleanupLastRunAt = 0;

type UploadReceiptStatus = "pending" | "staged" | "committed" | "deleting";

interface UploadReceipt extends Record<string, unknown> {
  status: UploadReceiptStatus;
  url?: string;
  id?: string;
  provider?: string;
  filename: string;
  expiresAt: number;
  reservationId?: string;
  leaseExpiresAt?: number;
  ownerEmail?: string;
  orgId?: string;
}

function uploadReceiptKey(idempotencyKey: string): string {
  return `${UPLOAD_RECEIPT_PREFIX}${idempotencyKey}`;
}

function parseUploadReceipt(value: Record<string, unknown>): UploadReceipt {
  const status = value.status ?? "staged";
  if (
    typeof value.filename !== "string" ||
    !["pending", "staged", "committed", "deleting"].includes(String(status)) ||
    (value.url !== undefined && typeof value.url !== "string") ||
    (value.provider !== undefined && typeof value.provider !== "string") ||
    (value.id !== undefined && typeof value.id !== "string") ||
    (value.expiresAt !== undefined &&
      (typeof value.expiresAt !== "number" ||
        !Number.isFinite(value.expiresAt)))
  ) {
    throw new Error("Stored image upload receipt is invalid.");
  }
  const normalizedStatus = status as UploadReceiptStatus;
  if (
    normalizedStatus !== "pending" &&
    (typeof value.url !== "string" || typeof value.provider !== "string")
  ) {
    throw new Error("Stored image upload receipt is missing provider data.");
  }
  if (
    normalizedStatus === "pending" &&
    typeof value.reservationId !== "string"
  ) {
    throw new Error("Stored image upload reservation is invalid.");
  }
  return {
    status: normalizedStatus,
    ...(typeof value.url === "string" ? { url: value.url } : {}),
    ...(typeof value.provider === "string" ? { provider: value.provider } : {}),
    filename: value.filename,
    ...(typeof value.id === "string" ? { id: value.id } : {}),
    expiresAt:
      typeof value.expiresAt === "number"
        ? value.expiresAt
        : Date.now() + UPLOAD_RECEIPT_STAGED_TTL_MS,
    ...(typeof value.reservationId === "string"
      ? { reservationId: value.reservationId }
      : {}),
    ...(typeof value.leaseExpiresAt === "number"
      ? { leaseExpiresAt: value.leaseExpiresAt }
      : {}),
    ...(typeof value.ownerEmail === "string"
      ? { ownerEmail: value.ownerEmail }
      : {}),
    ...(typeof value.orgId === "string" ? { orgId: value.orgId } : {}),
  };
}

function receiptHasProviderData(
  receipt: UploadReceipt,
): receipt is UploadReceipt & { url: string; provider: string } {
  return (
    typeof receipt.url === "string" && typeof receipt.provider === "string"
  );
}

function requestReceiptOwner(): Pick<UploadReceipt, "ownerEmail" | "orgId"> {
  const ownerEmail = getRequestUserEmail() ?? undefined;
  const orgId = getRequestOrgId() ?? undefined;
  return {
    ...(ownerEmail ? { ownerEmail } : {}),
    ...(orgId ? { orgId } : {}),
  };
}

function pendingUploadReceipt(filename: string): UploadReceipt {
  return {
    status: "pending",
    filename,
    reservationId: randomUUID(),
    expiresAt: Date.now() + UPLOAD_RECEIPT_PENDING_TTL_MS,
    ...requestReceiptOwner(),
  };
}

function waitForUploadReceipt(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, UPLOAD_RECEIPT_RESERVATION_POLL_MS);
  });
}

async function reserveUploadReceipt(
  idempotencyKey: string,
  filename: string,
): Promise<{ receipt?: UploadReceipt; pending?: UploadReceipt }> {
  const key = uploadReceiptKey(idempotencyKey);
  const deadline = Date.now() + UPLOAD_RECEIPT_RESERVATION_WAIT_MS;
  const pending = pendingUploadReceipt(filename);

  while (true) {
    const stored = await readAppState(key);
    if (!stored) {
      if (await compareAndSetAppState(key, null, pending)) return { pending };
      continue;
    }

    const receipt = parseUploadReceipt(stored);
    if (receipt.status === "staged" || receipt.status === "committed") {
      return { receipt };
    }

    const now = Date.now();
    const leaseExpiresAt =
      receipt.status === "deleting"
        ? (receipt.leaseExpiresAt ?? receipt.expiresAt)
        : receipt.expiresAt;
    if (leaseExpiresAt > now) {
      if (now >= deadline) {
        throw new Error(
          "Image upload is still being reconciled. Please retry the import.",
        );
      }
      await waitForUploadReceipt();
      continue;
    }

    if (await compareAndSetAppState(key, stored, pending)) return { pending };
  }
}

async function deleteReceiptProviderObject(
  receipt: UploadReceipt & { url: string; provider: string },
  sessionId?: string,
): Promise<boolean> {
  const ownerEmail = receipt.ownerEmail ?? sessionId;
  return await runWithRequestContext(
    {
      ...(ownerEmail ? { userEmail: ownerEmail } : {}),
      ...(receipt.orgId ? { orgId: receipt.orgId } : {}),
    },
    () =>
      deleteUploadedFile(receipt.provider!, {
        url: receipt.url!,
        id: receipt.id,
      }),
  );
}

async function cleanupUnrecordedUpload(
  receipt: UploadReceipt & { url: string; provider: string },
): Promise<void> {
  try {
    if (await deleteReceiptProviderObject(receipt)) return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Image upload cleanup failed: ${message}`);
  }
  throw new Error("Image upload cleanup failed: the provider kept the object.");
}

async function settleUploadReceipt(
  idempotencyKey: string,
  cleanup: "delete" | "release",
) {
  const key = uploadReceiptKey(idempotencyKey);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stored = await readAppState(key);
    if (!stored) return { idempotencyKey, alreadyMissing: true };
    const receipt = parseUploadReceipt(stored);

    if (cleanup === "release") {
      if (receipt.status === "committed") {
        return { idempotencyKey, released: true };
      }
      if (receipt.status !== "staged") {
        return { idempotencyKey, released: false };
      }
      const committed: UploadReceipt = {
        ...receipt,
        status: "committed",
        expiresAt: Date.now() + UPLOAD_RECEIPT_STAGED_TTL_MS,
      };
      if (await compareAndSetAppState(key, stored, committed)) {
        return { idempotencyKey, released: true };
      }
      continue;
    }

    if (receipt.status === "pending") {
      if (receipt.expiresAt > Date.now()) {
        return { idempotencyKey, deleted: false };
      }
      const released = await compareAndSetAppState(key, stored, null);
      return released
        ? { idempotencyKey, released: true }
        : { idempotencyKey, deleted: false };
    }
    if (!receiptHasProviderData(receipt)) {
      throw new Error("Stored image upload receipt is missing provider data.");
    }
    if (
      receipt.status === "deleting" &&
      (receipt.leaseExpiresAt ?? receipt.expiresAt) > Date.now()
    ) {
      return { idempotencyKey, deleted: false };
    }

    const deleting: UploadReceipt = {
      ...receipt,
      status: "deleting",
      expiresAt: Date.now() + UPLOAD_RECEIPT_DELETE_LEASE_MS,
      leaseExpiresAt: Date.now() + UPLOAD_RECEIPT_DELETE_LEASE_MS,
    };
    if (!(await compareAndSetAppState(key, stored, deleting))) continue;

    const deleted = await deleteReceiptProviderObject(receipt);
    if (!deleted) {
      await compareAndSetAppState(key, deleting, {
        ...receipt,
        status: "staged",
        expiresAt: Date.now() + UPLOAD_RECEIPT_RETRY_DELAY_MS,
      });
      return { idempotencyKey, deleted: false };
    }
    await compareAndSetAppState(key, deleting, null);
    return { idempotencyKey, deleted: true };
  }
  return { idempotencyKey, deleted: false };
}

function receiptBelongsToRequest(receipt: UploadReceipt): boolean {
  const owner = requestReceiptOwner();
  return (
    (!receipt.ownerEmail || receipt.ownerEmail === owner.ownerEmail) &&
    (!receipt.orgId || receipt.orgId === owner.orgId)
  );
}

export async function commitUploadReceiptsForImport(
  importId: string,
): Promise<void> {
  const rows = await appStateListByKeyPrefix(
    `${UPLOAD_RECEIPT_PREFIX}${importId}:`,
    UPLOAD_RECEIPT_IMPORT_BATCH_LIMIT,
  );
  for (const row of rows) {
    const receipt = parseUploadReceipt(row.value);
    if (receipt.status === "committed" || !receiptBelongsToRequest(receipt)) {
      continue;
    }
    if (receipt.status !== "staged") {
      throw new Error("Image upload receipt is not ready to commit.");
    }
    const committed: UploadReceipt = {
      ...receipt,
      status: "committed",
      expiresAt: Date.now() + UPLOAD_RECEIPT_STAGED_TTL_MS,
    };
    if (
      !(await appStateCompareAndSet(
        row.sessionId,
        row.key,
        row.value,
        committed,
      ))
    ) {
      const current = await appStateGet(row.sessionId, row.key);
      if (!current || parseUploadReceipt(current).status !== "committed") {
        throw new Error("Could not commit the image upload receipt.");
      }
    }
  }
}

export async function runUploadReceiptCleanupOnce(options?: {
  force?: boolean;
  now?: number;
  limit?: number;
}): Promise<{
  scanned: number;
  deleted: number;
  released: number;
  failed: number;
  skipped: boolean;
}> {
  const now = options?.now ?? Date.now();
  if (
    !options?.force &&
    now - uploadReceiptCleanupLastRunAt < UPLOAD_RECEIPT_CLEANUP_INTERVAL_MS
  ) {
    return { scanned: 0, deleted: 0, released: 0, failed: 0, skipped: true };
  }
  uploadReceiptCleanupLastRunAt = now;

  const rows = await appStateListByKeyPrefix(
    UPLOAD_RECEIPT_PREFIX,
    options?.limit ?? UPLOAD_RECEIPT_CLEANUP_BATCH_SIZE,
  );
  let deleted = 0;
  let released = 0;
  let failed = 0;

  for (const row of rows) {
    let receipt: UploadReceipt;
    try {
      receipt = parseUploadReceipt(row.value);
    } catch {
      failed += 1;
      continue;
    }
    if (receipt.expiresAt > now) continue;

    if (receipt.status === "pending") {
      if (
        await appStateCompareAndSet(row.sessionId, row.key, row.value, null)
      ) {
        released += 1;
      }
      continue;
    }
    if (receipt.status === "committed") {
      if (
        await appStateCompareAndSet(row.sessionId, row.key, row.value, null)
      ) {
        released += 1;
      }
      continue;
    }
    if (!receiptHasProviderData(receipt)) {
      failed += 1;
      continue;
    }
    if (
      receipt.status === "deleting" &&
      (receipt.leaseExpiresAt ?? receipt.expiresAt) > now
    ) {
      continue;
    }

    const leaseExpiresAt = now + UPLOAD_RECEIPT_DELETE_LEASE_MS;
    const deleting: UploadReceipt = {
      ...receipt,
      status: "deleting",
      expiresAt: leaseExpiresAt,
      leaseExpiresAt,
    };
    if (
      !(await appStateCompareAndSet(
        row.sessionId,
        row.key,
        row.value,
        deleting,
      ))
    ) {
      continue;
    }

    let objectDeleted = false;
    try {
      objectDeleted = await deleteReceiptProviderObject(receipt, row.sessionId);
    } catch (error) {
      console.error(
        "[file-upload] Failed to delete an expired upload receipt:",
        error,
      );
    }
    if (objectDeleted) {
      if (await appStateCompareAndSet(row.sessionId, row.key, deleting, null)) {
        deleted += 1;
      }
      continue;
    }

    failed += 1;
    try {
      await appStateCompareAndSet(row.sessionId, row.key, deleting, {
        ...receipt,
        status: "staged",
        expiresAt: now + UPLOAD_RECEIPT_RETRY_DELAY_MS,
      });
    } catch (error) {
      console.error(
        "[file-upload] Failed to requeue an expired upload receipt:",
        error,
      );
    }
  }

  return {
    scanned: rows.length,
    deleted,
    released,
    failed,
    skipped: false,
  };
}

function extensionFromMime(mimeType: string): string {
  const bare = mimeType.split(";")[0].trim().toLowerCase();
  if (bare === "image/jpeg" || bare === "image/jpg") return ".jpg";
  if (bare === "image/png") return ".png";
  if (bare === "image/gif") return ".gif";
  if (bare === "image/webp") return ".webp";
  if (bare === "image/avif") return ".avif";
  if (bare === "image/svg+xml") return ".svg";
  if (bare === "image/heic") return ".heic";
  if (bare === "image/heif") return ".heif";
  return "";
}

function defaultFilename(mimeType: string): string {
  return `image-${Date.now()}${extensionFromMime(mimeType) || ".bin"}`;
}

function parseDataUrl(dataUrl: string): {
  bytes: Uint8Array;
  mimeType: string;
} {
  const match = dataUrl.match(/^data:([^;,]+)(;base64)?,(.+)$/);
  if (!match) {
    throw new Error("data must be a data URL (data:image/...;base64,...)");
  }
  const mimeType = match[1].trim().toLowerCase();
  const isBase64 = !!match[2];
  const payload = match[3];
  const bytes = isBase64
    ? new Uint8Array(Buffer.from(payload, "base64"))
    : new TextEncoder().encode(decodeURIComponent(payload));
  return { bytes, mimeType };
}

async function fetchRemote(url: string): Promise<{
  bytes: Uint8Array;
  mimeType: string;
}> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`url is not a valid URL: ${url}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("url must use http(s)");
  }

  const response = await ssrfSafeFetch(url, {}, { maxRedirects: 3 });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch image (${response.status} ${response.statusText})`,
    );
  }
  const contentType = response.headers.get("content-type") || "";
  const mimeType =
    contentType.split(";")[0].trim().toLowerCase() ||
    "application/octet-stream";

  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_REMOTE_FETCH_BYTES) {
    throw new Error(
      `Image too large (${contentLength} bytes, max ${MAX_REMOTE_FETCH_BYTES})`,
    );
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_REMOTE_FETCH_BYTES) {
      throw new Error(
        `Image too large (${buffer.byteLength} bytes, max ${MAX_REMOTE_FETCH_BYTES})`,
      );
    }
    return { bytes: new Uint8Array(buffer), mimeType };
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_REMOTE_FETCH_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error(
        `Image too large (>${total} bytes, max ${MAX_REMOTE_FETCH_BYTES})`,
      );
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, mimeType };
}

function uploadNotConfiguredError(): string {
  return [
    "Image uploads are not configured for this app.",
    "Connect or reconnect Builder.io (free tier available) in Settings → File uploads, or register a custom provider (S3, R2, GCS, etc.) via registerFileUploadProvider().",
  ].join(" ");
}

export default defineAction({
  description:
    "Upload an image to the configured file-upload provider (Builder.io by default) and return a hosted CDN URL. " +
    "Use this to turn a base64 data URL, a chat-attached image, or a transient remote URL into a stable URL that " +
    'can be embedded in <img src="...">, slide HTML, documents, or shared with other apps. Falls back to a clear ' +
    "'connect Builder.io' message when no provider is configured.",
  schema: z
    .object({
      data: z
        .string()
        .optional()
        .describe(
          "Base64 data URL (data:image/png;base64,...). Pass when the image bytes are already in the chat context — for example an attached or generated image. Either `data` or `url` is required.",
        ),
      url: z
        .string()
        .optional()
        .describe(
          "Remote image URL to re-host. Useful for preserving transient generated images, third-party search results, or any external URL whose long-term availability you don't control. Either `data` or `url` is required.",
        ),
      filename: z
        .string()
        .optional()
        .describe(
          "Optional filename hint, used by the provider for display and to derive an extension when missing.",
        ),
      idempotencyKey: z.string().trim().min(1).max(200).optional(),
      cleanup: z.enum(["delete", "release"]).optional(),
    })
    .refine(
      (args) =>
        args.cleanup ? !!args.idempotencyKey : !!args.data || !!args.url,
      {
        message:
          "Either a data/url upload or an idempotencyKey cleanup is required.",
      },
    ),
  run: async (args) => {
    const idempotencyKey = args.idempotencyKey?.trim();
    if (args.cleanup && idempotencyKey) {
      return settleUploadReceipt(idempotencyKey, args.cleanup);
    }

    let bytes: Uint8Array;
    let mimeType: string;

    if (args.data) {
      ({ bytes, mimeType } = parseDataUrl(args.data));
    } else if (args.url) {
      ({ bytes, mimeType } = await fetchRemote(args.url));
    } else {
      return { error: "Either `data` or `url` is required." };
    }

    if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
      return {
        error: `Unsupported image type: ${mimeType}. Supported: ${[...SUPPORTED_IMAGE_MIME_TYPES].join(", ")}.`,
      };
    }

    const filename = (args.filename || defaultFilename(mimeType)).trim();
    let pendingReceipt: UploadReceipt | undefined;
    if (idempotencyKey) {
      const reserved = await reserveUploadReceipt(idempotencyKey, filename);
      if (reserved.receipt) {
        if (!receiptHasProviderData(reserved.receipt)) {
          throw new Error(
            "Stored image upload receipt is missing provider data.",
          );
        }
        return {
          url: reserved.receipt.url,
          id: reserved.receipt.id,
          provider: reserved.receipt.provider,
        };
      }
      pendingReceipt = reserved.pending;
    }
    const ownerEmail = getRequestUserEmail() ?? undefined;

    try {
      const result = await uploadFile({
        data: bytes,
        filename,
        mimeType,
        ownerEmail,
      });

      if (!result) {
        if (pendingReceipt && idempotencyKey) {
          await compareAndSetAppState(
            uploadReceiptKey(idempotencyKey),
            pendingReceipt,
            null,
          );
        }
        return {
          error: uploadNotConfiguredError(),
          configured: false,
          connectPath: "/_agent-native/builder/connect",
        };
      }

      if (pendingReceipt && idempotencyKey) {
        const stagedReceipt: UploadReceipt = {
          ...pendingReceipt,
          status: "staged",
          url: result.url,
          ...(result.id ? { id: result.id } : {}),
          provider: result.provider,
          expiresAt: Date.now() + UPLOAD_RECEIPT_STAGED_TTL_MS,
        };
        const unrecordedReceipt = {
          ...stagedReceipt,
          url: result.url,
          provider: result.provider,
        };
        const staged = await compareAndSetAppState(
          uploadReceiptKey(idempotencyKey),
          pendingReceipt,
          stagedReceipt,
        );
        if (!staged) {
          const current = await readAppState(uploadReceiptKey(idempotencyKey));
          if (current) {
            const existing = parseUploadReceipt(current);
            if (receiptHasProviderData(existing)) {
              await cleanupUnrecordedUpload(unrecordedReceipt);
              return {
                url: existing.url,
                id: existing.id,
                provider: existing.provider,
              };
            }
          }
          await cleanupUnrecordedUpload(unrecordedReceipt);
          throw new Error("Could not record the image upload receipt.");
        }
      }

      return {
        url: result.url,
        id: result.id,
        provider: result.provider,
      };
    } catch (error) {
      if (pendingReceipt && idempotencyKey) {
        try {
          await compareAndSetAppState(
            uploadReceiptKey(idempotencyKey),
            pendingReceipt,
            null,
          );
        } catch (cleanupError) {
          console.error(
            "[file-upload] Failed to release upload reservation:",
            cleanupError,
          );
        }
      }
      throw error;
    }
  },
});
