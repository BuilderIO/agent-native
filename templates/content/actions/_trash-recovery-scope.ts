import { createHash } from "node:crypto";

import { fail } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq, inArray, isNotNull, notInArray } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";

export type TrashRecoveryDocument = Pick<
  typeof schema.documents.$inferSelect,
  | "id"
  | "parentId"
  | "trashRootId"
  | "trashedAt"
  | "ownerEmail"
  | "spaceId"
  | "orgId"
  | "visibility"
>;

export function selectedTrashSubtree(
  documents: TrashRecoveryDocument[],
  selectedId: string,
): TrashRecoveryDocument[] {
  const root = documents.find((document) => document.id === selectedId);
  if (!root?.trashedAt || !root.trashRootId) {
    fail("The selected page is unavailable in Trash.", {
      errorCode: "TRASH_UNAVAILABLE",
      statusCode: 404,
    });
  }
  const selected = new Set([root.id]);
  if (root.id === root.trashRootId) {
    return documents
      .filter(
        (document) => document.trashedAt && document.trashRootId === root.id,
      )
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const document of documents) {
      if (
        document.trashedAt &&
        document.trashRootId === root.trashRootId &&
        document.parentId &&
        selected.has(document.parentId) &&
        !selected.has(document.id)
      ) {
        selected.add(document.id);
        changed = true;
      }
    }
  }
  return documents
    .filter((document) => selected.has(document.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function trashScopeToken(
  documents: TrashRecoveryDocument[],
  databaseIds: string[] = [],
  hostBindings: Array<{
    databaseId: string;
    documentId: string;
    hostDocumentId: string;
    ownerBlockId: string | null;
  }> = [],
  survivors: Array<TrashRecoveryDocument & { sourceMode: string | null }> = [],
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        [...databaseIds].sort(),
        [...hostBindings].sort((a, b) =>
          a.databaseId.localeCompare(b.databaseId),
        ),
        [...survivors]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((document) => [
            document.id,
            document.parentId,
            document.ownerEmail,
            document.orgId,
            document.spaceId,
            document.sourceMode,
            document.trashRootId,
            document.trashedAt,
            document.visibility,
          ]),
        [...documents]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((document) => [
            document.id,
            document.parentId,
            document.trashRootId,
            document.trashedAt,
            document.ownerEmail,
            document.spaceId,
            document.orgId,
            document.visibility,
          ]),
      ]),
    )
    .digest("hex");
}

