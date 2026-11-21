import { ActionContractError } from "@agent-native/core/action";
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
    throw new ActionContractError(
      `Workspace references cannot be ${operation} as pages`,
      { errorCode: "WORKSPACE_CATALOG_REFERENCE_PROTECTED", statusCode: 409 },
    );
  }
}
