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
 *     supplied via `?password=<pw>`, `?t=<token>`, or the protected media
 *     cookie renewed by this route — otherwise 401.
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
  getCookie,
  getRouterParam,
  getRequestHeader,
  getQuery,
  setResponseHeader,
  setResponseStatus,
  setCookie,
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
  captureRouteError,
  getSession,
  runWithRequestContext,
  signShortLivedToken,
  verifyShortLivedToken,
} from "@agent-native/core/server";
import {
  LOOM_START_MS_QUERY_PARAM,
  isLoomEmbedBackedRecording,
  loomEmbedUrlWithTimestamp,
  loomEmbedUrlForRecording,
} from "../../../../shared/loom.js";
import { verifySharePassword } from "../../../lib/share-password.js";
import { MAX_UPLOAD_BYTES } from "@shared/upload-limits.js";

// Message shared by every "the inline blob can't be served" branch below.
// The bytes still exist in application_state — they just need to be moved to a
// real storage provider (see the recover-sql-blob recovery path).
const STORAGE_REHOST_REQUIRED_MESSAGE =
  "This recording's media is too large to stream from temporary storage and needs to be reconnected to a storage provider.";

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
const PROVIDER_MEDIA_FETCH_TIMEOUT_MS = 30_000;
const PROTECTED_MEDIA_ACCESS_TTL_SECONDS = 6 * 60 * 60;
const PROTECTED_MEDIA_COOKIE_PREFIX = "clips_media_";

function appPath(path: string): string {
  if (!path.startsWith("/")) return path;
  const raw = process.env.VITE_APP_BASE_PATH || process.env.APP_BASE_PATH || "";
  const base = raw.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return base ? `/${base}${path}` : path;
}

