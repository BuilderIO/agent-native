import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { resolveContentSpaceAccess } from "./_content-space-access.js";
import { deleteDocumentRecursive } from "./delete-document.js";

type Db = ReturnType<typeof getDb>;

export async function deleteUserContentSpace(db: Db, spaceId: string) {
  return db.transaction(async (tx) => {
    const scopedDb = tx as unknown as Db;
    const access = await resolveContentSpaceAccess(spaceId, "editor", {
      db: scopedDb,
    });
    if (access.role !== "owner" || access.space.kind !== "user") {
      throw new Error("Only user-created workspaces can be deleted");
    }

    const [mapping] = await scopedDb
      .select()
      .from(schema.contentSpaceCatalogItems)
      .where(
        and(
          eq(schema.contentSpaceCatalogItems.spaceId, spaceId),
          eq(
            schema.contentSpaceCatalogItems.ownerEmail,
            access.authority.userEmail,
          ),
        ),
      );
    if (!mapping) throw new Error("Workspace catalog entry not found");

    const [filesDatabase] = await scopedDb
      .select({ documentId: schema.contentDatabases.documentId })
      .from(schema.contentDatabases)
      .where(
        and(
          eq(schema.contentDatabases.id, access.space.filesDatabaseId),
          eq(schema.contentDatabases.spaceId, spaceId),
          eq(schema.contentDatabases.systemRole, "files"),
        ),
      );
    if (!filesDatabase) throw new Error("Workspace Files database not found");

    await scopedDb
      .delete(schema.contentSpaceCatalogItems)
      .where(eq(schema.contentSpaceCatalogItems.id, mapping.id));
    const deletedCatalogDocuments = await deleteDocumentRecursive(
      scopedDb,
      mapping.documentId,
      access.space.ownerEmail,
    );
    const deletedWorkspaceDocuments = await deleteDocumentRecursive(
      scopedDb,
      filesDatabase.documentId,
      access.space.ownerEmail,
    );

    const remainingDocuments = await scopedDb
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.spaceId, spaceId),
          eq(schema.documents.ownerEmail, access.space.ownerEmail),
        ),
      );
    if (remainingDocuments.length > 0) {
      throw new Error(
        "Workspace contains content outside its canonical Files database",
      );
    }

    await scopedDb
      .delete(schema.contentSpaces)
      .where(eq(schema.contentSpaces.id, spaceId));

    return {
      spaceId,
      deletedDocuments:
        deletedCatalogDocuments.length + deletedWorkspaceDocuments.length,
    };
  });
}
