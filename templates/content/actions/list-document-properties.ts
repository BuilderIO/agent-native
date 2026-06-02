import { defineAction } from "@agent-native/core";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";
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
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ documentId }) => {
    const access = await resolveAccess("document", documentId);
    if (!access) throw new Error(`Document "${documentId}" not found`);
    const database = await resolvePropertyDatabaseForDocument(access.resource);

    return {
      documentId,
      databaseId: database?.id ?? null,
      properties: await listPropertiesForDocument(access.resource),
    };
  },
});
