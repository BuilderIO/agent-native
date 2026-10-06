import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { previewDocumentDraftAnswer } from "./_preview-document-draft.js";

export default defineAction({
  description:
    "Read the current user's private preview draft for a document. A reader who cannot edit the document gets `editable: false` and no draft.",
  schema: z.object({ documentId: z.string().min(1) }),
  http: { method: "GET" },
  agentTool: false,
  toolCallable: false,
  run: async ({ documentId }) => {
    const userEmail = getRequestUserEmail();
    const orgId = getRequestOrgId() ?? "";
    if (!userEmail) throw new Error("Not authenticated.");
    return previewDocumentDraftAnswer(userEmail, orgId, documentId);
  },
});
