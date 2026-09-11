import { defineAction } from "@agent-native/core/action";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { isSoftDeletedDatabaseDocument } from "./_database-utils.js";
import {
  listPropertiesForDocument,
  resolvePropertyDatabaseForDocument,
} from "./_property-utils.js";
import "../server/db/index.js";

export default defineAction({
  description:
    "List the Notion-style property definitions and values for one document.",
  schema: z.object({
    documentId: z.string().describe("Document ID (required)"),
    databaseId: z
      .string()
      .optional()
      .describe(
        "Database ID that owns the properties; omit only for context-free entry points",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ documentId, databaseId }) => {
    const access = await resolveAccess("document", documentId);
    if (!access) throw new Error(`Document "${documentId}" not found`);
    if (await isSoftDeletedDatabaseDocument(documentId)) {
      throw new Error(`Document "${documentId}" not found`);
    }
    const database = await resolvePropertyDatabaseForDocument(
      access.resource,
      databaseId,
      "viewer",
      { requireDatabaseAccess: false },
    );
    const databaseAccess = database
      ? await resolveAccess("document", database.documentId)
      : null;
    const canEditValues =
      databaseAccess?.role === "owner" ||
      databaseAccess?.role === "admin" ||
      databaseAccess?.role === "editor";
    const canManageSchema = canEditValues;

    const properties = await listPropertiesForDocument(
      access.resource,
      databaseId,
      {
        // The page share authorizes this page's definitions and values. The
        // supplied database is checked only as this page's exact membership;
        // its backing document remains private for container operations.
        requireDatabaseAccess: databaseAccess !== null,
      },
    );

    return {
      documentId,
      databaseId: databaseAccess ? (database?.id ?? null) : null,
      canEditValues,
      canManageSchema,
      properties: databaseAccess
        ? properties
        : properties.map((property) => ({
            ...property,
            definition: { ...property.definition, databaseId: null },
          })),
    };
  },
});
