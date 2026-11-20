import { eq } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { formStatusSchema, type FormStatus } from "../shared/form-contract.js";
import {
  formTitleOf,
  isFormEmpty,
  type Block,
} from "../shared/form-model/index.js";
import { formsAccess, nowIso } from "./_access.js";
import { recordVersion } from "./_versions.js";

/** Blocks must already be validated. Shared by save-form-draft and compose-form. */
export async function saveDraftBlocks(
  form: typeof schema.forms.$inferSelect,
  blocks: Block[],
  clientTime?: number,
) {
  const at = clientTime ?? Date.now();
  const status = formStatusSchema.parse(form.status);
  if (form.draftClientAt != null && at < form.draftClientAt)
    return {
      saved: false,
      status,
      hasDraftBlocks: form.draftBlocks != null,
      name: form.name,
      revisionUpdatedAt: form.revisionUpdatedAt,
    };
  const now = nowIso();
  const nextStatus: FormStatus =
    status === "published" ? status : isFormEmpty(blocks) ? "blank" : "draft";
  const name = form.nameIsCustom ? form.name : formTitleOf(blocks);
  await getDb()
    .update(schema.forms)
    .set({
      draftBlocks: blocks,
      status: nextStatus,
      name,
      draftClientAt: at,
      revisionUpdatedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.forms.id, form.id));
  if (!isFormEmpty(blocks))
    await recordVersion(
      getDb(),
      form,
      { blocks, settings: form.settings },
      "autosave",
      formsAccess().userEmail,
    );
  return {
    saved: true,
    status: nextStatus,
    hasDraftBlocks: true,
    name,
    revisionUpdatedAt: now,
  };
}
