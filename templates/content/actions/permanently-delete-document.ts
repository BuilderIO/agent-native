import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { deleteDocumentRecursive } from "./delete-document.js";

export default defineAction({
  description:
    "Permanently delete a document subtree that is already in Trash. This cannot be undone.",
  schema: z.object({
    id: z.string().describe("Trashed root document ID"),
  }),
  run: async ({ id }) => {
    const access = await assertAccess("document", id, "admin");
    const db = getDb();
    const [state] = await db
      .select({
        trashedAt: schema.documents.trashedAt,
        databaseDeletedAt: schema.contentDatabases.deletedAt,
      })
      .from(schema.documents)
      .leftJoin(
        schema.contentDatabases,
        eq(schema.contentDatabases.documentId, schema.documents.id),
      )
      .where(eq(schema.documents.id, id))
      .limit(1);
    if (!state?.trashedAt && !state?.databaseDeletedAt) {
      throw new Error("Document must be in Trash before permanent deletion");
    }

    const deleted = await db.transaction((tx) =>
      deleteDocumentRecursive(
        tx as unknown as ReturnType<typeof getDb>,
        id,
        access.resource.ownerEmail as string,
      ),
    );
    await writeAppState("refresh-signal", { ts: Date.now() });
    return { success: true, deleted: deleted.length };
  },
});
