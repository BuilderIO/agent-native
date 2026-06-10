import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  listWorkspaceFiles,
  type WorkspaceFilesScope,
} from "@agent-native/core/workspace-files";
import { resolveRequestScope } from "../server/lib/scoped-settings";

export default defineAction({
  description: "List workspace files in the analysis workspace.",
  schema: z.object({
    prefix: z
      .string()
      .optional()
      .describe(
        "Optional path prefix to filter files, e.g. 'analysis/' to list only files under that directory.",
      ),
  }),
  run: async (args) => {
    const { email, orgId } = resolveRequestScope();
    const scope: WorkspaceFilesScope = orgId
      ? { scope: "org", scopeId: orgId }
      : { scope: "user", scopeId: email };

    const files = await listWorkspaceFiles(scope, args.prefix);
    return files.map((f) => ({
      path: f.path,
      sizeBytes: f.sizeBytes,
      contentType: f.contentType,
      updatedAt: f.updatedAt,
      createdAt: f.createdAt,
    }));
  },
});
