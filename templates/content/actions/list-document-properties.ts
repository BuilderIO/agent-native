import { defineAction } from "@agent-native/core";
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
    databaseId: z.string().describe("Database ID that owns the properties"),
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
    );

    return {
      documentId,
      databaseId: database?.id ?? null,
      properties: await listPropertiesForDocument(access.resource, databaseId),
    };
  },
});
