import {
  IconUploadBodyError,
  readIconUploadFormData,
} from "@agent-native/core/icon-assets";
import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { createError, defineEventHandler, setResponseHeader } from "h3";

import { uploadPrivateIcon } from "../../lib/private-icon-authority.js";
import { resolveEditablePrivateIconOrgId } from "../../lib/private-icon-target.js";

const MAX_ICON_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);

export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  const session = await getSession(event);
  if (!session?.email)
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  const form = await readIconUploadFormData(event.req).catch(
    (error: unknown) => {
      if (error instanceof IconUploadBodyError) {
        throw createError({
          statusCode: error.statusCode,
          cause: error,
          statusMessage:
            error.statusCode === 413
              ? "Private icon is too large"
              : error.message,
        });
      }
      throw error;
    },
  );
  const file = form
    .getAll("file")
    .find((part) => typeof part !== "string" && part.name);
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
  if (
    !file ||
    typeof file === "string" ||
    !file.size ||
    file.size > MAX_ICON_BYTES ||
    !file.type ||
    !IMAGE_TYPES.has(file.type)
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: "A PNG, JPEG, WebP, or SVG icon under 5 MB is required",
    });
  }
  return runWithRequestContext(
    { userEmail: session.email, orgId: session.orgId },
    async () => {
      const orgId = await resolveEditablePrivateIconOrgId(documentId);
      return {
        id: await uploadPrivateIcon({
          data: new Uint8Array(await file.arrayBuffer()),
          mimeType: file.type!,
          filename: file.name,
          ownerEmail: session.email,
          orgId,
        }),
      };
    },
  );
});
