import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  readWorkspaceFile,
  type WorkspaceFilesScope,
} from "@agent-native/core/workspace-files";
import { resolveSettingsScope } from "../server/lib/scoped-settings";

export default defineAction({
  description: "Read the content of a workspace file by path.",
  schema: z.object({
    path: z.string().min(1).describe("File path to read."),
    offset: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Character offset to start reading from. Default: 0."),
    maxChars: z.coerce
      .number()
      .int()
      .min(1)
      .max(500_000)
      .optional()
      .describe("Maximum characters to return. Default: 100000. Max: 500000."),
  }),
  run: async (args, event) => {
    const { email, orgId } = await resolveSettingsScope(event);
    const scope: WorkspaceFilesScope = orgId
      ? { scope: "org", scopeId: orgId }
      : { scope: "user", scopeId: email };

    const file = await readWorkspaceFile(scope, args.path, {
      offset: args.offset,
      maxChars: args.maxChars ?? 100_000,
    });

    if (!file) {
      return null;
    }

    return {
      path: file.path,
      content: file.content,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    };
  },
});
