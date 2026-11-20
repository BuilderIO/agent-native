import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { trashItemKinds } from "../shared/form-contract.js";
import {
  failNotFound,
  firstRow,
  formsAccess,
  formsErrors,
  nowIso,
  orgScope,
  requireForm,
  requireWorkspace,
} from "./_access.js";
import {
  RESTORE_DUPLICATE_MESSAGE,
  restoreSubmissionRow,
} from "./_collection.js";
import { restoredStatus } from "./_form-store.js";

export default defineAction({
  description:
    "Restore a form, submission, workspace or folder from the Trash.",
  schema: z.object({
    kind: z
      .enum(trashItemKinds)
      .describe('"form", "submission", "workspace" or "folder"'),
    id: z.string().describe("Id of the trashed item"),
  }),
  outputSchema: z.object({ kind: z.enum(trashItemKinds), id: z.string() }),
  errors: formsErrors,
  run: async ({ kind, id }) => {
    const access = formsAccess();
    const db = getDb();
    const { forms, workspaces, submissions, folders } = schema;
    if (kind === "form") {
      const { form } = await requireForm(access, id, { deleted: "only" });
      await db
        .update(forms)
        .set({
          status: restoredStatus(form),
          deletedAt: null,
          updatedAt: nowIso(),
        })
        .where(and(eq(forms.id, id), orgScope(forms, access.orgId)));
    } else if (kind === "folder") {
      const folder = firstRow(
        await db
          .select()
          .from(folders)
          .where(and(eq(folders.id, id), orgScope(folders, access.orgId)))
          .limit(1),
      );
      if (!folder) return failNotFound("Item not found.");
      await requireWorkspace(access, folder.workspaceId);
      await db
        .update(folders)
        .set({ deletedAt: null, updatedAt: nowIso() })
        .where(eq(folders.id, id));
    } else if (kind === "workspace") {
      await requireWorkspace(access, id, { includeDeleted: true });
      await db
        .update(workspaces)
        .set({ deletedAt: null, updatedAt: nowIso() })
        .where(and(eq(workspaces.id, id), orgScope(workspaces, access.orgId)));
    } else {
      const row = firstRow(
        await db
          .select({ formId: submissions.formId })
          .from(submissions)
          .where(
            and(eq(submissions.id, id), orgScope(submissions, access.orgId)),
          )
          .limit(1),
      );
      if (!row) return failNotFound("Item not found.");
      await requireForm(access, row.formId, { deleted: "include" });
      if (!(await restoreSubmissionRow(db, id, access.orgId)))
        return formsErrors.noWrite(RESTORE_DUPLICATE_MESSAGE, "conflict");
    }
    return { kind, id };
  },
});
