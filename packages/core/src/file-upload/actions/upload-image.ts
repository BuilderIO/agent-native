import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  deleteAppState,
  readAppState,
  writeAppState,
} from "../../application-state/index.js";
import { ssrfSafeFetch } from "../../extensions/url-safety.js";
import { getRequestUserEmail } from "../../server/request-context.js";
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
const UPLOAD_RECEIPT_PREFIX = "file-upload-receipt:";

interface UploadReceipt {
  url: string;
  id?: string;
  provider: string;
  filename: string;
}

function uploadReceiptKey(idempotencyKey: string): string {
  return `${UPLOAD_RECEIPT_PREFIX}${idempotencyKey}`;
}

function parseUploadReceipt(value: Record<string, unknown>): UploadReceipt {
  if (
    typeof value.url !== "string" ||
    typeof value.provider !== "string" ||
    typeof value.filename !== "string" ||
    (value.id !== undefined && typeof value.id !== "string")
  ) {
    throw new Error("Stored image upload receipt is invalid.");
  }
  return {
    url: value.url,
    provider: value.provider,
    filename: value.filename,
    ...(typeof value.id === "string" ? { id: value.id } : {}),
  };
}

async function settleUploadReceipt(
  idempotencyKey: string,
  cleanup: "delete" | "release",
) {
  const key = uploadReceiptKey(idempotencyKey);
  const stored = await readAppState(key);
  if (!stored) return { idempotencyKey, alreadyMissing: true };
  const receipt = parseUploadReceipt(stored);
  if (cleanup === "release") {
    await deleteAppState(key);
    return { idempotencyKey, released: true };
  }

  const deleted = await deleteUploadedFile(receipt.provider, {
    url: receipt.url,
    id: receipt.id,
  });
  if (!deleted) return { idempotencyKey, deleted: false };
  await deleteAppState(key);
  return { idempotencyKey, deleted: true };
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

  // SSRF guard: this URL is agent/user-controlled and the fetched bytes are
  // re-hosted and returned, so an unguarded fetch is a full-read SSRF (cloud
  // metadata, localhost, internal services). ssrfSafeFetch blocks private
  // targets, re-checks at connect time, and re-validates every redirect hop.
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

  // Reject up front when the server advertises a size over the cap so we never
  // allocate the body at all.
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_REMOTE_FETCH_BYTES) {
    throw new Error(
      `Image too large (${contentLength} bytes, max ${MAX_REMOTE_FETCH_BYTES})`,
    );
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    // Runtimes (or test mocks) without a readable body stream: fall back to a
    // full read, still enforcing the cap before returning.
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_REMOTE_FETCH_BYTES) {
      throw new Error(
        `Image too large (${buffer.byteLength} bytes, max ${MAX_REMOTE_FETCH_BYTES})`,
      );
    }
    return { bytes: new Uint8Array(buffer), mimeType };
  }

  // Stream the body and abort the moment the accumulated size exceeds the cap,
  // so an unbounded or mislabeled response can never be fully buffered.
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
    if (idempotencyKey) {
      const stored = await readAppState(uploadReceiptKey(idempotencyKey));
      if (stored) {
        const receipt = parseUploadReceipt(stored);
        return {
          url: receipt.url,
          id: receipt.id,
          provider: receipt.provider,
        };
      }
    }
    const ownerEmail = getRequestUserEmail() ?? undefined;

    const result = await uploadFile({
      data: bytes,
      filename,
      mimeType,
      ownerEmail,
    });

    if (!result) {
      return {
        error: uploadNotConfiguredError(),
        configured: false,
        connectPath: "/_agent-native/builder/connect",
      };
    }

    if (idempotencyKey) {
      await writeAppState(uploadReceiptKey(idempotencyKey), {
        url: result.url,
        ...(result.id ? { id: result.id } : {}),
        provider: result.provider,
        filename,
      });
    }

    return {
      url: result.url,
      id: result.id,
      provider: result.provider,
    };
  },
});
