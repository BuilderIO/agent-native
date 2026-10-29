import {
  PrivateMediaStorageUnavailableError,
  PrivateMediaValidationError,
  putPrivateMedia,
  readPrivateMediaUploadFormData,
} from "@agent-native/core/private-media";
import { getSession, runWithRequestContext } from "@agent-native/core/server";
import {
  createError,
  defineEventHandler,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { resolveEditablePrivateIconOrgId } from "../../lib/private-icon-target.js";
import {
  bindUploadedPrivateMedia,
  privateMediaPath,
} from "../../lib/private-media-references.js";

/**
 * Uploads an image into a page the caller can edit. The image is stored
 * privately and only the page's readers (and the uploader) can load it.
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  const session = await getSession(event);
  if (!session?.email)
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  try {
    const form = await readPrivateMediaUploadFormData(event.req);
    const file = form
      .getAll("file")
      .find((part): part is File => typeof part !== "string");
    const documentIds = form.getAll("documentId");
    const documentId =
      documentIds.length === 1 && typeof documentIds[0] === "string"
        ? documentIds[0].trim()
        : "";
    if (!documentId || documentId.length > 128) {
      throw createError({
        statusCode: 400,
        statusMessage: "A target Content document is required",
      });
    }
    if (!file) {
      throw createError({
        statusCode: 400,
        statusMessage: "No image uploaded",
      });
    }
    return await runWithRequestContext(
      { userEmail: session.email, orgId: session.orgId },
      async () => {
        const orgId = await resolveEditablePrivateIconOrgId(documentId);
        const media = await putPrivateMedia({
          ownerEmail: session.email,
          orgId,
          data: new Uint8Array(await file.arrayBuffer()),
          mimeType: file.type,
          filename: file.name,
        });
        await bindUploadedPrivateMedia({ documentId, mediaId: media.id });
        setResponseStatus(event, 201);
        return { id: media.id, url: privateMediaPath(media.id) };
      },
    );
  } catch (error) {
    if (error instanceof PrivateMediaValidationError) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: error.message,
      });
    }
    if (error instanceof PrivateMediaStorageUnavailableError) {
      throw createError({ statusCode: 503, statusMessage: error.message });
    }
    throw error;
  }
});
