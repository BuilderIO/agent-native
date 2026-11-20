import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { formTitleOf } from "../shared/form-model/index.js";
import { formsAccess, formsErrors, nowIso, requireForm } from "./_access.js";
import { newFormId } from "./_form-store.js";

const COPY_SUFFIX = "copy";

/** "Send us a note" -> "Send us a note copy", and "x copy" -> "x copy 2". */
export function copyName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return COPY_SUFFIX;
  const numbered = trimmed.match(/^(.*?)\s+copy(?:\s+(\d+))?$/i);
  if (!numbered) return `${trimmed} ${COPY_SUFFIX}`;
  const next = numbered[2] ? Number(numbered[2]) + 1 : 2;
  return `${numbered[1]} ${COPY_SUFFIX} ${next}`;
}

export default defineAction({
  description:
    "Duplicate a form: its draft and published blocks and its settings go to a new draft form in the same workspace and folder, named '<name> copy'. Submissions are not copied. Open the copy at /forms/<id>/edit.",
  schema: z.object({ id: z.string().describe("Form id to duplicate") }),
  outputSchema: z.object({ id: z.string(), workspaceId: z.string() }),
  errors: formsErrors,
  run: async ({ id }) => {
    const access = formsAccess();
    const { form } = await requireForm(access, id);
    const db = getDb();
    const { forms } = schema;
    const copyId = newFormId();
    const now = nowIso();
    const name = copyName(form.name || formTitleOf(form.draftBlocks ?? []));
    await db.insert(forms).values({
      id: copyId,
      orgId: access.orgId,
      workspaceId: form.workspaceId,
      folderId: form.folderId ?? null,
      name,
      nameIsCustom: true,
      status: "draft",
      draftBlocks: form.draftBlocks ?? [],
      publishedBlocks: form.publishedBlocks ?? [],
      settings: form.settings ?? {},
      revisionUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { id: copyId, workspaceId: form.workspaceId };
  },
});
