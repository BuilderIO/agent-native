import { ActionContractError } from "@agent-native/core";
import { assertAccess, resolveAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, isNull, or } from "drizzle-orm";

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
  | { ok: true; ownerBlockIds: Set<string>; inlineDatabaseKeys: Set<string> }
  | { ok: false };

function inlineDatabaseKey(
  ownerBlockId: string,
  databaseId: string,
  databaseDocumentId: string,
) {
  return JSON.stringify([ownerBlockId, databaseId, databaseDocumentId]);
}

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
  const inlineDatabaseKeys = new Set<string>();
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
      const { databaseId, databaseDocumentId } = parsed.data;
      if (databaseId && databaseDocumentId) {
        for (const id of [blockId, parsed.data.ownerBlockId]) {
          if (id) {
            inlineDatabaseKeys.add(
              inlineDatabaseKey(id, databaseId, databaseDocumentId),
            );
          }
        }
      }
    } catch {
      return { ok: false };
    }
  }

  if (content.includes("<InlineDatabase") && inlineBlocks.length === 0) {
    return { ok: false };
  }

  return { ok: true, ownerBlockIds, inlineDatabaseKeys };
}

export async function reconcileInlineDatabasesForDocumentWithDb(args: {
  db: ReturnType<typeof getDb>;
  documentId: string;
  content: string;
  ownerEmail?: string;
  now?: string;
  /** The collections `lockDocumentForSave` locked before the page. */
  lockedDatabaseIds: ReadonlySet<string>;
}): Promise<string[]> {
  const parsed = await collectInlineDatabaseOwnerBlockIds(args.content);
  if (!parsed.ok) return [];

  const candidates = await args.db
    .select({ database: schema.contentDatabases })
    .from(schema.contentDatabases)
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.contentDatabases.documentId),
    )
    .where(
      and(
        eq(schema.contentDatabases.ownerDocumentId, args.documentId),
        eq(schema.documents.parentId, args.documentId),
        or(
          isNull(schema.contentDatabases.deletedAt),
          isNull(schema.documents.trashedAt),
        ),
        ...(args.ownerEmail
          ? [
              eq(schema.contentDatabases.ownerEmail, args.ownerEmail),
              eq(schema.documents.ownerEmail, args.ownerEmail),
            ]
          : []),
      ),
    );

  const owned = candidates.flatMap(({ database }) =>
    database.ownerBlockId
      ? [
          {
            database,
            blockPresent: parsed.ownerBlockIds.has(database.ownerBlockId),
            blockNamesIt: parsed.inlineDatabaseKeys.has(
              inlineDatabaseKey(
                database.ownerBlockId,
                database.id,
                database.documentId,
              ),
            ),
          },
        ]
      : [],
  );
  const missing = owned
    .filter(
      ({ database, blockPresent }) => !database.deletedAt && !blockPresent,
    )
    .map(({ database }) => database);
  const returned = owned
    .filter(
      ({ database, blockNamesIt }) => !!database.deletedAt && blockNamesIt,
    )
    .map(({ database }) => database);

  if (missing.length === 0 && returned.length === 0) return [];
  // Created after the caller locked its collections. Locking it now, after the
  // page, deadlocks against a Trash of the page, which locks it first.
  if (
    [...missing, ...returned].some(
      (database) => !args.lockedDatabaseIds.has(database.id),
    )
  ) {
    throw new ActionContractError(
      "An inline collection was added to the document while it saved. Read the document again and retry.",
      { errorCode: "DOCUMENT_METADATA_SCOPE_CHANGED", statusCode: 409 },
    );
  }

  const now = args.now ?? new Date().toISOString();
  const ids = missing.map((database) => database.id);
  if (ids.length > 0) {
    await args.db
      .update(schema.contentDatabases)
      .set({ deletedAt: now, updatedAt: now })
      .where(inArray(schema.contentDatabases.id, ids));
  }
  if (returned.length > 0) {
    await args.db
      .update(schema.contentDatabases)
      .set({ deletedAt: null, updatedAt: now })
      .where(
        inArray(
          schema.contentDatabases.id,
          returned.map((database) => database.id),
        ),
      );
  }

  return ids;
}
