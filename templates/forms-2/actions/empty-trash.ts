import { defineAction } from "@agent-native/core/action";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  formsAccess,
  formsErrors,
  orgScope,
  workspaceScope,
} from "./_access.js";

export default defineAction({
  description:
    "Permanently delete everything in the Trash: deleted forms, submissions, workspaces and folders. This cannot be undone.",
  schema: z.object({}),
  outputSchema: z.object({ purged: z.number() }),
  errors: formsErrors,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async () => {
    const access = formsAccess();
    const { forms, workspaces, submissions, folders } = schema;
    return getDb().transaction(async (tx) => {
      const scoped = await tx
        .select({ id: workspaces.id, deletedAt: workspaces.deletedAt })
        .from(workspaces)
        .where(workspaceScope(access.orgId, access.userEmail));
      const scopeIds = scoped.map((row) => row.id);
      if (scopeIds.length === 0) return { purged: 0 };
      const deletedWorkspaces = scoped
        .filter((row) => row.deletedAt)
        .map((row) => row.id);
      let purged = 0;
      const trashedForms = await tx
        .delete(forms)
        .where(
          and(
            orgScope(forms, access.orgId),
            inArray(forms.workspaceId, scopeIds),
            eq(forms.status, "deleted"),
          ),
        )
        .returning({ id: forms.id });
      purged += trashedForms.length;
      const formIds = (
        await tx
          .select({ id: forms.id })
          .from(forms)
          .where(
            and(
              orgScope(forms, access.orgId),
              inArray(forms.workspaceId, scopeIds),
            ),
          )
      ).map((row) => row.id);
      if (formIds.length) {
        const rows = await tx
          .delete(submissions)
          .where(
            and(
              orgScope(submissions, access.orgId),
              inArray(submissions.formId, formIds),
              isNotNull(submissions.deletedAt),
            ),
          )
          .returning({ id: submissions.id });
        purged += rows.length;
      }
      const deletedFolders = await tx
        .delete(folders)
        .where(
          and(
            orgScope(folders, access.orgId),
            inArray(folders.workspaceId, scopeIds),
            isNotNull(folders.deletedAt),
          ),
        )
        .returning({ id: folders.id });
      purged += deletedFolders.length;
      if (deletedWorkspaces.length) {
        const rows = await tx
          .delete(workspaces)
          .where(inArray(workspaces.id, deletedWorkspaces))
          .returning({ id: workspaces.id });
        purged += rows.length;
      }
      return { purged };
    });
  },
});
