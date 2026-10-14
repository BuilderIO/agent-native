import { resolveAccess, type ResolvedAccess } from "@agent-native/core/sharing";

import { schema } from "../server/db/index.js";
import type {
  ContentDatabaseMutationContract,
  ContentDatabaseSetupContract,
} from "../shared/api.js";
import { setupPropertyTypes } from "./_database-property-setup.js";
import { parseDatabaseViewConfig } from "./_property-utils.js";

export async function getDatabaseSetupContract(
  database: typeof schema.contentDatabases.$inferSelect,
  mutationContract: ContentDatabaseMutationContract,
  options: {
    /** The caller's role on the database page, when this request resolved it. */
    accessRole?: ResolvedAccess["role"] | null;
  } = {},
): Promise<ContentDatabaseSetupContract> {
  const role =
    options.accessRole !== undefined
      ? (options.accessRole ?? undefined)
      : (await resolveAccess("document", database.documentId))?.role;
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
    supportedPropertyTypes: [...setupPropertyTypes],
    canEditSchema: canEdit,
    canEditViews: canEdit,
    canManageLifecycle:
      (role === "admin" || role === "owner") && !database.ownerDocumentId,
    sourceComposition: "unsupported",
    properties: mutationContract.properties.map((property) => {
      const ordinary = setupPropertyTypes.some(
        (type) => type === property.type,
      );
      const reason = !canEdit
        ? "Database edit access required"
        : property.sourceManaged
          ? "Source-managed definition"
          : !ordinary
            ? "Blocks and computed definitions use their own actions"
            : null;
      return { propertyId: property.id, editable: reason === null, reason };
    }),
  };
}
