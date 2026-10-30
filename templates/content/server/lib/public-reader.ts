// guard:allow-unscoped — the signed-out reader of a public page sees only pages that are themselves public and not in the trash.
import { safeParseIconValue, type IconValue } from "@agent-native/core/icons";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { softDeletedDatabaseDocumentExclusions } from "../../actions/_document-discovery-query.js";
import {
  dashedNotionPageId,
  isContentLinkId,
  normalizeNotionPageId,
  pageLinkBlockId,
} from "../../shared/content-links.js";
import { nfmToDoc, type PMNode } from "../../shared/nfm.js";
import type {
  PublicReaderContext,
  PublicReaderPage,
} from "../../shared/public-reader";
import { getDb, schema } from "../db/index.js";

export const PUBLIC_READER_MAX_ANCESTORS = 8;
export const PUBLIC_READER_MAX_SUB_PAGES = 100;
/** Page blocks past this many, in reading order, show their stored label. */
export const PUBLIC_READER_MAX_PAGE_LINKS = 500;

/**
 * An icon a signed-out reader can load. An uploaded icon is served only to
 * people who can open its page, which a reader without an account can't.
 */
export function publicReaderIcon(raw: string | null): IconValue | null {
  const parsed = safeParseIconValue(raw);
  if (!parsed.success || !parsed.data) return null;
  if (parsed.data.kind === "image" && parsed.data.authority === "private-icon")
    return null;
  return parsed.data;
}

function readerPage(row: {
  id: string;
  title: string;
  icon: string | null;
}): PublicReaderPage {
  return { id: row.id, title: row.title, icon: publicReaderIcon(row.icon) };
}

function parseAttrsJson(value: unknown): Record<string, string> {
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    // coercion-ok: a block whose attributes don't parse names no page.
    return {};
  }
}

/** The pages the body's page-link blocks name, in reading order. */
export function pageLinkBlockIds(content: string): string[] {
  const ids = new Set<string>();
  const visit = (node: PMNode) => {
    if (node.type === "notionBlockAtom" && node.attrs?.tagName === "page") {
      const id = pageLinkBlockId(parseAttrsJson(node.attrs.attrsJson));
      if (id && isContentLinkId(id)) ids.add(id);
    }
    for (const child of node.content ?? []) visit(child);
  };
  for (const node of nfmToDoc(content).content) visit(node);
  return [...ids].slice(0, PUBLIC_READER_MAX_PAGE_LINKS);
}

/**
 * The public pages the body's page-link blocks open, by the id each block
 * names: a Content page's own id, or the Notion page an import of the same
 * owner's came from.
 */
async function loadPageLinks(content: string, ownerEmail: string) {
  const ids = pageLinkBlockIds(content);
  const links: Record<string, PublicReaderPage> = {};
  if (ids.length === 0) return links;
  const db = getDb();
  const page = {
    id: schema.documents.id,
    title: schema.documents.title,
    icon: schema.documents.icon,
  };
  const readable = [
    eq(schema.documents.visibility, "public"),
    isNull(schema.documents.trashedAt),
    ...softDeletedDatabaseDocumentExclusions(schema.documents.id),
  ];
  const idsByNotionPage = new Map<string, string[]>();
  for (const id of ids) {
    const key = normalizeNotionPageId(id);
    if (key)
      idsByNotionPage.set(key, [...(idsByNotionPage.get(key) ?? []), id]);
  }
  const remotePageIds = [
    ...new Set(
      [...idsByNotionPage].flatMap(([key, forms]) => [
        key,
        dashedNotionPageId(key),
        ...forms,
      ]),
    ),
  ];

  const [direct, imported] = await Promise.all([
    db
      .select(page)
      .from(schema.documents)
      .where(and(inArray(schema.documents.id, ids), ...readable)),
    remotePageIds.length
      ? db
          .select({
            remotePageId: schema.documentSyncLinks.remotePageId,
            ...page,
          })
          .from(schema.documentSyncLinks)
          .innerJoin(
            schema.documents,
            eq(schema.documents.id, schema.documentSyncLinks.documentId),
          )
          .where(
            and(
              inArray(schema.documentSyncLinks.remotePageId, remotePageIds),
              eq(schema.documents.ownerEmail, ownerEmail),
              ...readable,
            ),
          )
          .orderBy(asc(schema.documents.position), asc(schema.documents.id))
      : [],
  ]);

  for (const row of direct) links[row.id] = readerPage(row);
  for (const { remotePageId, ...row } of imported) {
    const key = normalizeNotionPageId(remotePageId);
    for (const id of (key && idsByNotionPage.get(key)) || []) {
      links[id] ??= readerPage(row);
    }
  }
  return links;
}

export async function loadPublicReaderContext(doc: {
  id: string;
  parentId: string | null;
  icon: string | null;
  content: string;
  ownerEmail: string;
}): Promise<PublicReaderContext> {
  const db = getDb();
  const ancestors: PublicReaderPage[] = [];
  const seen = new Set([doc.id]);
  let parentId = doc.parentId;
  while (
    parentId &&
    !seen.has(parentId) &&
    ancestors.length < PUBLIC_READER_MAX_ANCESTORS
  ) {
    seen.add(parentId);
    const rows = await db
      .select({
        id: schema.documents.id,
        title: schema.documents.title,
        icon: schema.documents.icon,
        parentId: schema.documents.parentId,
      })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.id, parentId),
          eq(schema.documents.visibility, "public"),
          isNull(schema.documents.trashedAt),
        ),
      )
      .limit(1);
    if (rows.length === 0) break;
    const parent = rows[0];
    ancestors.unshift(readerPage(parent));
    parentId = parent.parentId;
  }

  const subPages = await db
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      icon: schema.documents.icon,
    })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.parentId, doc.id),
        eq(schema.documents.visibility, "public"),
        isNull(schema.documents.trashedAt),
        ...softDeletedDatabaseDocumentExclusions(schema.documents.id),
      ),
    )
    .orderBy(asc(schema.documents.position), asc(schema.documents.id))
    .limit(PUBLIC_READER_MAX_SUB_PAGES);

  // A sub-page the body already links to is read where the author put it.
  const pageLinks = await loadPageLinks(doc.content, doc.ownerEmail);
  const linkedPageIds = new Set(
    Object.values(pageLinks).map((page) => page.id),
  );

  return {
    icon: publicReaderIcon(doc.icon),
    ancestors,
    subPages: subPages
      .filter((page) => !linkedPageIds.has(page.id))
      .map(readerPage),
    pageLinks,
  };
}
