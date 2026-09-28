import { eq, inArray } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

export async function propagateDocumentTitle(args: {
  db: ReturnType<typeof getDb>;
  documentId: string;
  title: string;
  updatedAt: string;
}): Promise<void> {
  const [database] = await args.db
    .select({
      id: schema.contentDatabases.id,
      spaceId: schema.contentDatabases.spaceId,
      systemRole: schema.contentDatabases.systemRole,
    })
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.documentId, args.documentId));
  if (!database) return;

  const title =
    database.systemRole === "files"
      ? args.title.trim() || "Untitled"
      : args.title;
  await args.db
    .update(schema.contentDatabases)
    .set({ title, updatedAt: args.updatedAt })
    .where(eq(schema.contentDatabases.id, database.id));
  if (database.systemRole !== "files" || !database.spaceId) return;

  await args.db
    .update(schema.documents)
    .set({ title, updatedAt: args.updatedAt })
    .where(eq(schema.documents.id, args.documentId));
  await args.db
    .update(schema.contentSpaces)
    .set({ name: title, updatedAt: args.updatedAt })
    .where(eq(schema.contentSpaces.id, database.spaceId));
  const catalogReferences = await args.db
    .select({ documentId: schema.contentSpaceCatalogItems.documentId })
    .from(schema.contentSpaceCatalogItems)
    .where(eq(schema.contentSpaceCatalogItems.spaceId, database.spaceId));
  if (catalogReferences.length === 0) return;

  await args.db
    .update(schema.documents)
    .set({ title, updatedAt: args.updatedAt })
    .where(
      inArray(
        schema.documents.id,
        catalogReferences.map((reference) => reference.documentId),
      ),
    );
}
