import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { resolveDocumentAccess } from "./_document-access.js";

export default defineAction({
  description:
    "Read one authorized Page body from Trash without restoring or hydrating it. With trashRootOnly, return only the ID of the Page its restore starts from.",
  schema: z.object({
    id: z.string().min(1).describe("Trashed Page ID"),
    trashRootOnly: z
      .boolean()
      .optional()
      .describe("Return only { id, trashRootId }, without the body"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ id, trashRootOnly }) => {
    // Through the space too, like get-document: a space member can open the
    // space's Pages without a share of their own.
    const document = (await resolveDocumentAccess(id))?.resource;
    if (!document?.trashedAt) {
      fail("Trashed Page not found", {
        errorCode: "not_found",
        statusCode: 404,
      });
    }
    if (trashRootOnly) {
      return { id: document.id, trashRootId: document.trashRootId };
    }
    return document;
  },
});
