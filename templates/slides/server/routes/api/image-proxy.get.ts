import { getSession } from "@agent-native/core/server";
import { defineEventHandler, getQuery, setResponseStatus } from "h3";

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
 * This is an authenticated, image-only, size-capped fetcher — not a general
 * proxy. See `fetch-remote-image.ts` for the address pinning that keeps it
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

export default defineEventHandler(async (event) => {
  const session = await getSession(event);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  const raw = getQuery(event).url;
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
  event.node?.res?.setHeader("Cache-Control", "private, max-age=3600");
  // The canvas reads these pixels back, so the response must be explicitly
  // usable cross-origin even though it is served from our own host.
  event.node?.res?.setHeader("Access-Control-Allow-Origin", "*");
  return result.body;
});
