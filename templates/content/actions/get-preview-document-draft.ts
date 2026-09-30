import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { assertAccess, roleSatisfies } from "@agent-native/core/sharing";
import { z } from "zod";

import { readPreviewDocumentDraft } from "./_preview-document-draft.js";

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
    // Page opens read this alongside the document, before they know whether
    // the reader can edit, so a reader without edit access is an answer here
    // rather than a 403.
    const access = await assertAccess(
      "document",
      documentId,
      "viewer",
      undefined,
      {
        skipResourceBody: true,
      },
    );
    if (!roleSatisfies(access.role, "editor")) {
      return { editable: false, draft: null };
    }
    return {
      editable: true,
      draft: await readPreviewDocumentDraft(userEmail, orgId, documentId),
    };
  },
});
