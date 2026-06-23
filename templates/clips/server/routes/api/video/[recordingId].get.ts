/**
 * Serve recording media from same-origin.
 *
 * Dev fallback: when no file upload provider is configured, `finalize-recording`
 * stashes the assembled blob in `application_state` under
 * `recording-blob-:id` and points `recordings.video_url` at this route.
 *
 * Production fallback: the editor can also hit this route as an authenticated
 * media proxy for provider-hosted URLs (Builder.io / R2 / S3). This keeps
 * browser-only consumers such as Web Audio waveform decoding from being blocked
 * by cross-origin CDN fetches.
 *
 * Access rules (match `/api/public-recording.get.ts`):
 *   - public visibility: anyone can fetch, but a password (if set) must be
 *     supplied via `?password=<pw>` — otherwise 401.
 *   - non-public: caller must have a share grant (owner / viewer / editor /
 *     admin) via `resolveAccess`. Password is still enforced on top.
 *   - expired recordings 410.
 *
 * Lives under `/api/video/*` (not `/api/uploads/*`) so it can sit in
 * `auth.ts` publicPaths without exposing the chunk-upload POST endpoints.
 *
 * Supports HTTP Range requests (RFC 9110 §14.2):
 *   bytes=X-Y   → [X, Y]
 *   bytes=X-    → [X, total-1]
 *   bytes=-N    → [total-N, total-1]  (suffix range — last N bytes)
 * Oversized `end` is clamped to `total-1` rather than 416'd.
 *
 * Route: GET /api/video/:recordingId
 */

