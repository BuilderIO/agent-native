import { inArray } from "drizzle-orm";

import { schema } from "../server/db/index.js";

type Db = any;

export async function assertNotWorkspaceCatalogDocuments(
  db: Db,
  documentIds: string[],
  operation: string,
) {
  if (documentIds.length === 0) return;
  const [workspaceReference] = await db
    .select({ id: schema.contentSpaceCatalogItems.id })
    .from(schema.contentSpaceCatalogItems)
    .where(inArray(schema.contentSpaceCatalogItems.documentId, documentIds));
  if (workspaceReference) {
    throw new Error(`Workspace references cannot be ${operation} as pages`);
  }
}
