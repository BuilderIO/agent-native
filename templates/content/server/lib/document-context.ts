import { resolveAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

export type DocumentContextPathEntry = {
  id: string;
  kind: "page" | "database";
  title: string;
  description: string;
};

/** Focused-read context only: owned descriptions stay on their objects; this
 * assembles the live path without copying ancestor prose into descendants. */
export async function getDocumentContextPath(
  document: Pick<typeof schema.documents.$inferSelect, "id" | "parentId">,
): Promise<DocumentContextPathEntry[]> {
  const db = getDb();
  const path: DocumentContextPathEntry[] = [];
  const seen = new Set<string>([document.id]);
  let parentId = document.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parentAccess = await resolveAccess("document", parentId);
    // A child share must not disclose prose from an inaccessible ancestor.
    if (!parentAccess) break;
    const parent = parentAccess.resource;
    const [database] = await db
      .select()
      .from(schema.contentDatabases)
      .where(
        and(
          eq(schema.contentDatabases.documentId, parent.id),
          isNull(schema.contentDatabases.deletedAt),
        ),
      );
    path.unshift({
      id: database?.id ?? parent.id,
      kind: database ? "database" : "page",
      title: database?.title ?? parent.title,
      description: parent.description,
    });
    parentId = parent.parentId;
  }

  const [membership] = await db
    .select({ database: schema.contentDatabases })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.contentDatabases,
      eq(schema.contentDatabases.id, schema.contentDatabaseItems.databaseId),
    )
    .where(
      and(
        eq(schema.contentDatabaseItems.documentId, document.id),
        isNull(schema.contentDatabases.deletedAt),
      ),
    );
  if (
    membership &&
    !path.some((entry) => entry.id === membership.database.id)
  ) {
    const databaseDocumentAccess = await resolveAccess(
      "document",
      membership.database.documentId,
    );
    if (!databaseDocumentAccess) return path;
    path.push({
      id: membership.database.id,
      kind: "database",
      title: membership.database.title,
      description: databaseDocumentAccess.resource.description,
    });
  }
  return path;
}
