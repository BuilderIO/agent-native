import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { blocksContentHash } from "../shared/blocks-field-identity.js";
import {
  renderCollectionCsv,
  renderCollectionHtml,
  renderCollectionMarkdownArchive,
} from "../shared/database-collection-export.js";
import { buildDocumentExport } from "../shared/document-export.js";
import {
  isBlocksPropertyType,
  isPrimaryBlocksField,
} from "../shared/properties.js";
import { buildCollectionExportProjection } from "./_collection-export.js";
import { getDatabaseByDocumentId } from "./_database-utils.js";
import { listPropertiesForAllDocumentDatabases } from "./_property-utils.js";

const collectionSchema = z.object({
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("all_members") }),
    z.object({
      kind: z.literal("current_view"),
      viewId: z.string().min(1),
      query: z.object({
        search: z.string().max(500),
        filters: z
          .array(
            z.object({
              key: z.string(),
              label: z.string(),
              operator: z.enum([
                "contains",
                "equals",
                "does_not_equal",
                "greater_than",
                "less_than",
                "before",
                "after",
                "between",
                "is_checked",
                "is_unchecked",
                "is_empty",
                "is_not_empty",
              ]),
              value: z.string(),
              filterGroupId: z.string().optional(),
              parentFilterGroupId: z.string().optional(),
            }),
          )
          .max(50),
        sorts: z
          .array(
            z.object({
              key: z.string(),
              label: z.string(),
              direction: z.enum(["asc", "desc"]),
            }),
          )
          .max(20),
        filterMode: z.enum(["and", "or"]),
      }),
    }),
  ]),
  propertyIds: z.array(z.string().min(1)).max(200),
  includePrimaryBody: z.boolean().default(false),
  blockPropertyIds: z.array(z.string().min(1)).max(200).default([]),
});

type CollectionExport = z.infer<typeof collectionSchema>;

function exportBaseName(title: string | null | undefined) {
  return (
    (title || "untitled")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "untitled"
  );
}

export default defineAction({
  description:
    "Export a Content page or bounded Database/View collection as CSV, a Markdown package, standalone HTML, or PDF-ready HTML for the browser print dialog.",
  schema: z.object({
    id: z.string().describe("Document ID (required)"),
    format: z
      .enum(["pdf", "markdown", "html", "csv"])
      .default("pdf")
      .describe("Export format: pdf, markdown, html, or csv."),
    collection: collectionSchema
      .optional()
      .describe(
        "Database export scope, selected scalar property IDs, primary body choice, and selected additional Blocks property IDs.",
      ),
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
  run: async ({ id, format, title, content, collection }) => {
    const access = await resolveAccess("document", id);
    if (!access) throw new Error(`Document "${id}" not found`);

    const doc = access.resource;
    const database = await getDatabaseByDocumentId(doc.id);
    const effectiveCollection: CollectionExport | null = collection
      ? collection
      : database && format !== "csv"
        ? {
            scope: { kind: "all_members" },
            propertyIds: [],
            includePrimaryBody: true,
            blockPropertyIds: [],
          }
        : null;
    if (format === "csv" && !effectiveCollection) {
      throw new Error("CSV export requires collection options");
    }
    if (effectiveCollection) {
      const projection = await buildCollectionExportProjection(
        doc.id,
        effectiveCollection,
      );
      const baseName = exportBaseName(doc.title);
      const deepLink = buildDeepLink({
        app: "content",
        view: "editor",
        params: { documentId: doc.id },
      });
      if (format === "csv") {
        const content = renderCollectionCsv(projection);
        return {
          id: doc.id,
          title: doc.title || "Untitled",
          format,
          filename: `${baseName}.csv`,
          mimeType: "text/csv;charset=utf-8",
          content,
          print: false,
          deepLink,
        };
      }
      if (format === "markdown") {
        const archiveFiles = renderCollectionMarkdownArchive(projection);
        return {
          id: doc.id,
          title: doc.title || "Untitled",
          format,
          filename: `${baseName}.zip`,
          mimeType: "application/zip",
          content: archiveFiles[0]?.content ?? "",
          archiveFiles,
          print: false,
          deepLink,
        };
      }
      return {
        ...renderCollectionHtml(projection, format),
        deepLink,
      };
    }
    if (format === "csv") {
      throw new Error("CSV export requires collection options");
    }
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
    const payload = buildDocumentExport({
      id: doc.id,
      title: title ?? doc.title,
      content: content ?? doc.content,
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
