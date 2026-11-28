import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { createdPageUrl } from "../server/lib/created-page-links.js";
import { firstRow } from "../server/lib/first-row.js";
import { isPublicViewerOwner } from "../server/lib/public-documents.js";
import {
  accessibleDocumentIds,
  resolveDocumentAccess,
} from "./_document-access.js";
import { softDeletedDatabaseDocumentExclusions } from "./_document-discovery-query.js";

const MAX_PAGES = 200;

const CANDIDATES_AT_ONCE = 200;

const MAX_CANDIDATES = 1_000;

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
    "Lists the pages you can open that link to or mention a page, most recently edited first, with each one's id, title, icon, link and last edit. count is how many there are; at most 200 are listed, and more is true when there may be others. A link counts once its page is saved. Pages in Trash are left out until restored, and so is the page's parent, which holds it as a sub-page.",
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
    // guard:allow-unscoped — the caller can open this page, as resolveDocumentAccess just checked.
    const placed = firstRow(
      await db
        .select({ parentId: schema.documents.parentId })
        .from(schema.documents)
        .where(eq(schema.documents.id, documentId))
        .limit(1),
    );
    const parentId = placed?.parentId ?? null;
    // guard:allow-unscoped — ids only; accessibleDocumentIds below keeps the pages the caller can open before anything about them is read.
    const candidates = await db
      .select({ id: schema.documents.id })
      .from(links)
      .innerJoin(
        schema.documents,
        eq(schema.documents.id, links.sourceDocumentId),
      )
      .where(
        and(
          eq(links.targetDocumentId, documentId),
          parentId ? ne(schema.documents.id, parentId) : undefined,
          isNull(schema.documents.trashedAt),
          ...softDeletedDatabaseDocumentExclusions(schema.documents.id),
        ),
      )
      .orderBy(desc(schema.documents.updatedAt), schema.documents.id)
      .limit(MAX_CANDIDATES + 1);
    const ids = candidates.slice(0, MAX_CANDIDATES).map((row) => row.id);
    const openable: string[] = [];
    for (let at = 0; at < ids.length; at += CANDIDATES_AT_ONCE) {
      const slice = ids.slice(at, at + CANDIDATES_AT_ONCE);
      const accessible = await accessibleDocumentIds(slice);
      openable.push(...slice.filter((id) => accessible.has(id)));
    }
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
      more: openable.length > MAX_PAGES || candidates.length > MAX_CANDIDATES,
    };
  },
});
