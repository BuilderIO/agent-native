import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { assertDocumentMutationAccess } from "./_document-mutation-access.js";
import { restoreDocumentSubtree } from "./delete-document.js";

export default defineAction({
  description: "Restore a page subtree from Trash.",
  schema: z.object({
    id: z.string().describe("Trashed root document ID"),
  }),
  run: async ({ id }) => {
    // Checked as moving it to Trash is: whoever could trash the page, or is
    // offered Restore on its access screen, must be able to restore it.
    const access = await assertDocumentMutationAccess(id, "admin");
    const restored = await getDb().transaction((tx) =>
      restoreDocumentSubtree(
        tx as unknown as ReturnType<typeof getDb>,
        id,
        access.resource.ownerEmail as string,
      ),
    );
    if (restored.length === 0) throw new Error("Document is not in Trash");

    await writeAppState("refresh-signal", { ts: Date.now() });
    return { success: true, restored: restored.length, documentId: id };
  },
});
