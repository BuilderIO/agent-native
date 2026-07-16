import { randomUUID } from "node:crypto";

import { putPrivateBlob } from "@agent-native/core/private-blob";
import {
  getConfiguredAppBasePath,
  getSession,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import {
  defineEventHandler,
  getHeader,
  readMultipartFormData,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { getDb, schema } from "../../../db/index.js";
import {
  DOCUMENT_MEDIA_MAX_BYTES,
  documentMediaUrl,
  isSupportedDocumentMediaType,
  safeDocumentMediaFilename,
  serializePrivateBlobHandle,
} from "../../../lib/document-media.js";

function mediaError(
  event: Parameters<typeof setResponseStatus>[0],
  status: number,
  requestId: string,
  explicitCode?: string,
) {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  setResponseStatus(event, status);
  const code =
    explicitCode ??
    (status === 401
      ? "MEDIA_AUTH_REQUIRED"
      : status === 403
        ? "MEDIA_ACCESS_DENIED"
        : status === 400
          ? "MEDIA_INVALID_UPLOAD"
          : status === 503
            ? "MEDIA_STORAGE_UNAVAILABLE"
            : "MEDIA_UPLOAD_FAILED");
  return {
    error:
      status === 401
        ? "Unauthorized"
        : status === 403
          ? "Forbidden"
          : status === 400
            ? "Invalid media upload"
            : "Media upload unavailable",
    code,
    requestId,
  };
}

type MediaUploadStage = "access" | "provider" | "database";

function hasFirstPartyCsrfMarker(
  event: Parameters<typeof getHeader>[0],
): boolean {
  const explicit = getHeader(event, "x-agent-native-csrf");
  if (typeof explicit === "string" && explicit.trim()) return true;
  // Browsers attach this forbidden-to-script header automatically. Accepting
  // it keeps the existing multipart editor upload working without weakening
  // the same-origin requirement.
  return getHeader(event, "sec-fetch-site") === "same-origin";
}

function boundedErrorClass(error: unknown): string {
  if (!error || typeof error !== "object") return "unavailable";
  const candidate = Number(
    "statusCode" in error
      ? error.statusCode
      : "status" in error
        ? error.status
        : 500,
  );
  if (candidate === 401 || candidate === 403) return "rejected";
  if (candidate === 408) return "timeout";
  if (candidate === 429) return "rate-limited";
  if (candidate >= 500 && candidate <= 599) return "upstream-unavailable";
  return "unexpected";
}

function logUploadFailure(
  requestId: string,
  stage: MediaUploadStage,
  error: unknown,
  diagnostics: Record<string, boolean | number | string> = {},
) {
  // Content-free diagnostics only: never log document ids, filenames, users,
  // provider handles, URLs, error messages, or response bodies.
  console.error("[content:document-media] upload failed", {
    requestId,
    stage,
    errorClass: boundedErrorClass(error),
    ...diagnostics,
  });
}

function accessFailureClass(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  if (error.message.startsWith("No access to ")) return "no-access";
  if (error.message.startsWith("Requires ")) return "insufficient-role";
  return "other";
}

export default defineEventHandler(async (event) => {
  const requestId = randomUUID();
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  setResponseHeader(event, "X-Agent-Native-Media-Request-Id", requestId);
  // This custom multipart route lives outside /_agent-native, so the shared
  // CSRF middleware does not cover it. Require the same first-party marker the
  // browser action client uses before accepting a cookie-authenticated write.
  if (!hasFirstPartyCsrfMarker(event)) {
    return mediaError(event, 403, requestId, "MEDIA_CSRF_REQUIRED");
  }
  const session = await getSession(event).catch(() => null);
  if (!session?.email) return mediaError(event, 401, requestId);
  const parts = await readMultipartFormData(event);
  const file = parts?.find((part) => part.name === "file" && part.data);
  const documentId = parts
    ?.find((part) => part.name === "documentId")
    ?.data.toString();
  if (!file || !documentId) return mediaError(event, 400, requestId);
  const mimeType = (file.type ?? "").toLowerCase();
  if (
    !isSupportedDocumentMediaType(mimeType) ||
    file.data.byteLength > DOCUMENT_MEDIA_MAX_BYTES
  ) {
    return mediaError(event, 400, requestId);
  }

  let access: Awaited<ReturnType<typeof assertAccess>>;
  try {
    access = await assertAccess("document", documentId, "editor", {
      userEmail: session.email,
      orgId: session.orgId,
    });
  } catch (error) {
    logUploadFailure(requestId, "access", error, {
      accessFailureClass: accessFailureClass(error),
      identifierLength: documentId.length,
    });
    return mediaError(event, 403, requestId);
  }

  let handle: Awaited<ReturnType<typeof putPrivateBlob>>;
  try {
    handle = await putPrivateBlob({
      data: file.data,
      filename: safeDocumentMediaFilename(file.filename),
      mimeType,
      ownerEmail: session.email,
      metadata: { documentId },
    });
  } catch (error) {
    logUploadFailure(requestId, "provider", error);
    return mediaError(event, 503, requestId);
  }
  if (!handle) {
    logUploadFailure(requestId, "provider", null);
    return mediaError(event, 503, requestId);
  }

  const id = randomUUID();
  try {
    await getDb()
      .insert(schema.documentMedia)
      .values({
        id,
        documentId,
        ownerEmail: access.resource.ownerEmail,
        orgId: access.resource.orgId,
        blobHandleJson: serializePrivateBlobHandle(handle),
        mimeType,
        size: file.data.byteLength,
        filename: safeDocumentMediaFilename(file.filename),
      });
  } catch (error) {
    const { deletePrivateBlob } =
      await import("@agent-native/core/private-blob");
    await deletePrivateBlob(handle).catch(() => undefined);
    logUploadFailure(requestId, "database", error);
    return mediaError(event, 500, requestId);
  }

  return { url: documentMediaUrl(id, getConfiguredAppBasePath()) };
});
