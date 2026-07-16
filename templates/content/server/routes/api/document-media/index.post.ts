import { randomUUID } from "node:crypto";

import { putPrivateBlob } from "@agent-native/core/private-blob";
import {
  getConfiguredAppBasePath,
  getSession,
  runWithRequestContext,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import {
  defineEventHandler,
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
) {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  setResponseStatus(event, status);
  return {
    error:
      status === 401
        ? "Unauthorized"
        : status === 403
          ? "Forbidden"
          : status === 400
            ? "Invalid media upload"
            : "Media upload unavailable",
  };
}

function errorStatus(error: unknown): number {
  if (!error || typeof error !== "object") return 500;
  const candidate = Number(
    "statusCode" in error
      ? error.statusCode
      : "status" in error
        ? error.status
        : 500,
  );
  return Number.isInteger(candidate) && candidate >= 400 && candidate <= 599
    ? candidate
    : 500;
}

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
  const session = await getSession(event).catch(() => null);
  if (!session?.email) return mediaError(event, 401);
  const parts = await readMultipartFormData(event);
  const file = parts?.find((part) => part.name === "file" && part.data);
  const documentId = parts
    ?.find((part) => part.name === "documentId")
    ?.data.toString();
  if (!file || !documentId) return mediaError(event, 400);
  const mimeType = (file.type ?? "").toLowerCase();
  if (
    !isSupportedDocumentMediaType(mimeType) ||
    file.data.byteLength > DOCUMENT_MEDIA_MAX_BYTES
  ) {
    return mediaError(event, 400);
  }

  try {
    return await runWithRequestContext(
      { userEmail: session.email, orgId: session.orgId },
      async () => {
        const access = await assertAccess("document", documentId, "editor");
        const handle = await putPrivateBlob({
          data: file.data,
          filename: safeDocumentMediaFilename(file.filename),
          mimeType,
          ownerEmail: session.email,
          metadata: { documentId },
        });
        if (!handle) return mediaError(event, 503);
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
          throw error;
        }
        return { url: documentMediaUrl(id, getConfiguredAppBasePath()) };
      },
    );
  } catch (error) {
    return mediaError(event, errorStatus(error));
  }
});
