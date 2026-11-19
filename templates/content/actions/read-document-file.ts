import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { isBlocksPropertyType } from "../shared/properties.js";
import { buildCollectionExportProjection } from "./_collection-export.js";
import { resolveContentDocumentAccess } from "./_content-document-access.js";
import { listContentOrganizationMemberships } from "./_content-space-access.js";
import {
  getDatabaseByDocumentId,
  isSoftDeletedDatabaseDocument,
} from "./_database-utils.js";
import { resolveDocumentAccess } from "./_document-access.js";
import { documentDiscoveryWhere } from "./_document-discovery-query.js";
import { listPropertiesForDatabase } from "./_property-utils.js";
import searchDocuments from "./search-documents.js";

const PAGE_SIZE = 30;
/**
 * The file rides back to the calling app inside one JSON response, so it stays
 * well under a serverless response's size limit even after JSON escaping.
 */
export const DOCUMENT_FILE_MAX_BYTES = 2 * 1024 * 1024;
const MAX_RESULT_CHARS = 6_000_000;

type DocumentFileKind = "page" | "collection";
type DocumentFileFormat = "markdown" | "csv";

const FORMAT_BY_KIND: Record<DocumentFileKind, DocumentFileFormat> = {
  page: "markdown",
  collection: "csv",
};

const FILE_TYPE: Record<
  DocumentFileFormat,
  { extension: string; mimeType: string }
> = {
  markdown: { extension: "md", mimeType: "text/markdown;charset=utf-8" },
  csv: { extension: "csv", mimeType: "text/csv;charset=utf-8" },
};

function pageTitle(title: string | null | undefined) {
  return (title?.trim() || "Untitled").slice(0, 2000);
}

/**
 * The name the recipient sees: the page's own title, kept readable, without
 * the characters a filename can't hold.
 */
export function documentFileName(
  title: string | null | undefined,
  format: DocumentFileFormat,
) {
  const base =
    pageTitle(title)
      // oxlint-disable-next-line no-control-regex
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^[\s.]+|[\s.]+$/g, "")
      .slice(0, 200)
      .trim() || "Untitled";
  return `${base}.${FILE_TYPE[format].extension}`;
}

async function collectionDocumentIds(documentIds: string[]) {
  if (!documentIds.length) return new Set<string>();
  const rows = await getDb()
    .select({ documentId: schema.contentDatabases.documentId })
    .from(schema.contentDatabases)
    .where(
      and(
        inArray(schema.contentDatabases.documentId, documentIds),
        isNull(schema.contentDatabases.deletedAt),
      ),
    );
  return new Set(rows.map((row) => row.documentId));
}

async function listItems(
  items: ReadonlyArray<{ id: string; title: string | null; updatedAt: string }>,
) {
  const collections = await collectionDocumentIds(items.map((item) => item.id));
  return items.map((item) => {
    const kind: DocumentFileKind = collections.has(item.id)
      ? "collection"
      : "page";
    return {
      id: item.id,
      title: pageTitle(item.title),
      kind,
      format: FORMAT_BY_KIND[kind],
      updatedAt: item.updatedAt,
    };
  });
}

async function collectionCsv(documentId: string) {
  const database = await getDatabaseByDocumentId(documentId);
  if (!database) {
    fail("This collection is unavailable.", {
      statusCode: 404,
      errorCode: "document_file_unavailable",
    });
  }
  const properties = await listPropertiesForDatabase(database.id);
  const projection = await buildCollectionExportProjection(documentId, {
    scope: { kind: "all_members" },
    // Every column but those always hidden. Long-form Blocks fields stay out
    // of a spreadsheet, as in the Export dialog's CSV default.
    propertyIds: properties
      .filter(
        (property) =>
          !isBlocksPropertyType(property.definition.type) &&
          property.definition.visibility !== "always_hide",
      )
      .map((property) => property.definition.id),
    includePrimaryBody: false,
    blockPropertyIds: [],
  });
  const { renderCollectionCsv } =
    await import("../shared/database-collection-export.js");
  return renderCollectionCsv(projection);
}

