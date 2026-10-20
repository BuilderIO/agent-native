import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { createError, defineEventHandler, readBody } from "h3";

import restoreDocumentVersion from "../../../../../../actions/restore-document-version.js";

export default defineEventHandler(async (event) => {
  const { id, versionId } = event.context.params!;
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  const body = await readBody<{ expectedUpdatedAt?: unknown }>(event);
  if (
    !body ||
    typeof body.expectedUpdatedAt !== "string" ||
    !body.expectedUpdatedAt
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: "expectedUpdatedAt is required",
    });
  }

  return runWithRequestContext(
    { userEmail: session.email, orgId: session.orgId },
    () =>
      restoreDocumentVersion.run(
        {
          documentId: id,
          versionId,
          expectedUpdatedAt: body.expectedUpdatedAt as string,
        },
        {
          caller: "http",
          userEmail: session.email,
          orgId: session.orgId,
          actionName: "restore-document-version",
        },
      ),
  );
});
