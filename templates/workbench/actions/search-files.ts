import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";
import { getCodeWorkspace } from "../server/lib/code-workspace.js";
import { searchInFiles } from "../server/lib/file-ops.js";

/**
 * Substring search across the workspace, skipping `node_modules` /
 * `.git` / build dirs and files >1MB. Bounded at `max` hits (default
 * 100) so the response stays small enough for an interactive panel.
 *
 * Path safety: every walk step goes through `assertPathInWorkspace`.
 */
export default defineAction({
  description:
    "Substring-search across files in a Code Room workspace. Skips " +
    "noise dirs (node_modules, .git, dist, etc.) and large/binary files.",
  schema: z.object({
    workspaceId: z.string().min(1),
    query: z.string().min(1),
    caseSensitive: z.boolean().optional(),
    max: z.coerce.number().int().min(1).max(500).optional(),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      throw new Error("Sign in to search files.");
    }
    const orgId = getRequestOrgId() ?? "";
    const workspace = await getCodeWorkspace(
      args.workspaceId,
      ownerEmail,
      orgId,
    );

    const hits = await searchInFiles(workspace.path, args.query, {
      caseSensitive: args.caseSensitive,
      max: args.max,
    });
    return {
      workspaceId: workspace.id,
      query: args.query,
      hits,
      truncated: hits.length === (args.max ?? 100),
    };
  },
});
