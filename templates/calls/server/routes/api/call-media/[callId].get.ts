/**
 * Stream the call's media bytes.
 *
 * - If `calls.media_url` is a root-relative path (dev/local fallback), we
 *   read the assembled blob from app-state under `call-blob-:callId` and
 *   stream it with Range support.
 * - If `calls.media_url` is an external URL, we 302 the client to it so
 *   CDN/bucket handles the actual bytes.
 *
 * Access rules:
 *   - public visibility: anyone can fetch; if a password is set, it must
 *     match `x-password` header OR `?p=<pw>` query param (404 on mismatch
 *     to avoid leaking existence).
 *   - non-public: caller must have a share grant via `resolveAccess`. The
 *     password gate still applies for non-owner roles.
 *   - expired calls 410.
 *
 * Route: GET /api/call-media/:callId
 */

import {
  defineEventHandler,
  getRouterParam,
  getRequestHeader,
  getQuery,
  setResponseHeader,
  setResponseStatus,
  sendRedirect,
  type H3Event,
} from "h3";
import { readAppState } from "@agent-native/core/application-state";
import { resolveAccess } from "@agent-native/core/sharing";
import {
  getSession,
  runWithRequestContext,
  verifyShortLivedToken,
} from "@agent-native/core/server";

interface CallRow {
  mediaUrl?: string | null;
  mediaFormat?: string | null;
  mediaKind?: string | null;
  expiresAt?: string | null;
  password?: string | null;
  visibility?: string | null;
}

function parseRange(
  rangeHeader: string,
  total: number,
): { start: number; end: number } | "invalid" {
  if (!rangeHeader.startsWith("bytes=")) return "invalid";
  const spec = rangeHeader.slice(6).trim();

  let start: number;
  let end: number;
  if (spec.startsWith("-")) {
    const suffixLen = Number.parseInt(spec.slice(1), 10);
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) return "invalid";
    start = Math.max(0, total - suffixLen);
    end = total - 1;
  } else {
    const [startStr, endStr] = spec.split("-");
    start = Number.parseInt(startStr, 10);
    if (!Number.isFinite(start) || start < 0 || start >= total)
      return "invalid";
    if (endStr === "" || endStr === undefined) {
      end = total - 1;
    } else {
      const parsedEnd = Number.parseInt(endStr, 10);
      if (!Number.isFinite(parsedEnd) || parsedEnd < start) return "invalid";
      end = Math.min(parsedEnd, total - 1);
    }
  }
  return { start, end };
}

function mimeForFormat(format?: string | null, kind?: string | null): string {
  const f = (format || "").toLowerCase();
  if (f === "mp4") return kind === "audio" ? "audio/mp4" : "video/mp4";
  if (f === "webm") return kind === "audio" ? "audio/webm" : "video/webm";
  if (f === "mov") return "video/quicktime";
  if (f === "mp3") return "audio/mpeg";
  if (f === "m4a") return "audio/mp4";
  if (f === "wav") return "audio/wav";
  return kind === "audio" ? "audio/webm" : "video/webm";
}

export default defineEventHandler(async (event: H3Event) => {
  const session = await getSession(event).catch(() => null);
  return runWithRequestContext(
    { userEmail: session?.email, orgId: session?.orgId },
    async () => {
      const callId = getRouterParam(event, "callId");
      if (!callId) {
        setResponseStatus(event, 400);
        return { error: "Missing callId" };
      }

      const access = await resolveAccess("call", callId);
      if (!access) {
        setResponseStatus(event, 404);
        return { error: "Not found" };
      }
      const call = access.resource as CallRow;

      if (call.expiresAt) {
        const expires = new Date(call.expiresAt).getTime();
        if (Number.isFinite(expires) && expires < Date.now()) {
          setResponseStatus(event, 410);
          return { error: "Call has expired" };
        }
      }

      // Accepts either:
      //   - `?t=<token>` — preferred. Short-lived HMAC token minted by
      //     public-call.get.ts / public-snippet.get.ts after the password
      //     check passed; keeps the plaintext password out of the media
      //     URL (and therefore out of browser history / CDN logs / Referer
      //     headers).
      //   - `x-password` header / `?p=<pw>` / `?password=<pw>` — legacy
      //     fallback so existing share pages keep working during rollout.
      // (audit 11 F-07)
      if (call.password && access.role !== "owner") {
        const headerPassword = getRequestHeader(event, "x-password");
        const q = getQuery(event) as {
          p?: string;
          password?: string;
          t?: string;
        };
        const token = typeof q.t === "string" ? q.t : "";
        const supplied =
          (typeof headerPassword === "string" ? headerPassword : "") ||
          (typeof q.p === "string" ? q.p : "") ||
          (typeof q.password === "string" ? q.password : "");

        let allowed = false;
        if (token) {
          const result = verifyShortLivedToken(token, callId);
          if (result.ok) allowed = true;
        }
        if (!allowed && supplied && supplied === call.password) {
          allowed = true;
        }
        if (!allowed) {
          // 404, not 401 — don't leak existence to unauthenticated viewers.
          setResponseStatus(event, 404);
          return { error: "Not found" };
        }
      }

      const mediaUrl = call.mediaUrl ?? "";
      if (!mediaUrl) {
        setResponseStatus(event, 404);
        return { error: "Media not available" };
      }

      if (/^https?:\/\//i.test(mediaUrl)) {
        return sendRedirect(event, mediaUrl, 302);
      }

      // Local dev fallback — read the blob from app-state.
      const blob = await readAppState(`call-blob-${callId}`);
      const b64 = typeof blob?.data === "string" ? blob.data : null;
      if (!b64) {
        setResponseStatus(event, 404);
        return { error: "Blob not found" };
      }

      const mimeType =
        (typeof blob?.mimeType === "string" && blob.mimeType) ||
        mimeForFormat(call.mediaFormat, call.mediaKind);
      const bytes = Buffer.from(b64, "base64");
      const total = bytes.byteLength;

      setResponseHeader(event, "Content-Type", mimeType);
      setResponseHeader(event, "Accept-Ranges", "bytes");
      setResponseHeader(event, "Cache-Control", "private, max-age=0, no-store");
      // Don't leak the URL (which carries a short-lived token) into the
      // Referer of any outbound link rendered alongside the player.
      setResponseHeader(event, "Referrer-Policy", "no-referrer");

      const rangeHeader = getRequestHeader(event, "range");
      if (rangeHeader) {
        const parsed = parseRange(rangeHeader, total);
        if (parsed === "invalid") {
          setResponseStatus(event, 416);
          setResponseHeader(event, "Content-Range", `bytes */${total}`);
          return "";
        }
        const slice = bytes.subarray(parsed.start, parsed.end + 1);
        setResponseStatus(event, 206);
        setResponseHeader(
          event,
          "Content-Range",
          `bytes ${parsed.start}-${parsed.end}/${total}`,
        );
        setResponseHeader(event, "Content-Length", String(slice.byteLength));
        return slice;
      }

      setResponseHeader(event, "Content-Length", String(total));
      return bytes;
    },
  );
});