import {
  defineEventHandler,
  getRouterParam,
  getRequestHeader,
  getQuery,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";
import { readAppState } from "@agent-native/core/application-state";
import {
  createSsrfSafeDispatcher,
  isBlockedExtensionUrlWithDns,
} from "@agent-native/core/extensions/url-safety";
import { getOrgContext } from "@agent-native/core/org";
import { resolveAccess } from "@agent-native/core/sharing";
import {
  getSession,
  runWithRequestContext,
  verifyShortLivedToken,
} from "@agent-native/core/server";
import {
  LOOM_START_MS_QUERY_PARAM,
  isLoomEmbedBackedRecording,
  loomEmbedUrlWithTimestamp,
  loomEmbedUrlForRecording,
} from "../../../../shared/loom.js";
import { verifySharePassword } from "../../../lib/share-password.js";

interface RecordingRow {
  expiresAt?: string | null;
  password?: string | null;
  sourceAppName?: string | null;
  sourceWindowTitle?: string | null;
  videoUrl?: string | null;
  visibility?: string | null;
}

const PROXIED_HEADER_NAMES = [
  "accept-ranges",
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "last-modified",
] as const;

function isRecursiveVideoRouteUrl(value: string, recordingId: string): boolean {
  try {
    const parsed = new URL(value, "http://local.test");
    const expected = `/api/video/${encodeURIComponent(recordingId)}`;
    return parsed.pathname === expected || parsed.pathname.endsWith(expected);
  } catch {
    return false;
  }
}

async function fetchProviderMedia(
  sourceUrl: string,
  rangeHeader: string | undefined,
): Promise<Response | { error: string; status: number }> {
  let currentUrl = sourceUrl;
  const dispatcher = (await createSsrfSafeDispatcher()) ?? undefined;

  for (let redirects = 0; redirects <= 4; redirects++) {
    if (await isBlockedExtensionUrlWithDns(currentUrl)) {
      return {
        status: 403,
        error: "Recording media URL points to a private/internal address",
      };
    }

    const headers = new Headers();
    if (rangeHeader?.startsWith("bytes=")) headers.set("Range", rangeHeader);

    const fetchOptions: RequestInit & { dispatcher?: unknown } = {
      headers,
      redirect: "manual",
    };
    if (dispatcher) fetchOptions.dispatcher = dispatcher;

    const upstream = await fetch(currentUrl, fetchOptions);
    if (upstream.status < 300 || upstream.status >= 400) return upstream;

    const location = upstream.headers.get("location");
    if (!location) return upstream;
    currentUrl = new URL(location, currentUrl).href;
  }

  return { status: 508, error: "Too many media redirects" };
}

function providerResponse(upstream: Response): Response {
  const headers = new Headers();
  for (const name of PROXIED_HEADER_NAMES) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/octet-stream");
  }
  headers.set("Cache-Control", "private, max-age=0, no-store");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function loomEmbedResponse(embedUrl: string): Response {
  const safeEmbedUrl = escapeHtmlAttribute(embedUrl);
  const body = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Loom recording</title>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; background: #000; overflow: hidden; }
    iframe { display: block; width: 100%; height: 100%; border: 0; }
  </style>
</head>
<body>
  <iframe src="${safeEmbedUrl}" title="Loom video" allow="autoplay; fullscreen; picture-in-picture; clipboard-write" allowfullscreen referrerpolicy="no-referrer"></iframe>
</body>
</html>`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, max-age=0, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'none'; frame-src https://www.loom.com; style-src 'unsafe-inline'",
    },
  });
}

function firstQueryValue(value: unknown): string {
  if (Array.isArray(value)) return firstQueryValue(value[0]);
  return typeof value === "string" ? value : "";
}

function parseLoomStartMs(value: unknown): number | null {
  const raw = firstQueryValue(value).trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

export default defineEventHandler(async (event: H3Event) => {
  const recordingId = getRouterParam(event, "recordingId");
  if (!recordingId) {
    setResponseStatus(event, 400);
    return { error: "Missing recordingId" };
  }

  const session = await getSession(event).catch(() => null);
  const orgCtx = await getOrgContext(event).catch(() => null);
  const orgId = orgCtx?.orgId ?? session?.orgId ?? undefined;

  return runWithRequestContext(
    { userEmail: session?.email, orgId },
    async () => {
      const access = await resolveAccess("recording", recordingId);
      if (!access) {
        setResponseStatus(event, 403);
        return { error: "Forbidden" };
      }
      const rec = access.resource as RecordingRow;

      if (rec.expiresAt) {
        const expires = new Date(rec.expiresAt).getTime();
        if (Number.isFinite(expires) && expires < Date.now()) {
          setResponseStatus(event, 410);
          return { error: "Recording has expired" };
        }
      }

      // Password gate — owners skip it (they set it). Same behavior as
      // public-recording.get.ts so the two endpoints don't disagree.
      // Accepts either:
      //   - `?t=<token>` — preferred. Short-lived HMAC token minted by
      //     public-recording.get.ts after the password check passed; keeps
      //     the plaintext password out of the video URL (and therefore out
      //     of browser history / CDN logs / Referer headers).
      //   - `?password=<pw>` — legacy fallback so existing share pages /
      //     bookmarks keep working during rollout.
      // (audit 11 F-07)
      const q = getQuery(event) as {
        [LOOM_START_MS_QUERY_PARAM]?: unknown;
        password?: string;
        t?: string;
      };
      if (rec.password && access.role !== "owner") {
        const token = typeof q.t === "string" ? q.t : "";
        const supplied = typeof q.password === "string" ? q.password : "";

        let allowed = false;
        if (token) {
          const result = verifyShortLivedToken(token, recordingId);
          if (result.ok) allowed = true;
        }
        if (
          !allowed &&
          supplied &&
          verifySharePassword(supplied, rec.password)
        ) {
          allowed = true;
        }
        if (!allowed) {
          setResponseStatus(event, 401);
          return { error: "Password required", passwordRequired: true };
        }
      }

      if (isLoomEmbedBackedRecording(rec)) {
        let embedUrl = loomEmbedUrlForRecording(rec);
        if (!embedUrl) {
          setResponseStatus(event, 404);
          return { error: "Loom embed URL not found" };
        }
        const loomStartMs = parseLoomStartMs(q[LOOM_START_MS_QUERY_PARAM]);
        if (loomStartMs !== null) {
          embedUrl =
            loomEmbedUrlWithTimestamp(embedUrl, loomStartMs) ?? embedUrl;
        }
        return loomEmbedResponse(embedUrl);
      }

      const blob = await readAppState(`recording-blob-${recordingId}`);
      const b64 = typeof blob?.data === "string" ? blob.data : null;
      const rangeHeader = getRequestHeader(event, "range");

      if (!b64) {
        const sourceUrl = rec.videoUrl ?? "";
        if (!sourceUrl) {
          setResponseStatus(event, 404);
          return { error: "Blob not found" };
        }
        if (
          sourceUrl.startsWith("/") ||
          isRecursiveVideoRouteUrl(sourceUrl, recordingId)
        ) {
          setResponseStatus(event, 404);
          return { error: "Blob not found" };
        }

        const upstream = await fetchProviderMedia(sourceUrl, rangeHeader);
        if (!(upstream instanceof Response)) {
          setResponseStatus(event, upstream.status);
          return { error: upstream.error };
        }
        return providerResponse(upstream);
      }
      const mimeType =
        typeof blob?.mimeType === "string" ? blob.mimeType : "video/webm";
      const bytes = Buffer.from(b64, "base64");
      const total = bytes.byteLength;

      setResponseHeader(event, "Content-Type", mimeType);
      setResponseHeader(event, "X-Content-Type-Options", "nosniff");
      setResponseHeader(event, "Accept-Ranges", "bytes");
      setResponseHeader(event, "Cache-Control", "private, max-age=0, no-store");
      // Don't leak the URL (which carries a short-lived token) into the
      // Referer of any outbound link rendered alongside the player.
      setResponseHeader(event, "Referrer-Policy", "no-referrer");

      if (rangeHeader && rangeHeader.startsWith("bytes=")) {
        const spec = rangeHeader.slice(6).trim();
        let start: number;
        let end: number;

        if (spec.startsWith("-")) {
          // Suffix range: bytes=-N → last N bytes.
          const suffixLen = Number.parseInt(spec.slice(1), 10);
          if (!Number.isFinite(suffixLen) || suffixLen <= 0) {
            setResponseStatus(event, 416);
            setResponseHeader(event, "Content-Range", `bytes */${total}`);
            return "";
          }
          start = Math.max(0, total - suffixLen);
          end = total - 1;
        } else {
          const [startStr, endStr] = spec.split("-");
          start = Number.parseInt(startStr, 10);
          if (!Number.isFinite(start) || start < 0 || start >= total) {
            setResponseStatus(event, 416);
            setResponseHeader(event, "Content-Range", `bytes */${total}`);
            return "";
          }
          // Clamp oversized `end` to total-1 (RFC 9110 §14.1.2) instead of 416'ing.
          if (endStr === "" || endStr === undefined) {
            end = total - 1;
          } else {
            const parsedEnd = Number.parseInt(endStr, 10);
            if (!Number.isFinite(parsedEnd) || parsedEnd < start) {
              setResponseStatus(event, 416);
              setResponseHeader(event, "Content-Range", `bytes */${total}`);
              return "";
            }
            end = Math.min(parsedEnd, total - 1);
          }
        }

        const slice = bytes.subarray(start, end + 1);
        setResponseStatus(event, 206);
        setResponseHeader(
          event,
          "Content-Range",
          `bytes ${start}-${end}/${total}`,
        );
        setResponseHeader(event, "Content-Length", String(slice.byteLength));
        return slice;
      }

      setResponseHeader(event, "Content-Length", String(total));
      return bytes;
    },
  );
});
