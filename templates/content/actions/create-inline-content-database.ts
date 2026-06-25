import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type { CreateInlineDatabaseResponse } from "../shared/api.js";
import { getContentDatabaseResponse } from "./_database-utils.js";
import { nanoid } from "./_property-utils.js";
import {
  createContentDatabaseRecord,
  databaseTitleForPage,
} from "./create-content-database.js";

function createInlineDatabaseBlockId(): string {
  return `inline-database-${nanoid(8)}`;
}

export default defineAction({
  description:
    "Create a content database owned by an inline database block in a host page.",
  schema: z.object({
    hostDocumentId: z.string().describe("Host page document ID"),
    title: z.string().optional().describe("Database title"),
  }),
  run: async ({
    hostDocumentId,
    title,
  }): Promise<CreateInlineDatabaseResponse> => {
    const db = getDb();
    const ownerBlockId = createInlineDatabaseBlockId();
    let databaseId: string | null = null;
    let databaseDocumentId: string | null = null;

    await db.transaction(async (tx) => {
      databaseId = await createContentDatabaseRecord(
        {
          parentId: hostDocumentId,
          title: databaseTitleForPage(title),
        },
        { db: tx },
      );

      const [updated] = await tx
        .update(schema.contentDatabases)
        .set({
          ownerDocumentId: hostDocumentId,
          ownerBlockId,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.contentDatabases.id, databaseId))
        .returning({
          documentId: schema.contentDatabases.documentId,
        });

      if (!updated?.documentId) {
        throw new Error("Inline database was not created.");
      }
      databaseDocumentId = updated.documentId;
    });

    if (!databaseId || !databaseDocumentId) {
      throw new Error("Inline database was not created.");
    }

    const { database } = await getContentDatabaseResponse(databaseId);
    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      database,
      block: {
        databaseId,
        databaseDocumentId,
        ownerBlockId,
      },
    };
  },
});
