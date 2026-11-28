import { and, eq, inArray, notInArray } from "drizzle-orm";

import {
  mayHoldPageLinks,
  pageLinkReferencesInBody,
} from "../../shared/page-links-in-body.js";
import { getDb, schema } from "../db/index.js";

type Database = ReturnType<typeof getDb>;

type PageBody = {
  documentId: string;
  before?: string | undefined;
  after: string;
};

const IDS_AT_ONCE = 300;
const ROWS_AT_ONCE = 1_000;

function needsSync(page: PageBody): boolean {
  return (
    page.before === undefined ||
    mayHoldPageLinks(page.before) ||
    mayHoldPageLinks(page.after)
  );
}

export async function pageLinkTargets(
  db: Database,
  documentId: string,
  body: string | null | undefined,
): Promise<string[]> {
  const references = pageLinkReferencesInBody(body).filter(
    (reference) => reference.target !== documentId,
  );
  const outside = references
    .filter((reference) => reference.outside)
    .map((reference) => reference.target);
  const existing = new Set<string>();
  for (let at = 0; at < outside.length; at += IDS_AT_ONCE) {
    // guard:allow-unscoped — ids only, to keep a full URL's link only when it names a page here; list-backlinks checks each viewer's access.
    const rows = await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(inArray(schema.documents.id, outside.slice(at, at + IDS_AT_ONCE)));
    for (const row of rows) existing.add(row.id);
  }
  return references
    .filter((reference) => !reference.outside || existing.has(reference.target))
    .map((reference) => reference.target);
}

export async function syncPageLinks(
  db: Database,
  input: PageBody,
): Promise<void> {
  if (!needsSync(input)) return;
  const targets = await pageLinkTargets(db, input.documentId, input.after);
  await writePageLinks(db, input.documentId, targets);
}

export async function syncPageLinksMany(
  db: Database,
  pages: PageBody[],
): Promise<void> {
  const changed = pages.filter(needsSync);
  if (!changed.length) return;
  const rows: { sourceDocumentId: string; targetDocumentId: string }[] = [];
  for (const page of changed) {
    for (const targetDocumentId of await pageLinkTargets(
      db,
      page.documentId,
      page.after,
    )) {
      rows.push({ sourceDocumentId: page.documentId, targetDocumentId });
    }
  }
  await clearPageLinks(
    db,
    changed.map((page) => page.documentId),
  );
  for (let at = 0; at < rows.length; at += ROWS_AT_ONCE) {
    await db
      .insert(schema.pageLinks)
      .values(rows.slice(at, at + ROWS_AT_ONCE))
      .onConflictDoNothing();
  }
}

export async function writePageLinks(
  db: Database,
  documentId: string,
  targets: string[],
): Promise<void> {
  const links = schema.pageLinks;
  await db
    .delete(links)
    .where(
      targets.length
        ? and(
            eq(links.sourceDocumentId, documentId),
            notInArray(links.targetDocumentId, targets),
          )
        : eq(links.sourceDocumentId, documentId),
    );
  if (!targets.length) return;
  await db
    .insert(links)
    .values(
      targets.map((targetDocumentId) => ({
        sourceDocumentId: documentId,
        targetDocumentId,
      })),
    )
    .onConflictDoNothing();
}

export async function clearPageLinks(
  db: Database,
  documentIds: string[],
): Promise<void> {
  for (let at = 0; at < documentIds.length; at += IDS_AT_ONCE) {
    await db
      .delete(schema.pageLinks)
      .where(
        inArray(
          schema.pageLinks.sourceDocumentId,
          documentIds.slice(at, at + IDS_AT_ONCE),
        ),
      );
  }
}
