import { defineAction } from "@agent-native/core/action";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { trashItemSchema } from "../shared/form-contract.js";
import {
  formsAccess,
  formsErrors,
  orgScope,
  workspaceScope,
} from "./_access.js";

const PER_KIND = 200;

export default defineAction({
  description:
    "List what is in the Trash: deleted forms, submissions, workspaces and folders, newest first.",
  schema: z.object({}),
  outputSchema: z.object({ items: z.array(trashItemSchema) }),
  errors: formsErrors,
  http: { method: "GET" },
  run: async () => {
    const access = formsAccess();
    const db = getDb();
    const { forms, workspaces, submissions, folders } = schema;
    const formRows = await db
      .select({ form: forms, workspaceName: workspaces.name })
      .from(forms)
      .innerJoin(workspaces, eq(workspaces.id, forms.workspaceId))
      .where(
        and(
          workspaceScope(access.orgId, access.userEmail),
          orgScope(forms, access.orgId),
          eq(forms.status, "deleted"),
        ),
      )
      .orderBy(desc(forms.deletedAt))
      .limit(PER_KIND);
    const workspaceRows = await db
      .select()
      .from(workspaces)
      .where(
        and(
          workspaceScope(access.orgId, access.userEmail),
          isNotNull(workspaces.deletedAt),
        ),
      )
      .orderBy(desc(workspaces.deletedAt))
      .limit(PER_KIND);
    const folderRows = await db
      .select({ folder: folders, workspaceName: workspaces.name })
      .from(folders)
      .innerJoin(workspaces, eq(workspaces.id, folders.workspaceId))
      .where(
        and(
          workspaceScope(access.orgId, access.userEmail),
          orgScope(folders, access.orgId),
          isNotNull(folders.deletedAt),
        ),
      )
      .orderBy(desc(folders.deletedAt))
      .limit(PER_KIND);
    const submissionRows = await db
      .select({ submission: submissions, formName: forms.name })
      .from(submissions)
      .innerJoin(forms, eq(forms.id, submissions.formId))
      .innerJoin(workspaces, eq(workspaces.id, forms.workspaceId))
      .where(
        and(
          workspaceScope(access.orgId, access.userEmail),
          orgScope(forms, access.orgId),
          orgScope(submissions, access.orgId),
          isNotNull(submissions.deletedAt),
        ),
      )
      .orderBy(desc(submissions.deletedAt))
      .limit(PER_KIND);
    const items = [
      ...formRows.map((row) => ({
        kind: "form" as const,
        id: row.form.id,
        name: row.form.name,
        parentName: row.workspaceName,
        deletedAt: row.form.deletedAt ?? row.form.updatedAt,
      })),
      ...workspaceRows.map((row) => ({
        kind: "workspace" as const,
        id: row.id,
        name: row.name,
        parentName: null,
        deletedAt: row.deletedAt ?? row.updatedAt,
      })),
      ...folderRows.map((row) => ({
        kind: "folder" as const,
        id: row.folder.id,
        name: row.folder.name,
        parentName: row.workspaceName,
        deletedAt: row.folder.deletedAt ?? row.folder.updatedAt,
      })),
      ...submissionRows.map((row) => ({
        kind: "submission" as const,
        id: row.submission.id,
        name: row.submission.submittedAt,
        parentName: row.formName,
        deletedAt: row.submission.deletedAt ?? row.submission.submittedAt,
      })),
    ];
    items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    return { items };
  },
});
