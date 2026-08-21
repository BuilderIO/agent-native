import { defineAction } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { accessFilter, resolveAccess } from "@agent-native/core/sharing";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type {
  ContentDatabaseItem,
  ContentDatabaseTableQuery,
} from "../shared/api.js";
import { blocksContentHash } from "../shared/blocks-field-identity.js";
import { renderDatabaseCsv } from "../shared/database-csv-export.js";
import { applyContentDatabaseTableQuery } from "../shared/database-query.js";
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
import { listContentOrganizationMemberships } from "./_content-space-access.js";
import {
  CONTENT_DATABASE_MAX_READ_LIMIT,
  getDatabaseByDocumentId,
} from "./_database-utils.js";
import {
  listPropertiesForAllDocumentDatabases,
  listPropertiesForDatabase,
  listPropertiesForDatabaseDocuments,
  parseDatabaseViewConfig,
} from "./_property-utils.js";

const COLLECTION_EXPORT_ACCESS_CONCURRENCY = 8;

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
});

type CollectionExport = z.infer<typeof collectionSchema>;

function assertValidQuery(
  query: ContentDatabaseTableQuery,
  propertyIds: ReadonlySet<string>,
) {
  for (const key of [...query.filters, ...query.sorts].map(({ key }) => key)) {
    if (key !== "name" && !propertyIds.has(key)) {
      throw new Error(`Unknown database property "${key}" in export query`);
    }
  }
}

async function databaseCsvContent(
  documentId: string,
  collection: CollectionExport,
) {
  const database = await getDatabaseByDocumentId(documentId);
  if (!database) throw new Error("CSV export requires a database document");

  const properties = await listPropertiesForDatabase(database.id);
  const propertyById = new Map(
    properties.map((property) => [property.definition.id, property]),
  );
  if (new Set(collection.propertyIds).size !== collection.propertyIds.length) {
    throw new Error("CSV export property IDs must be unique");
  }
  const selectedProperties = collection.propertyIds.map((propertyId) => {
    const property = propertyById.get(propertyId);
    if (!property) throw new Error(`Unknown database property "${propertyId}"`);
    return property;
  });

  const query =
    collection.scope.kind === "current_view" ? collection.scope.query : null;
  const scope = collection.scope;
  if (scope.kind === "current_view") {
    const view = parseDatabaseViewConfig(database.viewConfigJson).views.find(
      (candidate) => candidate.id === scope.viewId,
    );
    if (!view) throw new Error(`Database view "${scope.viewId}" not found`);
    assertValidQuery(query!, new Set(propertyById.keys()));
  }
  const blocksAreNeeded =
    selectedProperties.some((property) =>
      isBlocksPropertyType(property.definition.type),
    ) ||
    (!!query &&
      (query.search.trim().length > 0 ||
        [...query.filters, ...query.sorts].some((constraint) => {
          const property = propertyById.get(constraint.key);
          return !!property && isBlocksPropertyType(property.definition.type);
        })));

  const userEmail = getRequestUserEmail();
  const memberships = userEmail
    ? await listContentOrganizationMemberships(userEmail)
    : [];
  const accessClauses = [accessFilter(schema.documents, schema.documentShares)];
  for (const membership of memberships) {
    accessClauses.push(
      accessFilter(schema.documents, schema.documentShares, {
        userEmail: userEmail!,
        orgId: membership.orgId,
      }),
    );
  }
  const rows = await getDb()
    .select({
      item: schema.contentDatabaseItems,
      document: schema.documents,
    })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.contentDatabaseItems.documentId),
    )
    .where(
      and(
        eq(schema.contentDatabaseItems.databaseId, database.id),
        isNull(schema.documents.trashedAt),
        or(...accessClauses),
      ),
    )
    .orderBy(
      asc(schema.contentDatabaseItems.position),
      asc(schema.contentDatabaseItems.createdAt),
      asc(schema.contentDatabaseItems.id),
    )
    .limit(CONTENT_DATABASE_MAX_READ_LIMIT + 1);
  if (rows.length > CONTENT_DATABASE_MAX_READ_LIMIT) {
    throw new Error(
      `CSV export supports up to ${CONTENT_DATABASE_MAX_READ_LIMIT} accessible rows.`,
    );
  }
  if (blocksAreNeeded) {
    for (const { item } of rows) {
      if (
        item.bodyHydrationStatus !== "hydrated" &&
        item.bodyHydrationStatus !== "unavailable"
      ) {
        throw new Error(
          `Database item "${item.documentId}" is not ready for export`,
        );
      }
    }
  }
  const documents = rows.map((row) => row.document);
  const propertiesByDocumentId = await listPropertiesForDatabaseDocuments(
    database.id,
    documents,
  );
  const queryItems: ContentDatabaseItem[] = rows.map((row) => ({
    id: row.item.id,
    databaseId: row.item.databaseId,
    document: {
      id: row.document.id,
      parentId: row.document.parentId,
      title: row.document.title,
      content: row.document.content,
      description: row.document.description ?? undefined,
      icon: row.document.icon,
      position: row.document.position,
      isFavorite: row.document.isFavorite === 1,
      hideFromSearch: row.document.hideFromSearch === 1,
      createdAt: row.document.createdAt,
      updatedAt: row.document.updatedAt,
    },
    position: row.item.position,
    properties: propertiesByDocumentId.get(row.document.id) ?? [],
  }));
  const selectedRows = query
    ? applyContentDatabaseTableQuery(queryItems, properties, query)
    : queryItems;
  return renderDatabaseCsv(
    selectedProperties.map((property) => ({
      id: property.definition.id,
      name: property.definition.name,
      property,
    })),
    selectedRows.map((row) => ({
      title: row.document.title,
      values: new Map(
        row.properties.map((property) => [
          property.definition.id,
          property.value,
        ]),
      ),
    })),
  );
}

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
      if (
        member.bodyHydrationStatus !== "hydrated" &&
        member.bodyHydrationStatus !== "unavailable"
      ) {
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
      .enum(["pdf", "markdown", "html", "csv"])
      .default("pdf")
      .describe("Export format: pdf, markdown, html, or csv."),
    collection: collectionSchema
      .optional()
      .describe("Database CSV export scope and selected property IDs."),
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
    if (format === "csv") {
      if (!collection)
        throw new Error("CSV export requires collection options");
      const content = await databaseCsvContent(doc.id, collection);
      return {
        id: doc.id,
        title: doc.title || "Untitled",
        format,
        filename: `${
          (doc.title || "untitled")
            .replace(/[^a-z0-9]+/gi, "-")
            .replace(/^-+|-+$/g, "")
            .toLowerCase() || "untitled"
        }.csv`,
        mimeType: "text/csv;charset=utf-8",
        content,
        print: false,
        deepLink: buildDeepLink({
          app: "content",
          view: "editor",
          params: { documentId: doc.id },
        }),
      };
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
