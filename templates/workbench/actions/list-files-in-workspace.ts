import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";
import { getCodeWorkspace } from "../server/lib/code-workspace.js";
import { listDirectory } from "../server/lib/file-ops.js";

/**
 * Read one or more levels of a workspace directory. Used by the Code
 * Room's Explorer panel — pass `depth: 1` for lazy expand-on-click,
 * higher values when prefetching a known sub-tree.
 *
 * Path safety: every fs op is rooted at the workspace's absolute path
 * and funneled through `assertPathInWorkspace` in `file-ops.ts`, so
 * `path` can never escape the workspace via `..`.
 */
export default defineAction({
  description:
    "List the children of a directory inside a Code Room workspace. " +
    "Returns directories before files, with sizes for files. `depth` " +
    "controls eager vs lazy expansion.",
  schema: z.object({
    workspaceId: z.string().min(1),
    path: z.string().default("."),
    depth: z.coerce.number().int().min(1).max(4).default(1),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      throw new Error("Sign in to browse files.");
    }
    const orgId = getRequestOrgId() ?? "";
    const workspace = await getCodeWorkspace(
      args.workspaceId,
      ownerEmail,
      orgId,
    );

    const nodes = await listDirectory(workspace.path, args.path, args.depth);
    return {
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      path: args.path,
      nodes,
    };
  },
});
