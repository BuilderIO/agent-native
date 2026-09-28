import { getSession, runWithRequestContext } from "@agent-native/core/server";
import {
  createError,
  defineEventHandler,
  getHeader,
  readMultipartFormData,
  setResponseHeader,
} from "h3";

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
  const contentLength = Number(getHeader(event, "content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_ICON_BYTES + 64_000
  ) {
    throw createError({
      statusCode: 413,
      statusMessage: "Private icon is too large",
    });
  }
  const parts = await readMultipartFormData(event);
  const file = parts?.find((part) => part.name === "file" && part.filename);
  const documentIds = parts?.filter((part) => part.name === "documentId");
  const documentId =
    documentIds?.length === 1
      ? new TextDecoder().decode(documentIds[0]!.data).trim()
      : "";
  if (!documentId || documentId.length > 128) {
    throw createError({
      statusCode: 400,
      statusMessage: "A target Content document is required",
    });
  }
  if (
    !file ||
    !file.data.length ||
    file.data.length > MAX_ICON_BYTES ||
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
          data: new Uint8Array(file.data),
          mimeType: file.type!,
          filename: file.filename,
          ownerEmail: session.email,
          orgId,
        }),
      };
    },
  );
});
