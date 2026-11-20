import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { blockListSchema } from "../shared/form-model/index.js";
import {
  failNotFound,
  firstRow,
  formsAccess,
  formsErrors,
  nowIso,
  orgScope,
  requireForm,
} from "./_access.js";
import { saveDraftBlocks } from "./_save-draft.js";
import { restoredSettings } from "./_versions.js";

export default defineAction({
  description:
    "Restore a saved version of a form as its new draft: the blocks become the unpublished edits and the version's settings (progress bar, auto-jump, language, closed message, redirect, answer saving, partial submissions, duplicate prevention, theme, custom CSS) replace the current ones exactly. Other settings such as password and notifications are untouched. The published blocks stay live until publish-form.",
  schema: z.object({
    formId: z.string().describe("Form id"),
    versionId: z.string().describe("Version id from list-form-versions"),
  }),
  outputSchema: z.object({ saved: z.boolean(), blocks: blockListSchema }),
  errors: formsErrors,
  run: async ({ formId, versionId }) => {
    const { form } = await requireForm(formsAccess(), formId);
    const { formVersions, forms } = schema;
    const db = getDb();
    const version = firstRow(
      await db
        .select()
        .from(formVersions)
        .where(
          and(eq(formVersions.id, versionId), eq(formVersions.formId, formId)),
        )
        .limit(1),
    );
    if (!version) return failNotFound("Version not found.");
    const settings = restoredSettings(form.settings, version.settings);
    await db
      .update(forms)
      .set({ settings, updatedAt: nowIso() })
      .where(and(eq(forms.id, formId), orgScope(forms, form.orgId)));
    const { saved } = await saveDraftBlocks(
      { ...form, settings },
      version.blocks,
    );
    return { saved, blocks: version.blocks };
  },
});
