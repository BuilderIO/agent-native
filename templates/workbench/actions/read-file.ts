import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";
import { getCodeWorkspace } from "../server/lib/code-workspace.js";
import { readFileContent } from "../server/lib/file-ops.js";

/**
 * Read a single file in a workspace and return its content. UTF-8 files
 * come back as a plain string; binary files come back base64-encoded so
 * the editor can decide what to render. Files larger than 2MB are
 * rejected (Monaco struggles past that anyway).
 *
 * Path safety: routes through `assertPathInWorkspace`.
 */
export default defineAction({
  description:
    "Read a file inside a Code Room workspace. Returns UTF-8 text " +
    "directly or base64 for binary files. 2MB limit per file.",
  schema: z.object({
    workspaceId: z.string().min(1),
    path: z.string().min(1),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      throw new Error("Sign in to read files.");
    }
    const orgId = getRequestOrgId() ?? "";
    const workspace = await getCodeWorkspace(
      args.workspaceId,
      ownerEmail,
      orgId,
    );

    const result = await readFileContent(workspace.path, args.path);
    return {
      workspaceId: workspace.id,
      path: args.path,
      ...result,
    };
  },
});
