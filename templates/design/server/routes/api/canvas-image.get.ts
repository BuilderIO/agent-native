import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import {
  readBoundedResponseBytes,
  RemoteArtifactTooLargeError,
} from "@agent-native/core/ingestion";
import { defineEventHandler, getQuery } from "h3";

import { CANVAS_IMAGE_MAX_EDGE } from "../../../shared/canvas-image-url.js";
import { verifyCanvasImageToken } from "../../lib/canvas-image-token.js";

const WIDTH_BUCKETS = [512, 1024, CANVAS_IMAGE_MAX_EDGE] as const;
const MAX_SRC_LENGTH = 4096;
const MAX_INPUT_BYTES = 40 * 1024 * 1024;
const MAX_INPUT_PIXELS = 100_000_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const JPEG_QUALITY = 82;
const PASS_THROUGH_FORMATS = new Set(["jpeg", "png", "webp", "gif"]);
const FALLBACK_FORMATS = new Set(["jpeg", "png", "webp", "gif", "avif"]);
const RASTER_FORMATS = new Set([...FALLBACK_FORMATS, "heif", "tiff"]);
const ALLOWED_QUERY_KEYS = new Set(["src", "w", "u", "exp", "t"]);
const UNTYPED_CONTENT_TYPES = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
]);
const IMAGE_CACHE = "public, max-age=86400, stale-while-revalidate=604800";
const SHORT_CACHE = "public, max-age=300";
const UNCACHED = "no-store";
const CDN_IMAGE_CACHE =
  "public, durable, max-age=86400, stale-while-revalidate=604800";
const CDN_VARY = "query=src|w";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  if (Object.keys(query).some((key) => !ALLOWED_QUERY_KEYS.has(key))) {
    return reject(400, "Only src, w, u, exp and t are accepted");
  }
  if (!verifyCanvasImageToken(query, Date.now())) {
    return reject(403, "A valid canvas image token is required");
  }
  const src = parseSrc(query.src);
  if (!src) return reject(400, "A valid absolute http(s) src is required");
  const edge = widthBucket(query.w);
  if (edge === null) return reject(400, "w must be a positive integer");

  let response: Response;
  try {
    response = await ssrfSafeFetch(
      src.href,
      {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { Accept: "image/*" },
      },
      { maxRedirects: MAX_REDIRECTS },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isSsrfBlock(error)) {
      console.warn("[canvas-image] blocked address", { host: src.hostname });
      return reject(403, "That address is not allowed");
    }
    return failure(src, 502, "fetch failed", `fetch failed: ${message}`);
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return failure(
      src,
      502,
      "upstream refused",
      `upstream answered ${response.status}`,
    );
  }
  const contentType = (response.headers.get("content-type") || "")
    .replace(/;[\s\S]*$/, "")
    .trim()
    .toLowerCase();
  const sniffable = UNTYPED_CONTENT_TYPES.has(contentType);
  if (
    contentType === "image/svg+xml" ||
    (!sniffable && !contentType.startsWith("image/"))
  ) {
    await response.body?.cancel().catch(() => {});
    return failure(
      src,
      415,
      "unsupported content type",
      `unsupported content type ${contentType || "none"}`,
    );
  }

  let input: Uint8Array;
  try {
    input = await readBoundedResponseBytes(response, MAX_INPUT_BYTES);
  } catch (error) {
    if (error instanceof RemoteArtifactTooLargeError) {
      return failure(src, 413, "image too large");
    }
    const message = error instanceof Error ? error.message : String(error);
    return failure(src, 502, "read failed", `read failed: ${message}`);
  }

  const sharp = await loadSharp();
  let sniffed: string | null;
  if (sharp) {
    try {
      sniffed = await sniffFormat(sharp, input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return failure(src, 422, "not a readable image", message);
    }
  } else {
    sniffed = sniffMagicBytes(input);
  }
  if (sniffed === null || !RASTER_FORMATS.has(sniffed)) {
    return failure(
      src,
      415,
      "unsupported image format",
      `unsupported image format ${sniffed ?? "unknown"}`,
    );
  }

  try {
    if (!sharp) throw new Error("sharp is unavailable");
    const output = await resizeImage(sharp, input, edge);
    return imageResponse(output.data, output.contentType);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason = `resize failed: ${message}`;
    if (!FALLBACK_FORMATS.has(sniffed)) {
      return failure(src, 422, "image could not be resized", reason);
    }
    console.warn("[canvas-image] serving original bytes", {
      host: src.hostname,
      reason,
    });
    return imageResponse(input, `image/${sniffed}`, reason);
  }
});

