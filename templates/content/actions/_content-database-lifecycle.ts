import { assertAccess, resolveAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import type { InlineDatabaseData } from "../shared/inline-database-block.js";
import { parseRegistryBlockData } from "../shared/nfm-registry.js";
import { nfmToDoc, type PMNode } from "../shared/nfm.js";

type DatabaseRow = typeof schema.contentDatabases.$inferSelect;
type DocumentRow = typeof schema.documents.$inferSelect;

interface DatabaseOwnership {
  database: DatabaseRow;
  backingDocument: DocumentRow;
  isBlockOwned: boolean;
}

export async function getDatabaseOwnership(
  databaseId: string,
): Promise<DatabaseOwnership | null> {
  const db = getDb();
  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, databaseId));
  if (!database) return null;

  const backingDocumentAccess = await resolveAccess(
    "document",
    database.documentId,
  );
  if (!backingDocumentAccess) return null;
  const backingDocument = backingDocumentAccess.resource as DocumentRow;

  return {
    database,
    backingDocument,
    isBlockOwned:
      !!database.ownerDocumentId &&
      backingDocument.parentId === database.ownerDocumentId,
  };
}

export async function assertContentDatabaseLifecycleAccess(
  databaseId: string,
): Promise<DatabaseOwnership> {
  const ownership = await getDatabaseOwnership(databaseId);
  if (!ownership) throw new Error(`Database "${databaseId}" not found`);

  if (ownership.isBlockOwned && ownership.database.ownerDocumentId) {
    await assertAccess(
      "document",
      ownership.database.ownerDocumentId,
      "editor",
    );
    return ownership;
  }

  await assertAccess("document", ownership.database.documentId, "admin");
  return ownership;
}

type InlineDatabaseBlockSet =
  | { ok: true; ownerBlockIds: Set<string> }
  | { ok: false };

function walkNodes(node: PMNode | undefined, visit: (node: PMNode) => void) {
  if (!node) return;
  visit(node);
  for (const child of node.content ?? []) {
    walkNodes(child, visit);
  }
}

function isInlineDatabaseData(value: unknown): value is InlineDatabaseData {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as InlineDatabaseData).ownerBlockId === "string"
  );
}

export async function collectInlineDatabaseOwnerBlockIds(
  content: string,
): Promise<InlineDatabaseBlockSet> {
  let doc;
  try {
    doc = nfmToDoc(content);
  } catch {
    return { ok: false };
  }

  const ownerBlockIds = new Set<string>();
  const inlineBlocks: PMNode[] = [];
  walkNodes(doc, (node) => {
    if (
      node.type === "registryBlock" &&
      node.attrs?.blockType === "inline-database"
    ) {
      inlineBlocks.push(node);
    }
  });

  for (const block of inlineBlocks) {
    const blockId =
      typeof block.attrs?.blockId === "string" ? block.attrs.blockId : "";
    if (blockId) ownerBlockIds.add(blockId);

    const raw = typeof block.attrs?.__raw === "string" ? block.attrs.__raw : "";
    if (!raw) return { ok: false };

    try {
      const parsed = await parseRegistryBlockData(raw);
      if (!parsed || parsed.type !== "inline-database") return { ok: false };
      if (!isInlineDatabaseData(parsed.data)) return { ok: false };
      if (parsed.data.ownerBlockId) ownerBlockIds.add(parsed.data.ownerBlockId);
    } catch {
      return { ok: false };
    }
  }

  if (content.includes("<InlineDatabase") && inlineBlocks.length === 0) {
    return { ok: false };
  }

  return { ok: true, ownerBlockIds };
}

export async function reconcileInlineDatabasesForDocument(
  documentId: string,
  content: string,
): Promise<string[]> {
  const parsed = await collectInlineDatabaseOwnerBlockIds(content);
  if (!parsed.ok) return [];

  const db = getDb();
  const candidates = await db
    .select({ database: schema.contentDatabases })
    .from(schema.contentDatabases)
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.contentDatabases.documentId),
    )
    .where(
      and(
        eq(schema.contentDatabases.ownerDocumentId, documentId),
        eq(schema.documents.parentId, documentId),
        isNull(schema.contentDatabases.deletedAt),
      ),
    );

  const missing = candidates
    .map((row) => row.database)
    .filter(
      (database) =>
        database.ownerBlockId &&
        !parsed.ownerBlockIds.has(database.ownerBlockId),
    );

  if (missing.length === 0) return [];

  const now = new Date().toISOString();
  const ids = missing.map((database) => database.id);
  await db
    .update(schema.contentDatabases)
    .set({ deletedAt: now, updatedAt: now })
    .where(inArray(schema.contentDatabases.id, ids));

  return ids;
}
