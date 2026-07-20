import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { deleteTrashedDocumentSubtree } from "./delete-document.js";

export default defineAction({
  description:
    "Permanently delete a document subtree that is already in Trash. This cannot be undone.",
  schema: z.object({
    id: z.string().describe("Trashed root document ID"),
  }),
  run: async ({ id }) => {
    const access = await assertAccess("document", id, "admin");
    const db = getDb();
    const deleted = await db.transaction((tx) =>
      deleteTrashedDocumentSubtree(
        tx as unknown as ReturnType<typeof getDb>,
        id,
        access.resource.ownerEmail as string,
      ),
    );
    await writeAppState("refresh-signal", { ts: Date.now() });
    return { success: true, deleted: deleted.length };
  },
});
