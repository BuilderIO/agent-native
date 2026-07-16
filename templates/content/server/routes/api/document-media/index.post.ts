import { randomUUID } from "node:crypto";

import { putPrivateBlob } from "@agent-native/core/private-blob";
import {
  getConfiguredAppBasePath,
  getSession,
  runWithRequestContext,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { createError, defineEventHandler, readMultipartFormData } from "h3";

import { getDb, schema } from "../../../db/index.js";
import {
  DOCUMENT_MEDIA_MAX_BYTES,
  documentMediaUrl,
  isSupportedDocumentMediaType,
  safeDocumentMediaFilename,
  serializePrivateBlobHandle,
} from "../../../lib/document-media.js";

export default defineEventHandler(async (event) => {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) throw createError({ statusCode: 401 });
  const parts = await readMultipartFormData(event);
  const file = parts?.find((part) => part.name === "file" && part.data);
  const documentId = parts
    ?.find((part) => part.name === "documentId")
    ?.data.toString();
  if (!file || !documentId)
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid media upload",
    });
  const mimeType = (file.type ?? "").toLowerCase();
  if (
    !isSupportedDocumentMediaType(mimeType) ||
    file.data.byteLength > DOCUMENT_MEDIA_MAX_BYTES
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: "Unsupported media upload",
    });
  }

  return runWithRequestContext(
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
      if (!handle)
        throw createError({
          statusCode: 503,
          statusMessage: "Private media storage is unavailable",
        });
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
});
