import { defineEventHandler, createError } from "h3";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db/index.js";
import { schema } from "../../../../db/index.js";
import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";

export default defineEventHandler(async (event) => {
  const id = event.context.params!.id;
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }

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
      const ownerEmail = access.resource.ownerEmail as string;
      const db = getDb();

      const versions = await db
        .select()
        .from(schema.documentVersions)
        .where(
          and(
            eq(schema.documentVersions.documentId, id),
            eq(schema.documentVersions.ownerEmail, ownerEmail),
          ),
        )
        .orderBy(desc(schema.documentVersions.createdAt));

      return {
        versions: versions.map((v) => ({
          id: v.id,
          documentId: v.documentId,
          title: v.title,
          content: v.content,
          createdAt: v.createdAt,
        })),
      };
    },
  );
});
