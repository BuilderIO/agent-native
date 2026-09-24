import { resolveAccess } from "@agent-native/core/sharing";

import { schema } from "../server/db/index.js";
import type {
  ContentDatabaseMutationContract,
  ContentDatabaseSetupContract,
} from "../shared/api.js";
import { ordinaryPropertyTypes } from "./_database-property-setup.js";
import { parseDatabaseViewConfig } from "./_property-utils.js";

export async function getDatabaseSetupContract(
  database: typeof schema.contentDatabases.$inferSelect,
  mutationContract: ContentDatabaseMutationContract,
): Promise<ContentDatabaseSetupContract> {
  const access = await resolveAccess("document", database.documentId);
  const role = access?.role;
  const canEdit = role === "editor" || role === "admin" || role === "owner";
  const target = {
    spaceId: mutationContract.target.spaceId,
    databaseId: database.id,
    databaseDocumentId: database.documentId,
  };
  const databaseUrl = `/page/${encodeURIComponent(database.documentId)}`;
  return {
    target,
    databaseUrl,
    viewUrls: (
      parseDatabaseViewConfig(database.viewConfigJson).views ?? []
    ).map((view) => ({
      viewId: view.id,
      url: `${databaseUrl}?viewId=${encodeURIComponent(view.id)}`,
    })),
    supportedPropertyTypes: [...ordinaryPropertyTypes],
    canEditSchema: canEdit,
    canEditViews: canEdit,
    canManageLifecycle:
      (role === "admin" || role === "owner") && !database.ownerDocumentId,
    sourceComposition: "unsupported",
    properties: mutationContract.properties.map((property) => {
      const ordinary = ordinaryPropertyTypes.some(
        (type) => type === property.type,
      );
      const reason = !canEdit
        ? "Database edit access required"
        : property.sourceManaged
          ? "Source-managed definition"
          : !ordinary
            ? "Blocks, computed and relationship definitions use their own actions"
            : null;
      return { propertyId: property.id, editable: reason === null, reason };
    }),
  };
}
