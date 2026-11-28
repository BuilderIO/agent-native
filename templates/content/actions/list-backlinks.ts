import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { and, desc, eq, gt, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { createdPageUrl } from "../server/lib/created-page-links.js";
import { firstRow } from "../server/lib/first-row.js";
import { isPublicViewerOwner } from "../server/lib/public-documents.js";
import { normalizeNotionPageId } from "../shared/content-links.js";
import {
  accessibleDocumentIds,
  resolveDocumentAccess,
} from "./_document-access.js";
import { softDeletedDatabaseDocumentExclusions } from "./_document-discovery-query.js";

const MAX_PAGES = 200;

const CANDIDATES_AT_ONCE = 200;

const MAX_SCANNED = 2_000;

const MAX_TITLE_CHARS = 500;

const backlinkSchema = z.object({
  id: z.string(),
  title: z.string().max(MAX_TITLE_CHARS),
  icon: z.string().nullable(),
  url: z.string(),
  updatedAt: z.string(),
});

function shortTitle(title: string): string {
  if (title.length <= MAX_TITLE_CHARS) return title;
  const last = title.charCodeAt(MAX_TITLE_CHARS - 1);
  const splitsPair = last >= 0xd800 && last <= 0xdbff;
  return title.slice(0, splitsPair ? MAX_TITLE_CHARS - 1 : MAX_TITLE_CHARS);
}

export default defineAction({
  description:
    "Lists the pages you can open that link to or mention a page, most recently edited first, with each one's id, title, icon, link and last edit. count is how many there are; at most 200 are listed. more is true when too many pages link here to check them all, so count is a lower bound. A link counts once its page is saved. Pages in Trash are left out until restored, and so is the page's parent, which holds it as a sub-page.",
  schema: z.object({
    documentId: z.string().min(1).describe("The linked-to page's document ID"),
  }),
  outputSchema: z.object({
    pages: z.array(backlinkSchema),
    count: z.number().int().nonnegative(),
    more: z.boolean(),
  }),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  searchHints: ["backlinks", "linked from", "pages that mention this page"],
  run: async ({ documentId }) => {
    const email = getRequestUserEmail();
    if (!email || isPublicViewerOwner(email)) {
      fail("Sign in to see the pages that link here.", {
        errorCode: "backlinks_signed_out",
        statusCode: 401,
      });
    }
    const target = await resolveDocumentAccess(documentId, {
      skipResourceBody: true,
    });
    if (!target || target.resource.trashedAt) {
      fail("Page not found", {
        errorCode: "document_not_found",
        statusCode: 404,
      });
    }
    const db = getDb();
    const links = schema.pageLinks;
    const documents = schema.documents;
    // guard:allow-unscoped — the caller can open this page, as resolveDocumentAccess just checked.
    const placed = firstRow(
      await db
        .select({
          parentId: documents.parentId,
          ownerEmail: documents.ownerEmail,
        })
        .from(documents)
        .where(
          and(
            eq(documents.id, documentId),
            ...softDeletedDatabaseDocumentExclusions(documents.id),
          ),
        )
        .limit(1),
    );
    if (!placed) {
      fail("Page not found", {
        errorCode: "document_not_found",
        statusCode: 404,
      });
    }
    // guard:allow-unscoped — the Notion page ids this page was imported from, which links in its owner's pages may name instead of its id.
    const imports = await db
      .select({ remotePageId: schema.documentSyncLinks.remotePageId })
      .from(schema.documentSyncLinks)
      .where(
        and(
          eq(schema.documentSyncLinks.documentId, documentId),
          eq(schema.documentSyncLinks.provider, "notion"),
        ),
      );
    const notionKeys = [
      ...new Set(
        imports.flatMap((row) => normalizeNotionPageId(row.remotePageId) ?? []),
      ),
    ];
    const linksHere = or(
      eq(links.targetDocumentId, documentId),
      notionKeys.length
        ? and(
            inArray(links.targetDocumentId, notionKeys),
            eq(documents.ownerEmail, placed.ownerEmail),
          )
        : undefined,
    );
    const openable: string[] = [];
    let scanned = 0;
    let more = false;
    type Candidate = { id: string; updatedAt: string };
    let after: Candidate | null = null;
    do {
      // guard:allow-unscoped — ids only; accessibleDocumentIds below keeps the pages the caller can open before anything about them is read.
      const rows: Candidate[] = await db
        .selectDistinct({ id: documents.id, updatedAt: documents.updatedAt })
        .from(links)
        .innerJoin(documents, eq(documents.id, links.sourceDocumentId))
        .where(
          and(
            linksHere,
            ne(documents.id, documentId),
            placed.parentId ? ne(documents.id, placed.parentId) : undefined,
            isNull(documents.trashedAt),
            ...softDeletedDatabaseDocumentExclusions(documents.id),
            after
              ? or(
                  lt(documents.updatedAt, after.updatedAt),
                  and(
                    eq(documents.updatedAt, after.updatedAt),
                    gt(documents.id, after.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(documents.updatedAt), documents.id)
        .limit(CANDIDATES_AT_ONCE + 1);
      const batch = rows.slice(0, CANDIDATES_AT_ONCE);
      const accessible = await accessibleDocumentIds(
        batch.map((row) => row.id),
      );
      openable.push(
        ...batch.filter((row) => accessible.has(row.id)).map((row) => row.id),
      );
      scanned += batch.length;
      const unread: boolean = rows.length > CANDIDATES_AT_ONCE;
      more = unread && scanned >= MAX_SCANNED;
      after = unread && !more ? (firstRow(batch.slice(-1)) ?? null) : null;
    } while (after);
    const shown = openable.slice(0, MAX_PAGES);
    const pages: z.infer<typeof backlinkSchema>[] = [];
    if (shown.length) {
      // guard:allow-unscoped — every id passed accessibleDocumentIds above.
      const rows = await db
        .select({
          id: schema.documents.id,
          title: schema.documents.title,
          icon: schema.documents.icon,
          updatedAt: schema.documents.updatedAt,
        })
        .from(schema.documents)
        .where(inArray(schema.documents.id, shown));
      const byId = new Map(rows.map((row) => [row.id, row]));
      for (const id of shown) {
        const row = byId.get(id);
        if (!row) continue;
        pages.push({
          id: row.id,
          title: shortTitle(row.title),
          icon: row.icon,
          url: createdPageUrl(row.id),
          updatedAt: row.updatedAt,
        });
      }
    }
    return {
      pages,
      count: openable.length,
      more,
    };
  },
});
