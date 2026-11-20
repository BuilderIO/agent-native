import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { blockListSchema } from "../shared/form-model/index.js";
import { formsAccess, formsErrors, nowIso, requireForm } from "./_access.js";

export default defineAction({
  description:
    "Throw away unpublished edits of a published form and return the published blocks.",
  schema: z.object({ id: z.string().describe("Form id") }),
  outputSchema: z.object({
    blocks: blockListSchema,
    revisionUpdatedAt: z.string(),
  }),
  errors: formsErrors,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async ({ id }) => {
    const access = formsAccess();
    const { form } = await requireForm(access, id);
    if (form.status !== "published")
      formsErrors.noWrite(
        "Only a published form has changes to discard.",
        "invalid_input",
      );
    const now = nowIso();
    await getDb()
      .update(schema.forms)
      .set({
        draftBlocks: null,
        draftClientAt: null,
        revisionUpdatedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.forms.id, id));
    return { blocks: form.publishedBlocks, revisionUpdatedAt: now };
  },
});