function protectedMediaCookieName(recordingId: string): string {
  return `${PROTECTED_MEDIA_COOKIE_PREFIX}${recordingId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

function protectedMediaCookiePath(recordingId: string): string {
  return appPath(`/api/video/${encodeURIComponent(recordingId)}`);
}

function isHttpsRequest(event: H3Event): boolean {
  try {
    const xfProto = getRequestHeader(event, "x-forwarded-proto");
    if (xfProto && String(xfProto).split(",")[0].trim() === "https") {
      return true;
    }
    const appUrl = process.env.APP_URL || process.env.BETTER_AUTH_URL || "";
    if (appUrl.startsWith("https://")) return true;
  } catch {
    // keep plain-http dev behavior if request metadata is unavailable
  }
  return false;
}

function setProtectedMediaAccessCookie(
  event: H3Event,
  recordingId: string,
): void {
  const token = signShortLivedToken({
    resourceId: recordingId,
    ttlSeconds: PROTECTED_MEDIA_ACCESS_TTL_SECONDS,
  });
  const secure = isHttpsRequest(event);
  setCookie(event, protectedMediaCookieName(recordingId), token, {
    httpOnly: true,
    sameSite: secure ? "none" : "lax",
    secure,
    ...(secure ? { partitioned: true } : {}),
    path: protectedMediaCookiePath(recordingId),
    maxAge: PROTECTED_MEDIA_ACCESS_TTL_SECONDS,
  });
}

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

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      PROVIDER_MEDIA_FETCH_TIMEOUT_MS,
    );
    let upstream: Response;
    try {
      upstream = await fetch(currentUrl, {
        ...fetchOptions,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
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

function statusCodeForProviderFetchError(err: unknown): number {
  if (err instanceof Error && /^SSRF blocked:/i.test(err.message)) return 403;
  if (err instanceof Error && /abort|timeout/i.test(err.name)) return 504;
  return 502;
}

function messageForProviderFetchError(err: unknown): string {
  if (err instanceof Error && /^SSRF blocked:/i.test(err.message)) {
    return "Recording media URL is blocked by server safety policy.";
  }
  if (err instanceof Error && /abort|timeout/i.test(err.name)) {
    return "Recording media fetch timed out.";
  }
  return "Recording media could not be fetched.";
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
      //   - protected media cookie — preferred. It is httpOnly, scoped to this
      //     recording's video route, and renewed while playback/range requests
      //     continue.
      //   - `?t=<token>` — fallback for contexts that cannot use the cookie
      //     immediately. Minted by public-recording.get.ts after the password
      //     check passes; keeps the plaintext password out of the video URL.
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
        const cookieToken =
          getCookie(event, protectedMediaCookieName(recordingId)) ?? "";
        const supplied = typeof q.password === "string" ? q.password : "";

        let allowed = false;
        if (token) {
          const result = verifyShortLivedToken(token, recordingId);
          if (result.ok) allowed = true;
        }
        if (!allowed && cookieToken) {
          const result = verifyShortLivedToken(cookieToken, recordingId);
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
        setProtectedMediaAccessCookie(event, recordingId);
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

      // Legacy SQL fallback: older finalize-recording runs (before storage was
      // required in production) stashed a clip's bytes inline in
      // application_state under `recording-blob-:id` and pointed video_url at
      // this route. For large clips that base64 value can exceed V8's max
      // string length or the function's memory, so even reading it throws —
      // which surfaced as an unhandled 500 on every request (including range).
      // Fail with a clear, observable error instead. The bytes are still in the
      // DB; recovery is to rehost them to a configured storage provider.
      let blob: Record<string, unknown> | null = null;
      try {
        blob = await readAppState(`recording-blob-${recordingId}`);
      } catch (err) {
        captureRouteError(err, {
          route: "api/video",
          tags: { mediaPath: "sql-blob-read" },
          extra: { recordingId },
        });
        setResponseStatus(event, 503);
        setResponseHeader(
          event,
          "Cache-Control",
          "private, max-age=0, no-store",
        );
        return {
          error: STORAGE_REHOST_REQUIRED_MESSAGE,
          needsStorageRehost: true,
        };
      }
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

        let upstream: Response | { error: string; status: number };
        try {
          upstream = await fetchProviderMedia(sourceUrl, rangeHeader);
        } catch (err) {
          setResponseStatus(event, statusCodeForProviderFetchError(err));
          return { error: messageForProviderFetchError(err) };
        }
        if (!(upstream instanceof Response)) {
          setResponseStatus(event, upstream.status);
          return { error: upstream.error };
        }
        return providerResponse(upstream);
      }
      const mimeType =
        typeof blob?.mimeType === "string" ? blob.mimeType : "video/webm";

      // Guard before allocating: (b64.length * 3 / 4) approximates the decoded
      // byte count. A value past the upload ceiling can't be materialized
      // safely in a serverless function, so refuse it rather than risk an OOM.
      const approxBytes = Math.floor((b64.length * 3) / 4);
      if (approxBytes > MAX_UPLOAD_BYTES) {
        captureRouteError(
          new Error(
            `Inline recording blob too large to serve (~${approxBytes} bytes > ${MAX_UPLOAD_BYTES})`,
          ),
          {
            route: "api/video",
            tags: { mediaPath: "sql-blob-oversize" },
            extra: { recordingId, approxBytes, maxBytes: MAX_UPLOAD_BYTES },
          },
        );
        setResponseStatus(event, 413);
        setResponseHeader(
          event,
          "Cache-Control",
          "private, max-age=0, no-store",
        );
        return {
          error: STORAGE_REHOST_REQUIRED_MESSAGE,
          needsStorageRehost: true,
        };
      }

      let bytes: Buffer;
      try {
        bytes = Buffer.from(b64, "base64");
      } catch (err) {
        captureRouteError(err, {
          route: "api/video",
          tags: { mediaPath: "sql-blob-decode" },
          extra: { recordingId, base64Length: b64.length },
        });
        setResponseStatus(event, 503);
        setResponseHeader(
          event,
          "Cache-Control",
          "private, max-age=0, no-store",
        );
        return {
          error: STORAGE_REHOST_REQUIRED_MESSAGE,
          needsStorageRehost: true,
        };
      }
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
