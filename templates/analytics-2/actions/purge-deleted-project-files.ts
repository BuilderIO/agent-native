import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  requireCurrentWorkspace,
  workspaceAccess,
} from "../server/lib/workspace-access.js";
import {
  purgeDeletedProjectDataframes,
  purgeDeletedProjectFiles,
} from "../server/model/project-file-cleanup.js";

export default defineAction({
  description:
    "Remove this account's remaining uploaded files for an already-deleted project in the current workspace. Refuses an existing owned project; shared attachments remain for their other project references. Also finishes removing the project's stored private dataframe results. Returns absent or purged with exact metadata, retained-attachment and removed-dataframe counts. Safe to retry after a storage failure.",
  schema: z
    .object({
      projectId: z
        .string()
        .min(1)
        .max(512)
        .describe(
          "ID of an already permanently deleted project owned by this account in the current workspace",
        ),
    })
    .strict(),
  outputSchema: z.object({
    projectId: z.string(),
    status: z.enum(["absent", "purged"]),
    removedFiles: z.number().int().nonnegative(),
    retainedSharedAttachments: z.number().int().nonnegative(),
    removedDataframes: z.number().int().nonnegative(),
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async ({ projectId }) => {
    const current = await requireCurrentWorkspace();
    const scope = { ownerEmail: current.ownerEmail, orgId: current.orgId };
    await workspaceAccess.assertPermission(["create-project"], scope);
    const files = await purgeDeletedProjectFiles(scope, projectId);
    const dataframes = await purgeDeletedProjectDataframes(scope, projectId);
    return { ...files, removedDataframes: dataframes.removed };
  },
});
