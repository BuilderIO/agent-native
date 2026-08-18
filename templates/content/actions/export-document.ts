import { defineAction } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { blocksContentHash } from "../shared/blocks-field-identity.js";
import {
  buildDocumentExport,
  collectionItemsMarkdown,
  type CollectionExportItem,
} from "../shared/document-export.js";
import {
  isBlocksPropertyType,
  isPrimaryBlocksField,
} from "../shared/properties.js";
import { resolveContentDocumentAccess } from "./_content-document-access.js";
import { getDatabaseByDocumentId } from "./_database-utils.js";
import { listPropertiesForAllDocumentDatabases } from "./_property-utils.js";

const COLLECTION_EXPORT_ACCESS_CONCURRENCY = 8;

async function databaseExportContent(documentId: string) {
  const database = await getDatabaseByDocumentId(documentId);
  if (!database) return null;

  const members = await getDb()
    .select({
      documentId: schema.contentDatabaseItems.documentId,
      bodyHydrationStatus: schema.contentDatabaseItems.bodyHydrationStatus,
    })
    .from(schema.contentDatabaseItems)
    .where(eq(schema.contentDatabaseItems.databaseId, database.id))
    .orderBy(
      asc(schema.contentDatabaseItems.position),
      asc(schema.contentDatabaseItems.createdAt),
      asc(schema.contentDatabaseItems.id),
    );
  const items: CollectionExportItem[] = [];

  for (
    let offset = 0;
    offset < members.length;
    offset += COLLECTION_EXPORT_ACCESS_CONCURRENCY
  ) {
    const batch = members.slice(
      offset,
      offset + COLLECTION_EXPORT_ACCESS_CONCURRENCY,
    );
    const resolved = await Promise.all(
      batch.map(async (member) => ({
        member,
        access: await resolveContentDocumentAccess(member.documentId),
      })),
    );

    for (const { member, access } of resolved) {
      if (!access || access.resource.trashedAt) continue;
      if (member.bodyHydrationStatus !== "hydrated") {
        throw new Error(
          `Database item "${member.documentId}" is not ready for export`,
        );
      }

      items.push({
        title: access.resource.title,
        content: access.resource.content,
      });
    }
  }

  return collectionItemsMarkdown(items);
}

export default defineAction({
  description:
    "Export a Content document as PDF-ready HTML, Markdown, or standalone HTML. PDF exports are print-ready HTML intended for the browser print dialog.",
  schema: z.object({
    id: z.string().describe("Document ID (required)"),
    format: z
      .enum(["pdf", "markdown", "html"])
      .default("pdf")
      .describe("Export format: pdf, markdown, or html."),
    title: z
      .string()
      .max(500)
      .optional()
      .describe("Optional unsaved editor title to export."),
    content: z
      .string()
      .max(2_000_000)
      .optional()
      .describe("Optional unsaved editor markdown content to export."),
  }),
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async ({ id, format, title, content }) => {
    const access = await resolveAccess("document", id);
    if (!access) throw new Error(`Document "${id}" not found`);

    const doc = access.resource;
    const properties = await listPropertiesForAllDocumentDatabases(doc);
    const blocksFields = properties
      .filter((property) => isBlocksPropertyType(property.definition.type))
      .map((property) => {
        if (!property.definition.databaseId) {
          throw new Error(
            `Blocks field "${property.definition.id}" is not attached to a database`,
          );
        }
        if (!property.blocksField) {
          throw new Error(
            `Blocks field "${property.definition.id}" has no identity state`,
          );
        }
        const markdown =
          content !== undefined &&
          isPrimaryBlocksField(property.definition.options)
            ? content
            : typeof property.value === "string"
              ? property.value
              : "";
        const identity =
          blocksContentHash(markdown) === property.blocksField.contentHash
            ? property.blocksField
            : { ...property.blocksField, identityStatus: "stale" as const };
        return {
          databaseId: property.definition.databaseId,
          propertyId: property.definition.id,
          name: property.definition.name,
          position: property.definition.position,
          markdown,
          identity,
        };
      });
    const collectionContent = await databaseExportContent(doc.id);
    const payload = buildDocumentExport({
      id: doc.id,
      title: title ?? doc.title,
      content: collectionContent ?? content ?? doc.content,
      updatedAt: doc.updatedAt,
      format,
      blocksFields,
    });

    return {
      ...payload,
      deepLink: buildDeepLink({
        app: "content",
        view: "editor",
        params: { documentId: doc.id },
      }),
    };
  },
  link: ({ result }) => {
    const id = (result as { id?: string } | null)?.id;
    if (!id) return null;
    return {
      url: buildDeepLink({
        app: "content",
        view: "editor",
        params: { documentId: id },
      }),
      label: "Open document",
      view: "editor",
    };
  },
});
