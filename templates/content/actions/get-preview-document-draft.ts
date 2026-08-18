import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { readPreviewDocumentDraft } from "./_preview-document-draft.js";

export default defineAction({
  description: "Read the current user's private preview draft for a document.",
  schema: z.object({ documentId: z.string().min(1) }),
  http: { method: "GET" },
  agentTool: false,
  toolCallable: false,
  run: async ({ documentId }) => {
    const userEmail = getRequestUserEmail();
    const orgId = getRequestOrgId() ?? "";
    if (!userEmail) throw new Error("Not authenticated.");
    await assertAccess("document", documentId, "editor");
    return {
      draft: await readPreviewDocumentDraft(userEmail, orgId, documentId),
    };
  },
});
