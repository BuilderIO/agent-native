import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";
import { getCodeWorkspace } from "../server/lib/code-workspace.js";
import { writeFileContent } from "../server/lib/file-ops.js";

/**
 * Write a file inside a Code Room workspace. Creates missing
 * intermediate directories. Always writes UTF-8 — binary writes are not
 * supported (the Code Room only edits text).
 *
 * Path safety: routes through `assertPathInWorkspace`.
 */
export default defineAction({
  description:
    "Write a file inside a Code Room workspace. Creates parent " +
    "directories as needed. UTF-8 text only.",
  schema: z.object({
    workspaceId: z.string().min(1),
    path: z.string().min(1),
    content: z.string(),
  }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      throw new Error("Sign in to write files.");
    }
    const orgId = getRequestOrgId() ?? "";
    const workspace = await getCodeWorkspace(
      args.workspaceId,
      ownerEmail,
      orgId,
    );

    await writeFileContent(workspace.path, args.path, args.content);
    return {
      ok: true,
      workspaceId: workspace.id,
      path: args.path,
      bytesWritten: Buffer.byteLength(args.content, "utf-8"),
    };
  },
});
