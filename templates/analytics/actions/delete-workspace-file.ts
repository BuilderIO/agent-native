import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  deleteWorkspaceFile,
  type WorkspaceFilesScope,
} from "@agent-native/core/workspace-files";
import { resolveSettingsScope } from "../server/lib/scoped-settings";

export default defineAction({
  description: "Delete a workspace file by path.",
  schema: z.object({
    path: z.string().min(1).describe("File path to delete."),
  }),
  run: async (args, event) => {
    const { email, orgId } = await resolveSettingsScope(event);
    const scope: WorkspaceFilesScope = orgId
      ? { scope: "org", scopeId: orgId }
      : { scope: "user", scopeId: email };

    const deleted = await deleteWorkspaceFile(scope, args.path);
    return { deleted, path: args.path };
  },
});
