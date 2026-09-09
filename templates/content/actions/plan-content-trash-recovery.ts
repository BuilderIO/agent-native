import { defineAction } from "@agent-native/core/action";
import { accessFilter, resolveAccess } from "@agent-native/core/sharing";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { collectTrashRecoveryScope } from "./_trash-recovery-scope.js";

export default defineAction({
  description:
    "Inspect the exact authorized page subtree selected for Trash recovery or permanent deletion. Preserve the returned scopeToken when confirming the operation.",
  schema: z.object({
    id: z.string().describe("Selected trashed page ID"),
    operation: z
      .enum(["restore", "purge"])
      .optional()
      .describe(
        "Plan restore with its operation-specific permissions, or purge (the default) requiring management access.",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ id, operation = "purge" }) => {
    const scope = await collectTrashRecoveryScope(getDb(), id, operation);
    const parent = scope.root.parentId
      ? await resolveAccess("document", scope.root.parentId)
      : null;
    const needsDestination =
      !!scope.root.parentId && (!parent || !!parent.resource.trashedAt);
    const destinations = scope.requiresOriginalDestination
      ? []
      : await getDb()
          .select({ id: schema.documents.id, title: schema.documents.title })
          .from(schema.documents)
          .where(
            and(
              isNull(schema.documents.trashedAt),
              eq(schema.documents.ownerEmail, scope.root.ownerEmail),
              scope.root.spaceId
                ? eq(schema.documents.spaceId, scope.root.spaceId)
                : isNull(schema.documents.spaceId),
              scope.root.orgId
                ? eq(schema.documents.orgId, scope.root.orgId)
                : isNull(schema.documents.orgId),
              accessFilter(
                schema.documents,
                schema.documentShares,
                undefined,
                "editor",
              ),
              sql`${schema.documents.id} <> ${id}`,
            ),
          )
          .orderBy(asc(schema.documents.title), asc(schema.documents.id))
          .limit(51);
    return {
      documentId: id,
      affectedDocumentIds: scope.documentIds,
      affectedDatabaseIds: scope.ownedDatabaseIds,
      detachedDocumentIds: scope.detachedDocumentIds,
      scopeToken: scope.token,
      needsDestination,
      requiresOriginalDestination: scope.requiresOriginalDestination,
      destinations: destinations.slice(0, 50),
      hasMoreDestinations: destinations.length > 50,
    };
  },
});
