import { getSession } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { defineEventHandler, getQuery, setResponseStatus } from "h3";

import { getDb, schema } from "../../db";
import {
  fetchRemoteImage,
  type RemoteImageFailure,
} from "../../lib/fetch-remote-image.js";

/**
 * Re-serve a remote image from our own origin.
 *
 * PDF/PPTX export rasterizes the slide DOM through a canvas, and the browser
 * blanks out any image whose host does not send `Access-Control-Allow-Origin`.
 * No client-side flag can override that, so images on hosts without CORS have
 * to come back through us to be same-origin.
 *
 * This is an image-only, size-capped fetcher — not a general proxy. Editor
 * requests use the session; public shared presentations use their live share
 * token. See `fetch-remote-image.ts` for the address pinning that keeps it
 * from being turned into an SSRF primitive.
 */
const FAILURE_STATUS: Record<RemoteImageFailure, number> = {
  "unsupported-url": 400,
  "blocked-address": 400,
  "fetch-failed": 502,
  "too-many-redirects": 502,
  "not-an-image": 415,
  "too-large": 413,
};

const FAILURE_MESSAGE: Record<RemoteImageFailure, string> = {
  "unsupported-url": "Unsupported image URL",
  "blocked-address": "Unsupported image URL",
  "fetch-failed": "Could not fetch image",
  "too-many-redirects": "Too many redirects",
  "not-an-image": "Not an image",
  "too-large": "Image too large",
};

const SHARED_IMAGE_PATTERN =
  /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi;

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .trim();
}

function normalizeImageUrl(value: string): string {
  const decoded = decodeHtmlAttribute(value);
  try {
    return new URL(decoded).href;
  } catch {
    return decoded;
  }
}

export function sharedDeckContainsImage(
  slidesJson: string,
  requestedUrl: string,
): boolean {
  let slides: unknown;
  try {
    slides = JSON.parse(slidesJson);
  } catch {
    // coercion-ok: malformed persisted share snapshots cannot authorize proxy access.
    return false;
  }
  if (!Array.isArray(slides)) return false;

  const requested = normalizeImageUrl(requestedUrl);
  return slides.some((slide) => {
    if (!slide || typeof slide !== "object" || Array.isArray(slide)) {
      return false;
    }
    const content = (slide as { content?: unknown }).content;
    if (typeof content !== "string") return false;
    for (const match of content.matchAll(SHARED_IMAGE_PATTERN)) {
      const source = match[1] ?? match[2];
      if (source && normalizeImageUrl(source) === requested) return true;
    }
    return false;
  });
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const shareToken = query.shareToken;
  const raw = query.url;
  let publicShare = false;
  if (typeof shareToken === "string" && shareToken) {
    const [shared] = await getDb()
      .select({
        createdAt: schema.deckShareLinks.createdAt,
        slides: schema.deckShareLinks.slides,
      })
      .from(schema.deckShareLinks)
      .where(eq(schema.deckShareLinks.token, shareToken))
      .limit(1);
    const isLive =
      Boolean(shared) &&
      Date.now() - new Date(shared.createdAt).getTime() <=
        30 * 24 * 60 * 60 * 1000;
    if (!shared || !isLive || typeof raw !== "string") {
      setResponseStatus(event, 404);
      return { error: "Shared presentation not found or has expired" };
    }
    if (!sharedDeckContainsImage(shared.slides, raw)) {
      setResponseStatus(event, 404);
      return { error: "Image is not part of the shared presentation" };
    }
    publicShare = true;
  } else {
    const session = await getSession(event);
    if (!session?.email) {
      setResponseStatus(event, 401);
      return { error: "Unauthorized" };
    }
  }

  if (typeof raw !== "string") {
    setResponseStatus(event, 400);
    return { error: "Missing url" };
  }

  const result = await fetchRemoteImage(raw);
  if (!result.ok) {
    setResponseStatus(event, FAILURE_STATUS[result.reason]);
    return { error: FAILURE_MESSAGE[result.reason] };
  }

  event.node?.res?.setHeader("Content-Type", result.contentType);
  event.node?.res?.setHeader("Content-Length", String(result.body.byteLength));
  event.node?.res?.setHeader(
    "Cache-Control",
    publicShare ? "private, no-store" : "private, max-age=3600",
  );
  // The canvas reads these pixels back, so the response must be explicitly
  // usable cross-origin even though it is served from our own host.
  event.node?.res?.setHeader("Access-Control-Allow-Origin", "*");
  return result.body;
});