export async function collectTrashRecoveryScope(
  db: ReturnType<typeof getDb>,
  id: string,
  operation: "restore" | "purge" = "purge",
) {
  const [root] = await db
    .select()
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, id),
        accessFilter(
          schema.documents,
          schema.documentShares,
          undefined,
          operation === "restore" ? "viewer" : "admin",
          { includePublic: operation === "restore" },
        ),
      ),
    )
    .limit(1);
  if (!root?.trashedAt || !root.trashRootId) {
    fail("The selected page is unavailable in Trash.", {
      errorCode: "TRASH_UNAVAILABLE",
      statusCode: 404,
    });
  }
  const documents = await db
    .select({
      id: schema.documents.id,
      parentId: schema.documents.parentId,
      trashRootId: schema.documents.trashRootId,
      trashedAt: schema.documents.trashedAt,
      ownerEmail: schema.documents.ownerEmail,
      spaceId: schema.documents.spaceId,
      orgId: schema.documents.orgId,
      visibility: schema.documents.visibility,
    })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.trashRootId, root.trashRootId),
        isNotNull(schema.documents.trashedAt),
      ),
    );
  const selected = selectedTrashSubtree(documents, id);
  const authorized = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(
      and(
        inArray(
          schema.documents.id,
          selected.map((document) => document.id),
        ),
        accessFilter(
          schema.documents,
          schema.documentShares,
          undefined,
          "admin",
        ),
      ),
    );
  const databases = await db
    .select({
      id: schema.contentDatabases.id,
      documentId: schema.contentDatabases.documentId,
      ownerDocumentId: schema.contentDatabases.ownerDocumentId,
      ownerBlockId: schema.contentDatabases.ownerBlockId,
    })
    .from(schema.contentDatabases)
    .where(
      inArray(
        schema.contentDatabases.documentId,
        selected.map((document) => document.id),
      ),
    );
  const adminDocumentIds = authorized.map((document) => document.id).sort();
  const adminIds = new Set(adminDocumentIds);
  const remaining = selected.filter((document) => !adminIds.has(document.id));
  const hostBindings: Array<{
    databaseId: string;
    documentId: string;
    hostDocumentId: string;
    ownerBlockId: string | null;
  }> = [];
  if (operation === "restore" && remaining.length) {
    const readable = await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        and(
          inArray(
            schema.documents.id,
            remaining.map((document) => document.id),
          ),
          accessFilter(
            schema.documents,
            schema.documentShares,
            undefined,
            "viewer",
            { includePublic: true },
          ),
        ),
      );
    const readableIds = new Set(readable.map((document) => document.id));
    const candidates = databases.filter((database) =>
      remaining.some(
        (document) =>
          document.id === database.documentId &&
          readableIds.has(document.id) &&
          database.ownerDocumentId !== null &&
          document.parentId === database.ownerDocumentId,
      ),
    );
    const candidateHostIds = [
      ...new Set(candidates.map((database) => database.ownerDocumentId!)),
    ];
    const hosts = candidateHostIds.length
      ? await db
          .select({ id: schema.documents.id })
          .from(schema.documents)
          .where(
            and(
              inArray(schema.documents.id, candidateHostIds),
              accessFilter(
                schema.documents,
                schema.documentShares,
                undefined,
                "editor",
              ),
            ),
          )
      : [];
    const hostIds = new Set(hosts.map((host) => host.id));
    for (const database of candidates) {
      if (hostIds.has(database.ownerDocumentId!))
        hostBindings.push({
          databaseId: database.id,
          documentId: database.documentId,
          hostDocumentId: database.ownerDocumentId!,
          ownerBlockId: database.ownerBlockId,
        });
    }
  }
  const authorizedDatabaseIds = new Set(
    hostBindings.map((binding) => binding.databaseId),
  );
  const viewerDocumentIds = remaining
    .filter((document) => {
      const backingDatabases = databases.filter(
        (database) => database.documentId === document.id,
      );
      return (
        backingDatabases.length > 0 &&
        backingDatabases.every((database) =>
          authorizedDatabaseIds.has(database.id),
        )
      );
    })
    .map((document) => document.id)
    .sort();
  if (adminDocumentIds.length + viewerDocumentIds.length !== selected.length) {
    fail("You cannot manage every page in this selection.", {
      errorCode: "TRASH_ACCESS_DENIED",
      statusCode: 403,
    });
  }
  for (const document of selected) {
    if (
      document.ownerEmail !== root.ownerEmail ||
      document.spaceId !== root.spaceId ||
      document.orgId !== root.orgId
    ) {
      fail("The selected subtree crosses an ownership or space boundary.", {
        errorCode: "TRASH_SCOPE_CONFLICT",
        statusCode: 409,
      });
    }
  }
  const survivors =
    operation === "purge"
      ? await db
          .select({
            id: schema.documents.id,
            parentId: schema.documents.parentId,
            ownerEmail: schema.documents.ownerEmail,
            orgId: schema.documents.orgId,
            spaceId: schema.documents.spaceId,
            sourceMode: schema.documents.sourceMode,
            trashRootId: schema.documents.trashRootId,
            trashedAt: schema.documents.trashedAt,
            visibility: schema.documents.visibility,
          })
          .from(schema.documents)
          .where(
            and(
              inArray(
                schema.documents.parentId,
                selected.map((document) => document.id),
              ),
              notInArray(
                schema.documents.id,
                selected.map((document) => document.id),
              ),
            ),
          )
      : [];
  if (survivors.length) {
    const authorizedSurvivors = await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        and(
          inArray(
            schema.documents.id,
            survivors.map((document) => document.id),
          ),
          accessFilter(
            schema.documents,
            schema.documentShares,
            undefined,
            "editor",
          ),
        ),
      );
    if (authorizedSurvivors.length !== survivors.length)
      fail(
        "You no longer have permission to change every page in this operation.",
        { errorCode: "DOCUMENT_MUTATION_ACCESS_CHANGED", statusCode: 403 },
      );
    if (
      survivors.some(
        (document) =>
          document.ownerEmail !== root.ownerEmail ||
          document.orgId !== root.orgId ||
          document.spaceId !== root.spaceId,
      )
    )
      fail("The selected subtree crosses an ownership or space boundary.", {
        errorCode: "TRASH_SCOPE_CONFLICT",
        statusCode: 409,
      });
    const survivorDatabases = await db
      .select({
        ownerDocumentId: schema.contentDatabases.ownerDocumentId,
        ownerBlockId: schema.contentDatabases.ownerBlockId,
      })
      .from(schema.contentDatabases)
      .where(
        inArray(
          schema.contentDatabases.documentId,
          survivors.map((document) => document.id),
        ),
      );
    if (
      survivors.some((document) => document.sourceMode === "local-files") ||
      survivorDatabases.some(
        (database) =>
          database.ownerDocumentId !== null || database.ownerBlockId !== null,
      )
    )
      fail(
        "Restore or move the surviving source-backed or block-owned page before deleting its parent.",
        { errorCode: "TRASH_SURVIVOR_DESTINATION_CONFLICT", statusCode: 409 },
      );
  }
  return {
    documents: selected,
    documentIds: selected.map((document) => document.id),
    ownedDatabaseIds: databases.map((database) => database.id),
    adminDocumentIds,
    viewerDocumentIds,
    hostDocumentIds: [
      ...new Set(hostBindings.map((binding) => binding.hostDocumentId)),
    ].sort(),
    requiresOriginalDestination: viewerDocumentIds.length > 0,
    detachedDocumentIds: survivors.map((document) => document.id).sort(),
    root,
    token: trashScopeToken(
      selected,
      databases.map((database) => database.id),
      hostBindings,
      survivors,
    ),
  };
}

export function assertTrashScopeToken(actual: string, expected?: string) {
  if (expected !== undefined && actual !== expected) {
    fail("The Trash selection changed. Review its scope again.", {
      errorCode: "TRASH_SCOPE_CONFLICT",
      statusCode: 409,
    });
  }
}
