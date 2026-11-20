import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { formStatusSchema } from "../shared/form-contract.js";
import { blockListSchema } from "../shared/form-model/index.js";
import { formsAccess, formsErrors, requireForm } from "./_access.js";
import { saveDraftBlocks } from "./_save-draft.js";

export default defineAction({
  description:
    "Precise edit of an existing block list: read it with get-form, change it, send the complete list back. Every block is { uuid, type, groupUuid, groupType, payload }, and text-bearing blocks (FORM_TITLE, TEXT, TITLE, HEADING_*, every option block) need payload.text. To create or add questions and content, use compose-form instead. A published form keeps serving its published blocks until publish-form. Older saves (smaller clientTime) are dropped.",
  schema: z.object({
    id: z.string().describe("Form id"),
    blocks: blockListSchema.describe("The complete block list"),
    clientTime: z
      .number()
      .optional()
      .describe(
        "Client clock in ms; defaults to now. A save older than the newest accepted one is dropped",
      ),
  }),
  outputSchema: z.object({
    saved: z.boolean(),
    status: formStatusSchema,
    hasDraftBlocks: z.boolean(),
    name: z.string(),
    revisionUpdatedAt: z.string(),
  }),
  errors: formsErrors,
  run: async ({ id, blocks, clientTime }) => {
    const { form } = await requireForm(formsAccess(), id);
    return saveDraftBlocks(form, blocks, clientTime);
  },
});
