import { z } from "zod";
import { defineAction } from "../../action.js";
import { getRequestUserEmail } from "../../server/request-context.js";
import { uploadFile } from "../registry.js";

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

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch image (${response.status} ${response.statusText})`,
    );
  }
  const contentType = response.headers.get("content-type") || "";
  const mimeType =
    contentType.split(";")[0].trim().toLowerCase() ||
    "application/octet-stream";
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_REMOTE_FETCH_BYTES) {
    throw new Error(
      `Image too large (${buffer.byteLength} bytes, max ${MAX_REMOTE_FETCH_BYTES})`,
    );
  }
  return { bytes: new Uint8Array(buffer), mimeType };
}

function uploadNotConfiguredError(): string {
  return [
    "Image uploads are not configured for this app.",
    "Configure a file upload provider — connect Builder.io in Settings → File uploads (free credits), set BUILDER_PRIVATE_KEY, or register a custom provider (S3, R2, GCS, etc.) via registerFileUploadProvider().",
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
    })
    .refine((args) => !!args.data || !!args.url, {
      message: "Either `data` or `url` is required.",
    }),
  run: async (args) => {
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

    return {
      url: result.url,
      id: result.id,
      provider: result.provider,
    };
  },
});
