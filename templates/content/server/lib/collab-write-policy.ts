import type { DbExec } from "@agent-native/core/db";
import { eq } from "drizzle-orm";

import { assertSourceAllowsPageEdit } from "../../actions/_document-source.js";
import { drizzleOverExec } from "../db/exec.js";
import { schema } from "../db/index.js";

export async function assertContentCollabWriteAllowed(
  tx: DbExec,
  documentId: string,
): Promise<void> {
  // guard:allow-unscoped — collaboration routes authorize the page before writing; other app document IDs have no Content row.
  const [page] = await drizzleOverExec(tx)
    .select({
      sourceMode: schema.documents.sourceMode,
      sourceRootPath: schema.documents.sourceRootPath,
      sourcePath: schema.documents.sourcePath,
    })
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId))
    .for("update");
  if (page) assertSourceAllowsPageEdit(page);
}
