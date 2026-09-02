import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  countWords,
  DEFAULT_BLOCKS_FIELD_NAME,
  isBlocksPropertyType,
  isPrimaryBlocksField,
} from "../shared/properties.js";
import "../server/db/index.js";
import { isSoftDeletedDatabaseDocument } from "./_database-utils.js";
import { flushOpenDocumentEditorToSql } from "./_document-flush.js";
import { listPropertiesForAllDocumentDatabases } from "./_property-utils.js";

export default defineAction({
  description:
    "Count words in one exact Content Blocks field. Omit propertyId for the Page's primary Content body; provide a Blocks property ID for an additional field.",
  schema: z.object({
    documentId: z.string().describe("Page document ID (required)"),
    propertyId: z
      .string()
      .optional()
      .describe(
        "Additional Blocks property ID; omit for the primary Content body",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async ({ documentId, propertyId }) => {
    const access = await resolveReadableDocument(documentId);

    // The open editor acknowledgement covers the collaborative primary body
    // and every mounted additional-field save controller for this Page.
    await flushOpenDocumentEditorToSql({
      documentId,
      ownerEmail: (access.resource.ownerEmail as string | undefined) || null,
    });

    const fresh = await resolveReadableDocument(documentId);
    if (!propertyId) {
      return wordCountResult({
        documentId,
        propertyId: null,
        name: DEFAULT_BLOCKS_FIELD_NAME,
        primary: true,
        content: (fresh.resource.content as string | null | undefined) ?? "",
      });
    }

    const properties = await listPropertiesForAllDocumentDatabases(
      fresh.resource,
    );
    const property = properties.find(
      (candidate) => candidate.definition.id === propertyId,
    );
    if (
      !property ||
      !isBlocksPropertyType(property.definition.type) ||
      isPrimaryBlocksField(property.definition.options) ||
      typeof property.value !== "string"
    ) {
      throw new Error(
        `Blocks field "${propertyId}" was not found for document "${documentId}"`,
      );
    }

    return wordCountResult({
      documentId,
      propertyId,
      name: property.definition.name,
      primary: false,
      content: property.value,
    });
  },
  link: ({ result }) => {
    const documentId = (result as { documentId?: string } | null)?.documentId;
    if (!documentId) return null;
    return {
      url: buildDeepLink({
        app: "content",
        view: "editor",
        params: { documentId },
      }),
      label: "Open document",
      view: "editor",
    };
  },
});

async function resolveReadableDocument(documentId: string) {
  const access = await resolveAccess("document", documentId);
  if (
    !access ||
    access.resource.trashedAt ||
    (await isSoftDeletedDatabaseDocument(documentId))
  ) {
    throw new Error(`Document "${documentId}" not found`);
  }
  return access;
}

export function wordCountResult(args: {
  documentId: string;
  propertyId: string | null;
  name: string;
  primary: boolean;
  content: string;
}) {
  return {
    documentId: args.documentId,
    propertyId: args.propertyId,
    name: args.name,
    primary: args.primary,
    wordCount: countWords(args.content),
  };
}