function imageResponse(
  data: Uint8Array,
  contentType: string,
  fallbackReason?: string,
): Response {
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": fallbackReason ? SHORT_CACHE : IMAGE_CACHE,
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Netlify-Vary": CDN_VARY,
  };
  if (fallbackReason) {
    headers["X-Canvas-Image-Fallback"] = headerSafe(fallbackReason);
  } else {
    headers["Netlify-CDN-Cache-Control"] = CDN_IMAGE_CACHE;
  }
  return new Response(new Blob([new Uint8Array(data)]), { headers });
}

function isSsrfBlock(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.message.startsWith("SSRF blocked:")) return true;
  const { cause } = error as { cause?: { code?: unknown } };
  return cause?.code === "EAI_BLOCKED";
}

function headerSafe(reason: string): string {
  return reason.replace(/[^\x20-\x7e]/g, "?").slice(0, 200);
}

function parseSrc(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > MAX_SRC_LENGTH) return null;
  const absolute = value.startsWith("//") ? `https:${value}` : value;
  if (!/^https?:\/\//i.test(absolute)) return null;
  if (!URL.canParse(absolute)) return null;
  const url = new URL(absolute);
  if (url.username || url.password) return null;
  return url;
}

function widthBucket(value: unknown): number | null {
  if (value === undefined || value === "") return CANVAS_IMAGE_MAX_EDGE;
  if (typeof value !== "string" || !/^\d{1,6}$/.test(value)) return null;
  const requested = Number(value);
  if (requested < 1) return null;
  return (
    WIDTH_BUCKETS.find((bucket) => requested <= bucket) ?? WIDTH_BUCKETS[2]
  );
}

type Sharp = (typeof import("sharp"))["default"];

async function loadSharp(): Promise<Sharp | null> {
  try {
    return (await import("sharp")).default;
  } catch (error) {
    console.warn("[canvas-image] sharp unavailable", error);
    return null;
  }
}

async function sniffFormat(sharp: Sharp, input: Uint8Array): Promise<string> {
  const meta = await sharp(Buffer.from(input), {
    failOn: "none",
    limitInputPixels: MAX_INPUT_PIXELS,
  }).metadata();
  if (meta.format === "heif" && meta.compression === "av1") return "avif";
  return meta.format;
}

function sniffMagicBytes(bytes: Uint8Array): string | null {
  const startsWith = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (startsWith(0xff, 0xd8, 0xff)) return "jpeg";
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return "gif";
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...bytes.subarray(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (ascii(4, 8) === "ftyp" && /^avi[fs]$/.test(ascii(8, 12))) return "avif";
  return null;
}

async function resizeImage(
  sharp: Sharp,
  input: Uint8Array,
  edge: number,
): Promise<{ data: Uint8Array; contentType: string }> {
  const open = () =>
    sharp(Buffer.from(input), {
      failOn: "none",
      limitInputPixels: MAX_INPUT_PIXELS,
    });
  const meta = await open().metadata();
  if (!meta.width || !meta.height) {
    throw new Error("image dimensions are unreadable");
  }

  const longest = Math.max(meta.width, meta.height);
  const animated = (meta.pages ?? 1) > 1;
  const oriented = (meta.orientation ?? 1) > 1;
  if (
    PASS_THROUGH_FORMATS.has(meta.format) &&
    (animated || (longest <= edge && !oriented))
  ) {
    return { data: input, contentType: `image/${meta.format}` };
  }

  const pipeline = open()
    .rotate()
    .resize(edge, edge, { fit: "inside", withoutEnlargement: true });
  if (meta.format === "webp") {
    return {
      data: await pipeline.webp({ quality: JPEG_QUALITY }).toBuffer(),
      contentType: "image/webp",
    };
  }
  if (meta.format === "gif") {
    return { data: await pipeline.gif().toBuffer(), contentType: "image/gif" };
  }
  if (meta.format === "png" || meta.hasAlpha) {
    return {
      data: await pipeline.png({ compressionLevel: 9 }).toBuffer(),
      contentType: "image/png",
    };
  }
  return {
    data: await pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer(),
    contentType: "image/jpeg",
  };
}

function reject(status: number, error: string): Response {
  return Response.json(
    { error },
    {
      status,
      headers: {
        "Cache-Control": UNCACHED,
        "Netlify-CDN-Cache-Control": UNCACHED,
        "Netlify-Vary": CDN_VARY,
      },
    },
  );
}

function failure(
  src: URL,
  status: number,
  reason: string,
  detail: string = reason,
): Response {
  console.warn("[canvas-image] failed", {
    host: src.hostname,
    status,
    reason: detail,
  });
  return Response.json(
    { error: reason },
    {
      status,
      headers: {
        "Cache-Control": status === 502 ? UNCACHED : SHORT_CACHE,
        "X-Canvas-Image-Fallback": headerSafe(reason),
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Netlify-Vary": CDN_VARY,
      },
    },
  );
}
