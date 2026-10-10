import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import {
  defineEventHandler,
  getQuery,
  getRequestHeader,
  getRequestURL,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { isLocalFigmaQaUploadEnabled } from "../../lib/local-figma-qa-upload.js";
import {
  LocalNativeArtifactError,
  MAX_NATIVE_MP4_BYTES,
  MAX_NATIVE_DOCUMENT_BYTES,
  MAX_NATIVE_RASTER_BYTES,
  storeLocalNativeExportArtifact,
} from "../../lib/local-native-export-artifact.js";

let activeUploads = 0;

function fail(
  event: Parameters<typeof setResponseStatus>[0],
  status: number,
  code: string,
) {
  setResponseStatus(event, status);
  return { error: code };
}

async function readBoundedBody(
  request: AsyncIterable<Uint8Array>,
  declaredLength: number,
): Promise<Buffer | null> {
  const bytes = Buffer.allocUnsafe(declaredLength);
  let total = 0;
  for await (const chunk of request) {
    total += chunk.byteLength;
    if (total > declaredLength) return null;
    bytes.set(chunk, total - chunk.byteLength);
  }
  return total === declaredLength ? bytes : null;
}

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  if (!isLocalFigmaQaUploadEnabled()) return fail(event, 404, "not-found");

  const origin = getRequestHeader(event, "origin");
  const requestOrigin = getRequestURL(event).origin;
  if (!origin || origin !== requestOrigin) {
    return fail(event, 403, "origin-mismatch");
  }

  let session: Awaited<ReturnType<typeof getSession>>;
  try {
    session = await getSession(event);
  } catch {
    return fail(event, 503, "session-unreadable");
  }
  if (!session?.email) return fail(event, 401, "unauthorized");

  const designId = getQuery(event).designId;
  if (typeof designId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(designId)) {
    return fail(event, 400, "invalid-design-id");
  }

  const mimeType = getRequestHeader(event, "content-type")
    ?.split(";", 1)[0]
    ?.trim();
  if (
    ![
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/avif",
      "video/mp4",
      "image/svg+xml",
      "application/pdf",
      "application/zip",
      "text/html",
    ].includes(mimeType ?? "")
  ) {
    return fail(event, 415, "unsupported-format");
  }
  if (!mimeType) return fail(event, 415, "unsupported-format");
  const maxBytes =
    mimeType === "video/mp4"
      ? MAX_NATIVE_MP4_BYTES
      : [
            "image/svg+xml",
            "application/pdf",
            "application/zip",
            "text/html",
          ].includes(mimeType)
        ? MAX_NATIVE_DOCUMENT_BYTES
        : MAX_NATIVE_RASTER_BYTES;

  const rawLength = getRequestHeader(event, "content-length");
  const length = rawLength ? Number(rawLength) : Number.NaN;
  if (!Number.isSafeInteger(length) || length <= 0) {
    return fail(event, 411, "content-length-required");
  }
  if (length > maxBytes) return fail(event, 413, "artifact-too-large");

  return runWithRequestContext(
    { userEmail: session.email, orgId: session.orgId },
    async () => {
      try {
        await assertAccess("design", designId, "viewer");
      } catch (error) {
        return error instanceof ForbiddenError
          ? fail(event, 403, "design-access-denied")
          : fail(event, 503, "design-access-unreadable");
      }

      if (activeUploads >= 2) return fail(event, 503, "artifact-busy");
      activeUploads += 1;
      try {
        if (!event.node?.req) return fail(event, 503, "request-unreadable");
        const request = event.node.req;
        const deadline = setTimeout(() => {
          request.destroy(new Error("artifact-upload-timeout"));
        }, 120_000);
        deadline.unref();
        let raw: Buffer | null;
        try {
          raw = await readBoundedBody(request, length);
        } catch {
          return fail(event, 503, "request-unreadable");
        } finally {
          clearTimeout(deadline);
        }
        if (!raw) {
          return fail(event, 400, "content-length-mismatch");
        }
        try {
          return await storeLocalNativeExportArtifact({
            email: session.email,
            designId,
            mimeType,
            bytes: raw,
          });
        } catch (error) {
          if (error instanceof LocalNativeArtifactError) {
            const status =
              error.code === "storage-capacity"
                ? 507
                : error.code === "invalid-size"
                  ? 413
                  : error.code === "invalid-format"
                    ? 415
                    : 503;
            return fail(event, status, error.code);
          }
          return fail(event, 503, "storage-unavailable");
        }
      } finally {
        activeUploads -= 1;
      }
    },
  );
});