export default defineAction({
  description:
    "List Content pages and collections another app can attach as a file, or read one as that file: a page as Markdown, a collection as CSV. Lists the most recently updated or search results, limited to what the caller can open. Changes nothing.",
  schema: z.object({
    operation: z
      .enum(["list", "read"])
      .describe("List attachable pages, or read one as a file."),
    search: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe("Optional search within titles and text, for a list."),
    page: z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .default(1)
      .describe("One-based result page for a list; defaults to 1."),
    id: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe("Page or collection id; required for a read."),
    format: z
      .enum(["markdown", "csv"])
      .optional()
      .describe(
        "File format for a read: markdown for a page, csv for a collection. Defaults to the one that fits.",
      ),
  }),
  readOnly: true,
  // Other apps read pages as files through this over A2A, which only reaches
  // MCP tools. Content's own agent exports with export-document.
  agentTool: false,
  mcpTool: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  maxResultChars: MAX_RESULT_CHARS,
  run: async (args) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      fail("Sign in to attach a Content page.", {
        statusCode: 401,
        errorCode: "unauthorized",
      });
    }

    if (args.operation === "list") {
      const offset = (args.page - 1) * PAGE_SIZE;
      if (args.search) {
        const result = await searchDocuments.run({
          query: args.search,
          limit: PAGE_SIZE,
          offset,
        });
        return {
          items: await listItems(result.documents),
          hasMore: result.pagination.hasMore,
        };
      }
      const memberships = await listContentOrganizationMemberships(userEmail);
      const rows = await getDb()
        .select({
          id: schema.documents.id,
          title: schema.documents.title,
          updatedAt: schema.documents.updatedAt,
        })
        .from(schema.documents)
        .where(
          documentDiscoveryWhere({
            userEmail,
            authorizedOrgIds: [
              ...new Set(memberships.map((membership) => membership.orgId)),
            ],
            // The same pages a search here would find.
            additional: or(
              eq(schema.documents.hideFromSearch, 0),
              isNull(schema.documents.hideFromSearch),
            ),
          }),
        )
        .orderBy(desc(schema.documents.updatedAt), asc(schema.documents.id))
        .limit(PAGE_SIZE + 1)
        .offset(offset);
      return {
        items: await listItems(rows.slice(0, PAGE_SIZE)),
        hasMore: rows.length > PAGE_SIZE,
      };
    }

    const id = args.id;
    if (!id) {
      fail("Choose a page to attach.", {
        errorCode: "document_file_required",
      });
    }
    // The list offers pages from every organization the person belongs to,
    // not only the active one, so the read accepts the same.
    const access =
      (await resolveDocumentAccess(id)) ??
      (await resolveContentDocumentAccess(id));
    if (
      !access ||
      access.resource.trashedAt ||
      (await isSoftDeletedDatabaseDocument(id))
    ) {
      fail("This page is unavailable or you no longer have access to it.", {
        statusCode: 404,
        errorCode: "document_file_unavailable",
      });
    }
    const doc = access.resource;
    const kind: DocumentFileKind = (await getDatabaseByDocumentId(doc.id))
      ? "collection"
      : "page";
    const format = args.format ?? FORMAT_BY_KIND[kind];
    if (format !== FORMAT_BY_KIND[kind]) {
      fail(
        kind === "collection"
          ? "A collection attaches as a CSV file. Choose CSV, or attach one of its pages as Markdown."
          : "A page attaches as a Markdown file. CSV is for collections.",
        { errorCode: "document_file_format_unsupported" },
      );
    }
    const title = pageTitle(doc.title);
    let content: string;
    if (format === "csv") {
      content = await collectionCsv(doc.id);
    } else {
      // The export renderers are heavy, so they load when a read runs.
      const { markdownWithTitle } =
        await import("../shared/document-export.js");
      content = markdownWithTitle(title, doc.content);
    }
    const size = Buffer.byteLength(content, "utf8");
    if (size > DOCUMENT_FILE_MAX_BYTES) {
      fail(
        `This ${kind} is too large to attach from another app (over 2 MB). Export it from Content and attach the file instead.`,
        { statusCode: 413, errorCode: "document_file_too_large" },
      );
    }
    return {
      id: doc.id,
      title,
      kind,
      format,
      filename: documentFileName(title, format),
      mimeType: FILE_TYPE[format].mimeType,
      encoding: "utf8" as const,
      content,
      size,
      updatedAt: doc.updatedAt,
    };
  },
});
