/**
 * Routes for signed, content-only recap PNG images.
 *
 *   POST /_agent-native/recap-image
 *     Auth: `Authorization: Bearer <token>` — accepts the SAME tokens the MCP /
 *     action surface accepts: a legacy `sessions` bearer (desktop/native) OR a
 *     connect-minted MCP OAuth access token (the `agent-native connect` token,
 *     audience-bound to this app's `{origin}/mcp` resource). A
 *     normal browser session cookie is also accepted. Rejects unauthenticated
 *     callers with 401.
 *     Body: raw `image/png` bytes, or JSON `{ "pngBase64": "..." }`. Capped at
 *     ~5 MB. Stores the PNG and returns `{ imageUrl: "<origin>/_agent-native/
 *     recap-image/<token>.png" }`.
 *
 *   GET /_agent-native/recap-image/<token>.png
 *     ANONYMOUS (no auth) so GitHub's camo image proxy can fetch it into a
 *     private-repo PR comment. Returns the stored PNG with a strict
 *     `Content-Type: image/png` and a long immutable cache header. 404 on an
 *     unknown/malformed token. Only ever serves opaque image bytes — no plan
 *     data leaks through this route.
 */
import {
  defineEventHandler,
  getHeader,
  getMethod,
  readRawBody,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import {
  getMcpOAuthBearerSession,
  getSession,
  type AuthSession,
} from "./auth.js";
import { getAppUrl } from "./google-oauth.js";
import {
  RECAP_IMAGE_CONTENT_TYPE,
  RECAP_IMAGE_MAX_BYTES,
  getRecapImage,
  isValidRecapImageToken,
  saveRecapImage,
} from "./recap-image-store.js";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Long immutable cache — the bytes for a given token never change. */
const RECAP_IMAGE_CACHE_CONTROL =
  "public, max-age=31536000, immutable, stale-while-revalidate=604800, stale-if-error=86400";

function isPngBuffer(buf: Buffer): boolean {
  return (
    buf.byteLength >= PNG_MAGIC.byteLength &&
    buf.subarray(0, 8).equals(PNG_MAGIC)
  );
}

async function resolveUploadSession(
  event: H3Event,
): Promise<AuthSession | null> {
  const session = await getSession(event).catch(() => null);
  if (session?.email) return session;
  return getMcpOAuthBearerSession(event);
}

async function readPngFromRequest(event: H3Event): Promise<Buffer | null> {
  const rawBody = await readRawBody(event, false).catch(() => undefined);
  if (!rawBody || rawBody.byteLength === 0) return null;
  if (rawBody.byteLength > RECAP_IMAGE_MAX_BYTES) return null;

  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);

  const contentType = (getHeader(event, "content-type") || "").toLowerCase();

  if (contentType.includes("application/json")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      return null;
    }
    const base64 = (parsed as { pngBase64?: unknown })?.pngBase64;
    if (typeof base64 !== "string" || !base64) return null;
    let bytes: Buffer;
    try {
      bytes = Buffer.from(base64, "base64");
    } catch {
      return null;
    }
    if (bytes.byteLength === 0 || bytes.byteLength > RECAP_IMAGE_MAX_BYTES) {
      return null;
    }
    return isPngBuffer(bytes) ? bytes : null;
  }

  return isPngBuffer(raw) ? raw : null;
}

async function handleUpload(event: H3Event): Promise<unknown> {
  const session = await resolveUploadSession(event);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Authentication required" };
  }

  const png = await readPngFromRequest(event);
  if (!png) {
    setResponseStatus(event, 400);
    return {
      error:
        "Expected a PNG image (Content-Type: image/png raw bytes, or JSON { pngBase64 }), at most 5 MB.",
    };
  }

  try {
    const { token } = await saveRecapImage(png, { ownerEmail: session.email });
    const imageUrl = getAppUrl(
      event,
      `/_agent-native/recap-image/${token}.png`,
    );
    setResponseStatus(event, 201);
    return { imageUrl };
  } catch (error) {
    console.error("[recap-image] failed to store image:", error);
    setResponseStatus(event, 500);
    return { error: "Failed to store recap image" };
  }
}

/** GET/HEAD /_agent-native/recap-image/<token>.png — anonymous, content-only. */
async function handleServe(event: H3Event, segment: string): Promise<unknown> {
  const match = /^([0-9a-f]+)\.png$/i.exec(segment);
  const token = match?.[1]?.toLowerCase() ?? "";
  if (!isValidRecapImageToken(token)) {
    setResponseStatus(event, 404);
    return { error: "Not found" };
  }

  const stored = await getRecapImage(token).catch(() => null);
  if (!stored) {
    setResponseStatus(event, 404);
    return { error: "Not found" };
  }

  const headers: Record<string, string> = {
    "Content-Type": RECAP_IMAGE_CONTENT_TYPE,
    "Cache-Control": RECAP_IMAGE_CACHE_CONTROL,
    "CDN-Cache-Control": RECAP_IMAGE_CACHE_CONTROL,
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Content-Length": String(stored.bytes.byteLength),
  };
  for (const [name, value] of Object.entries(headers)) {
    setResponseHeader(event, name, value);
  }

  if (getMethod(event) === "HEAD") return "";

  const body = new ArrayBuffer(stored.bytes.byteLength);
  new Uint8Array(body).set(stored.bytes);
  return new Response(body, { headers });
}

export function createRecapImageHandler() {
  return defineEventHandler(async (event: H3Event) => {
    const segment =
      (event.url?.pathname || "").replace(/^\/+/, "").split("/")[0] || "";
    const method = getMethod(event);

    if (!segment) {
      if (method === "POST") return handleUpload(event);
      setResponseStatus(event, 405);
      setResponseHeader(event, "Allow", "POST");
      return { error: "Method not allowed" };
    }

    if (method === "GET" || method === "HEAD") {
      return handleServe(event, segment);
    }
    setResponseStatus(event, 405);
    setResponseHeader(event, "Allow", "GET, HEAD");
    return { error: "Method not allowed" };
  });
}
