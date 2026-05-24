import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";
import { getCodeWorkspace } from "../server/lib/code-workspace.js";
import { getGitDiffForFile } from "../server/lib/git-ops.js";

/**
 * Return the before/after content + a unified diff for a single file.
 * The Monaco DiffEditor consumes `oldContent` / `newContent`; the
 * legacy unified renderer consumes `unifiedDiff`. The Code Room ships
 * both shapes so we can swap renderers without an API round-trip.
 *
 * `scope`: `unstaged` (default) compares working tree vs index; `staged`
 * compares index vs HEAD; `all` compares HEAD vs working tree.
 */
export default defineAction({
  description:
    "Get the diff for one file in a Code Room workspace. Returns " +
    "`oldContent` + `newContent` for Monaco DiffEditor and a " +
    "`unifiedDiff` string for the unified renderer.",
  schema: z.object({
    workspaceId: z.string().min(1),
    path: z.string().min(1),
    scope: z.enum(["unstaged", "staged", "all"]).default("unstaged"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      throw new Error("Sign in to view diffs.");
    }
    const orgId = getRequestOrgId() ?? "";
    const workspace = await getCodeWorkspace(
      args.workspaceId,
      ownerEmail,
      orgId,
    );

    const diff = await getGitDiffForFile(workspace.path, args.path, {
      scope: args.scope,
    });
    return {
      workspaceId: workspace.id,
      path: args.path,
      scope: args.scope,
      ...diff,
    };
  },
});
