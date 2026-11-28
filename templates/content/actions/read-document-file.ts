import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { isBlocksPropertyType } from "../shared/properties.js";
import { buildCollectionExportProjection } from "./_collection-export.js";
import { resolveContentDocumentAccess } from "./_content-document-access.js";
import { listContentOrganizationMemberships } from "./_content-space-access.js";
import { isSoftDeletedDatabaseDocument } from "./_database-utils.js";
import { resolveDocumentAccess } from "./_document-access.js";
import { documentDiscoveryWhere } from "./_document-discovery-query.js";
import { refreshGitHubPageBeforeRead } from "./_github-source-freshness.js";
import { withInteractiveHtmlLinks } from "./_interactive-html-blocks.js";
import { listPropertiesForDatabase } from "./_property-utils.js";
import searchDocuments from "./search-documents.js";

const PAGE_SIZE = 30;
export const DOCUMENT_FILE_MAX_BYTES = 2 * 1024 * 1024;
const MAX_RESULT_CHARS = 6_000_000;
const PDF_TEXT_UNSUPPORTED =
  "This page has text a PDF can't show yet, such as Chinese, Japanese, Korean, Arabic, Hebrew or Hindi. Attach it as Markdown instead.";

const kindSchema = z.enum(["page", "collection"]);
const formatSchema = z.enum(["markdown", "csv", "pdf"]);
const pdfFontSchema = z.enum(["sans", "serif"]);
type DocumentFileKind = z.infer<typeof kindSchema>;
type DocumentFileFormat = z.infer<typeof formatSchema>;

const FORMAT_BY_KIND: Record<DocumentFileKind, DocumentFileFormat> = {
  page: "markdown",
  collection: "csv",
};

const FORMATS_BY_KIND: Record<DocumentFileKind, readonly DocumentFileFormat[]> =
  {
    page: ["markdown", "pdf"],
    collection: ["csv"],
  };

const FILE_TYPE: Record<
  DocumentFileFormat,
  { extension: string; mimeType: string }
> = {
  markdown: { extension: "md", mimeType: "text/markdown;charset=utf-8" },
  csv: { extension: "csv", mimeType: "text/csv;charset=utf-8" },
  pdf: { extension: "pdf", mimeType: "application/pdf" },
};

const documentFileOutputSchema = z.union([
  z.object({
    items: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        kind: kindSchema,
        format: formatSchema,
        updatedAt: z.string(),
      }),
    ),
    hasMore: z.boolean(),
  }),
  z.object({
    id: z.string(),
    title: z.string(),
    kind: kindSchema,
    format: formatSchema,
    filename: z.string(),
    mimeType: z.string(),
    encoding: z.enum(["utf8", "base64"]),
    content: z.string(),
    size: z.number().int().nonnegative(),
    updatedAt: z.string(),
  }),
]);

function pageTitle(title: string | null | undefined) {
  return (title?.trim() || "Untitled").slice(0, 2000);
}

const FILENAME_UNSAFE_CHARACTERS = new Set('\\/:*?"<>|');

function isFilenameSafe(character: string) {
  const code = character.codePointAt(0) ?? 0;
  return (
    code >= 0x20 && code !== 0x7f && !FILENAME_UNSAFE_CHARACTERS.has(character)
  );
}

