import { getSession } from "@agent-native/core/server";
import { defineEventHandler, getQuery, setResponseStatus } from "h3";

import {
  MAX_PROXIED_IMAGE_BYTES,
  MAX_PROXY_REDIRECTS,
  parseProxyableImageUrl,
  resolvesToPublicAddress,
} from "../../lib/image-proxy-url.js";

/**
 * Re-serve a remote image from our own origin.
 *
 * PDF/PPTX export rasterizes the slide DOM through a canvas, and the browser
 * blanks out any image whose host does not send `Access-Control-Allow-Origin`.
 * No client-side flag can override that, so images on hosts without CORS have
 * to come back through us to be same-origin.
 *
 * This is an authenticated, image-only, size-capped fetcher — not a general
 * proxy. Every hop is re-validated so a redirect cannot walk it onto an
 * internal address.
 */
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

  const initialTarget = parseProxyableImageUrl(raw);
  if (!initialTarget) {
    setResponseStatus(event, 400);
    return { error: "Unsupported image URL" };
  }
  let target: URL = initialTarget;

  let response: Response | null = null;
  for (let hop = 0; hop <= MAX_PROXY_REDIRECTS; hop++) {
    if (!(await resolvesToPublicAddress(target.hostname))) {
      setResponseStatus(event, 400);
      return { error: "Unsupported image URL" };
    }

    let hopResponse: Response;
    try {
      hopResponse = await fetch(target, {
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
        headers: { Accept: "image/*" },
      });
    } catch {
      setResponseStatus(event, 502);
      return { error: "Could not fetch image" };
    }

    if (hopResponse.status >= 300 && hopResponse.status < 400) {
      const location = hopResponse.headers.get("location");
      const next: URL | null = location
        ? parseProxyableImageUrl(new URL(location, target).href)
        : null;
      if (!next) {
        setResponseStatus(event, 502);
        return { error: "Could not fetch image" };
      }
      target = next;
      continue;
    }

    response = hopResponse;
    break;
  }

  if (!response) {
    setResponseStatus(event, 502);
    return { error: "Too many redirects" };
  }

  if (!response.ok) {
    setResponseStatus(event, 502);
    return { error: "Could not fetch image" };
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    setResponseStatus(event, 415);
    return { error: "Not an image" };
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_PROXIED_IMAGE_BYTES
  ) {
    setResponseStatus(event, 413);
    return { error: "Image too large" };
  }

  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength > MAX_PROXIED_IMAGE_BYTES) {
    setResponseStatus(event, 413);
    return { error: "Image too large" };
  }

  event.node?.res?.setHeader("Content-Type", contentType);
  event.node?.res?.setHeader("Content-Length", String(body.byteLength));
  event.node?.res?.setHeader("Cache-Control", "private, max-age=3600");
  // The canvas reads these pixels back, so the response must be explicitly
  // usable cross-origin even though it is served from our own host.
  event.node?.res?.setHeader("Access-Control-Allow-Origin", "*");
  return body;
});
