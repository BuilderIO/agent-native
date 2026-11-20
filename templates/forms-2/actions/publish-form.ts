import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  blockListSchema,
  formTitleOf,
  isFormEmpty,
} from "../shared/form-model/index.js";
import { formsAccess, formsErrors, nowIso, requireForm } from "./_access.js";
import { materializeQuestions } from "./_form-store.js";
import { recordVersion } from "./_versions.js";

export default defineAction({
  description:
    "Publish a form: pass the editor's current blocks, or omit them to publish the saved draft. Respondents see the new blocks at /f/<id>. Safe to repeat.",
  schema: z.object({
    id: z.string().describe("Form id"),
    blocks: blockListSchema
      .optional()
      .describe(
        "Blocks to publish; defaults to the saved draft, then the published blocks",
      ),
  }),
  outputSchema: z.object({
    status: z.literal("published"),
    publishedAt: z.string(),
    revisionUpdatedAt: z.string(),
    firstPublish: z.boolean(),
  }),
  errors: formsErrors,
  run: async ({ id, blocks }) => {
    const access = formsAccess();
    const { form } = await requireForm(access, id);
    const next = blocks ?? form.draftBlocks ?? form.publishedBlocks;
    if (isFormEmpty(next))
      formsErrors.noWrite(
        "Add something to the form before publishing.",
        "invalid_input",
      );
    const now = nowIso();
    const publishedAt = form.publishedAt ?? now;
    await getDb().transaction(async (tx) => {
      await tx
        .update(schema.forms)
        .set({
          publishedBlocks: next,
          draftBlocks: null,
          status: "published",
          publishedAt,
          name: form.nameIsCustom ? form.name : formTitleOf(next),
          revisionUpdatedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.forms.id, id));
      await materializeQuestions(tx, form.orgId, id, next);
      await recordVersion(
        tx,
        form,
        { blocks: next, settings: form.settings },
        "publish",
        access.userEmail,
      );
    });
    return {
      status: "published" as const,
      publishedAt,
      revisionUpdatedAt: now,
      firstPublish: form.publishedAt == null,
    };
  },
});
