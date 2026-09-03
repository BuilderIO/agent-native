import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import type { DocumentProperty } from "../shared/api.js";
import {
  countWords,
  DEFAULT_BLOCKS_FIELD_NAME,
  isBlocksPropertyType,
  isEmptyPropertyValue,
  isPrimaryBlocksField,
} from "../shared/properties.js";
import "../server/db/index.js";
import { isSoftDeletedDatabaseDocument } from "./_database-utils.js";
import { flushOpenDocumentEditorToSql } from "./_document-flush.js";
import {
  listPropertiesForAllDocumentDatabases,
  resolvePropertyDatabaseForDocument,
} from "./_property-utils.js";

export default defineAction({
  description:
    "Count words in one exact Content Blocks field. Omit propertyId for the Page's primary Content body; provide a Blocks property ID for an additional field.",
  schema: z.object({
    documentId: z.string().describe("Page document ID (required)"),
    propertyId: z
      .string()
      .min(1)
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
    const context = await readableFieldContext(access.resource);
    const selected = selectReadableBlocksField(context, propertyId);

    await flushOpenDocumentEditorToSql({
      documentId,
      ownerEmail: (access.resource.ownerEmail as string | undefined) || null,
      ...(selected && !selected.primary
        ? { propertyId: selected.property.definition.id }
        : {}),
    });

    const fresh = await resolveReadableDocument(documentId);
    const freshContext = await readableFieldContext(fresh.resource);
    const freshSelected = selectReadableBlocksField(freshContext, propertyId);
    if (!freshSelected) {
      return wordCountResult({
        documentId,
        propertyId: null,
        name: DEFAULT_BLOCKS_FIELD_NAME,
        primary: true,
        content: (fresh.resource.content as string | null | undefined) ?? "",
      });
    }

    return wordCountResult({
      documentId,
      propertyId: freshSelected.property.definition.id,
      name: freshSelected.property.definition.name,
      primary: freshSelected.primary,
      content: freshSelected.primary
        ? ((fresh.resource.content as string | null | undefined) ?? "")
        : (freshSelected.property.value as string),
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

async function readableFieldContext(
  document: Awaited<ReturnType<typeof resolveReadableDocument>>["resource"],
) {
  const [properties, database] = await Promise.all([
    listPropertiesForAllDocumentDatabases(document, {
      requireDatabaseAccess: false,
    }),
    resolvePropertyDatabaseForDocument(document, undefined, "viewer", {
      requireDatabaseAccess: false,
    }),
  ]);
  return { properties, hasDatabase: database !== null };
}

export function selectReadableBlocksField(
  context: { properties: DocumentProperty[]; hasDatabase: boolean },
  propertyId: string | undefined,
) {
  const { properties } = context;
  const visibleBlocks = properties.filter(
    (property) =>
      isBlocksPropertyType(property.definition.type) &&
      property.definition.visibility !== "always_hide" &&
      (property.definition.visibility !== "hide_when_empty" ||
        !isEmptyPropertyValue(property.value)),
  );
  if (propertyId === undefined) {
    if (!context.hasDatabase) return null;
    const primary = visibleBlocks.find((property) =>
      isPrimaryBlocksField(property.definition.options),
    );
    if (!primary)
      throw new Error("This Page has no visible primary Content field.");
    return { property: primary, primary: true };
  }
  const property = visibleBlocks.find(
    (candidate) => candidate.definition.id === propertyId,
  );
  if (
    !property ||
    isPrimaryBlocksField(property.definition.options) ||
    typeof property.value !== "string"
  ) {
    throw new Error(
      `Blocks field "${propertyId}" was not found for this Page.`,
    );
  }
  return { property, primary: false };
}

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
