import { and, eq, inArray, notInArray } from "drizzle-orm";

import {
  dashedNotionPageId,
  normalizeNotionPageId,
} from "../../shared/content-links.js";
import {
  mayHoldPageLinks,
  pageLinkTargetsInBody,
} from "../../shared/page-links-in-body.js";
import { getDb, schema } from "../db/index.js";
import { firstRow } from "./first-row.js";

type Database = ReturnType<typeof getDb>;

const IDS_AT_ONCE = 300;

async function importedPageIds(
  db: Database,
  documentId: string,
  ids: string[],
): Promise<string[]> {
  const forms = new Set<string>();
  for (const id of ids) {
    const key = normalizeNotionPageId(id);
    if (!key) continue;
    forms.add(key);
    forms.add(dashedNotionPageId(key));
    forms.add(id);
  }
  if (!forms.size) return [];
  // guard:allow-unscoped — reads only the linking page's owner, to resolve Notion page ids that owner imported.
  const source = firstRow(
    await db
      .select({ ownerEmail: schema.documents.ownerEmail })
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId))
      .limit(1),
  );
  if (!source) return [];
  const remote = [...forms];
  const resolved: string[] = [];
  for (let at = 0; at < remote.length; at += IDS_AT_ONCE) {
    // guard:allow-unscoped — ids only, limited to pages the linking page's owner imported; list-backlinks checks each viewer's access.
    const rows = await db
      .select({ documentId: schema.documentSyncLinks.documentId })
      .from(schema.documentSyncLinks)
      .innerJoin(
        schema.documents,
        eq(schema.documents.id, schema.documentSyncLinks.documentId),
      )
      .where(
        and(
          inArray(
            schema.documentSyncLinks.remotePageId,
            remote.slice(at, at + IDS_AT_ONCE),
          ),
          eq(schema.documents.ownerEmail, source.ownerEmail),
        ),
      );
    resolved.push(...rows.map((row) => row.documentId));
  }
  return resolved;
}

export async function pageLinkTargets(
  db: Database,
  documentId: string,
  body: string | null | undefined,
): Promise<string[]> {
  const ids = pageLinkTargetsInBody(body);
  if (!ids.length) return [];
  const named = new Set([
    ...ids,
    ...(await importedPageIds(db, documentId, ids)),
  ]);
  named.delete(documentId);
  const candidates = [...named];
  const targets: string[] = [];
  for (let at = 0; at < candidates.length; at += IDS_AT_ONCE) {
    // guard:allow-unscoped — ids only, to keep links to pages that exist; list-backlinks checks each viewer's access.
    const rows = await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        inArray(schema.documents.id, candidates.slice(at, at + IDS_AT_ONCE)),
      );
    targets.push(...rows.map((row) => row.id));
  }
  return targets;
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
