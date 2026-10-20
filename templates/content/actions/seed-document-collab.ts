import { defineAction } from "@agent-native/core/action";
import {
  base64ToUint8Array,
  seedXmlFragmentIfEmpty,
  uint8ArrayToBase64,
} from "@agent-native/core/collab";
import { z } from "zod";

import { isSoftDeletedDatabaseDocument } from "./_database-utils.js";
import { resolveDocumentAccess } from "./_document-access.js";

export default defineAction({
  description:
    "Initialize a Content page's live editor from its saved body exactly once.",
  agentTool: false,
  deferLoading: false,
  schema: z.object({
    id: z.string().min(1),
    seedUpdateBase64: z.string().min(1).max(16_000_000),
  }),
  run: async ({ id, seedUpdateBase64 }, ctx) => {
    if (ctx?.caller !== "frontend") {
      throw Object.assign(
        new Error("This operation belongs to the browser editor."),
        {
          statusCode: 403,
        },
      );
    }
    const access = await resolveDocumentAccess(id);
    if (
      !access ||
      access.resource.trashedAt ||
      (await isSoftDeletedDatabaseDocument(id)) ||
      !["owner", "admin", "editor"].includes(access.role)
    ) {
      throw Object.assign(new Error("Document not found or not editable."), {
        statusCode: 403,
      });
    }
    const result = await seedXmlFragmentIfEmpty(
      id,
      base64ToUint8Array(seedUpdateBase64),
    );
    return {
      seeded: result.seeded,
      stateBase64: uint8ArrayToBase64(result.state),
    };
  },
});
