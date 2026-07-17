import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { createError, defineEventHandler, getRouterParam } from "h3";

import restoreDocumentVersion from "../../../../../../actions/restore-document-version.js";

export default defineEventHandler(async (event) => {
  const documentId = getRouterParam(event, "id");
  const versionId = getRouterParam(event, "versionId");
  if (!documentId || !versionId) {
    throw createError({
      statusCode: 400,
      statusMessage: "document and version IDs are required",
    });
  }
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  return runWithRequestContext(
    { userEmail: session.email, orgId: session.orgId },
    () =>
      restoreDocumentVersion.run(
        { documentId, versionId },
        {
          caller: "http",
          actionName: "restore-document-version",
          userEmail: session.email,
          orgId: session.orgId,
        },
      ),
  );
});
