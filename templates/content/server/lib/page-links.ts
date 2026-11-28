import { and, eq, inArray, notInArray } from "drizzle-orm";

import {
  mayHoldPageLinks,
  pageLinkReferencesInBody,
} from "../../shared/page-links-in-body.js";
import { getDb, schema } from "../db/index.js";

type Database = ReturnType<typeof getDb>;

const IDS_AT_ONCE = 300;

export async function pageLinkTargets(
  db: Database,
  documentId: string,
  body: string | null | undefined,
): Promise<string[]> {
  const references = pageLinkReferencesInBody(body).filter(
    (reference) => reference.id !== documentId,
  );
  const outside = references
    .filter((reference) => reference.outside)
    .map((reference) => reference.id);
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
    .filter((reference) => !reference.outside || existing.has(reference.id))
    .map((reference) => reference.id);
}

export async function syncPageLinks(
  db: Database,
  input: { documentId: string; before?: string | undefined; after: string },
): Promise<void> {
  if (
    input.before !== undefined &&
    !mayHoldPageLinks(input.before) &&
    !mayHoldPageLinks(input.after)
  ) {
    return;
  }
  const targets = await pageLinkTargets(db, input.documentId, input.after);
  await writePageLinks(db, input.documentId, targets);
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
  if (!documentIds.length) return;
  await db
    .delete(schema.pageLinks)
    .where(inArray(schema.pageLinks.sourceDocumentId, documentIds));
}