export function documentFileName(
  title: string | null | undefined,
  format: DocumentFileFormat,
) {
  const base =
    Array.from(pageTitle(title), (character) =>
      isFilenameSafe(character) ? character : " ",
    )
      .join("")
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

async function activeCollection(documentId: string) {
  const rows = await getDb()
    .select({ id: schema.contentDatabases.id })
    .from(schema.contentDatabases)
    .where(
      and(
        eq(schema.contentDatabases.documentId, documentId),
        isNull(schema.contentDatabases.deletedAt),
      ),
    )
    .limit(1);
  return rows.length > 0 ? rows[0] : undefined;
}

async function collectionCsv(documentId: string, databaseId: string) {
  const properties = await listPropertiesForDatabase(databaseId);
  const projection = await buildCollectionExportProjection(documentId, {
    scope: { kind: "all_members" },
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
    "List Content pages and collections another app can attach as a file, or read one as that file: a page as Markdown or PDF, a collection as CSV. A PDF comes back base64-encoded, set in sans or serif type. Lists the most recently updated or search results, limited to what the caller can open. Changes nothing.",
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
    format: formatSchema
      .optional()
      .describe(
        "File format for a read: markdown or pdf for a page, csv for a collection. Defaults to markdown for a page and csv for a collection.",
      ),
    font: pdfFontSchema
      .optional()
      .describe(
        "Typeface for a PDF read: sans (the default) or serif, such as for poetry. Markdown and CSV ignore it.",
      ),
  }),
  outputSchema: documentFileOutputSchema,
  readOnly: true,
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
      const visibleInSearch = or(
        eq(schema.documents.hideFromSearch, 0),
        isNull(schema.documents.hideFromSearch),
      );
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
            ...(visibleInSearch ? { additional: visibleInSearch } : {}),
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
    const resolveAccess = async () =>
      (await resolveDocumentAccess(id)) ??
      (await resolveContentDocumentAccess(id));
    let access = await resolveAccess();
    if (
      access &&
      !access.resource.trashedAt &&
      (access.resource.sourceMode === "github" ||
        (!access.resource.sourceMode && access.resource.parentId)) &&
      (await refreshGitHubPageBeforeRead(access.resource.id))
    ) {
      access = await resolveAccess();
    }
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
    const collection = await activeCollection(doc.id);
    const kind: DocumentFileKind = collection ? "collection" : "page";
    const format = args.format ?? FORMAT_BY_KIND[kind];
    if (!FORMATS_BY_KIND[kind].includes(format)) {
      fail(
        kind === "collection"
          ? "A collection attaches as a CSV file. Choose CSV, or attach one of its pages as Markdown or PDF."
          : "A page attaches as a Markdown or PDF file. CSV is for collections.",
        { errorCode: "document_file_format_unsupported" },
      );
    }
    const title = pageTitle(doc.title);
    let content: string;
    let size: number;
    if (collection) {
      content = await collectionCsv(doc.id, collection.id);
      size = Buffer.byteLength(content, "utf8");
    } else {
      const { markdownWithTitle } =
        await import("../shared/document-export.js");
      content = markdownWithTitle(title, doc.content);
      size = Buffer.byteLength(content, "utf8");
      if (format === "pdf" && size <= DOCUMENT_FILE_MAX_BYTES) {
        const {
          PDF_MAX_PAGES,
          PdfTooLongError,
          PdfUnsupportedTextError,
          renderDocumentPdf,
        } = await import("../server/lib/document-pdf.js");
        let pdf: Buffer;
        try {
          pdf = renderDocumentPdf({
            title,
            content: await withInteractiveHtmlLinks(doc.id, doc.content),
            font: args.font,
          });
        } catch (error) {
          if (error instanceof PdfTooLongError) {
            const detail = {
              pages: `over ${PDF_MAX_PAGES} pages`,
              table: "a table with too many columns to fit",
              text: "more text than a PDF attachment can draw, usually from a long table of narrow cells",
            }[error.reason];
            fail(
              `This page can't be attached as a PDF because it has ${detail}. Attach it as Markdown instead.`,
              { statusCode: 413, errorCode: "document_file_pdf_too_long" },
            );
          }
          if (error instanceof PdfUnsupportedTextError) {
            fail(PDF_TEXT_UNSUPPORTED, {
              statusCode: 422,
              errorCode: "document_file_pdf_text_unsupported",
            });
          }
          console.error("[read-document-file] PDF render failed", error);
          fail(
            "Content couldn't make a PDF of this page. Attach it as Markdown instead.",
            { statusCode: 500, errorCode: "document_file_pdf_failed" },
          );
        }
        if (pdf.byteLength > DOCUMENT_FILE_MAX_BYTES) {
          fail(
            "This page's PDF is over 2 MB, too large to attach from another app. Attach it as Markdown instead.",
            { statusCode: 413, errorCode: "document_file_pdf_too_long" },
          );
        }
        content = pdf.toString("base64");
        size = pdf.byteLength;
      }
    }
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
      encoding: format === "pdf" ? ("base64" as const) : ("utf8" as const),
      content,
      size,
      updatedAt: doc.updatedAt,
    };
  },
});
