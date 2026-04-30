/**
 * Serve the assembled video blob for a recording — dev-only fallback when no
 * file upload provider is configured. `finalize-recording` stashes the blob
 * in `application_state` under `recording-blob-:id` and points
 * `recordings.video_url` at this route.
 *
 * Production deployments register a real provider (Builder.io / R2 / S3) and
 * `video_url` points directly at that — this route never gets hit.
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
import { resolveAccess } from "@agent-native/core/sharing";
import { getSession, runWithRequestContext } from "@agent-native/core/server";

interface RecordingRow {
  expiresAt?: string | null;
  password?: string | null;
  visibility?: string | null;
}

export default defineEventHandler(async (event: H3Event) => {
  const recordingId = getRouterParam(event, "recordingId");
  if (!recordingId) {
    setResponseStatus(event, 400);
    return { error: "Missing recordingId" };
  }

  const session = await getSession(event).catch(() => null);

  return runWithRequestContext(
    { userEmail: session?.email, orgId: session?.orgId },
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
      if (rec.password && access.role !== "owner") {
        const q = getQuery(event) as { password?: string };
        const supplied = typeof q.password === "string" ? q.password : "";
        if (!supplied || supplied !== rec.password) {
          setResponseStatus(event, 401);
          return { error: "Password required", passwordRequired: true };
        }
      }

      const blob = await readAppState(`recording-blob-${recordingId}`);
      const b64 = typeof blob?.data === "string" ? blob.data : null;
      if (!b64) {
        setResponseStatus(event, 404);
        return { error: "Blob not found" };
      }
      const mimeType =
        typeof blob?.mimeType === "string" ? blob.mimeType : "video/webm";
      const bytes = Buffer.from(b64, "base64");
      const total = bytes.byteLength;

      setResponseHeader(event, "Content-Type", mimeType);
      setResponseHeader(event, "X-Content-Type-Options", "nosniff");
      setResponseHeader(event, "Accept-Ranges", "bytes");
      setResponseHeader(event, "Cache-Control", "private, max-age=0, no-store");

      const rangeHeader = getRequestHeader(event, "range");
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
