import { createError, defineEventHandler } from "h3";
import { refreshDocumentSyncStatus } from "../../../../../lib/notion-sync.js";
import {
  getSession,
  readBody,
  runWithRequestContext,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";

export default defineEventHandler(async (event) => {
  const id = event.context.params!.id;
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  const body = await readBody(event).catch(() => ({}));
  return runWithRequestContext(
    { userEmail: session.email, orgId: session.orgId },
    async () => {
      const access = await assertAccess("document", id, "viewer").catch(
        () => null,
      );
      if (!access) {
        throw createError({
          statusCode: 404,
          statusMessage: "Document not found",
        });
      }
      return refreshDocumentSyncStatus(
        access.resource.ownerEmail as string,
        id,
        {
          autoSync: !!body?.autoSync,
        },
      );
    },
  );
});
