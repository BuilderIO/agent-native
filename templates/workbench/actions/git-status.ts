import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";
import { getCodeWorkspace } from "../server/lib/code-workspace.js";
import { getGitStatus } from "../server/lib/git-ops.js";

/**
 * Return the workspace's git status — current branch, ahead/behind
 * counts, staged / unstaged / untracked file lists.
 *
 * When the workspace is not a git repository, returns
 * `{ isRepo: false }` instead of throwing — the Changes panel renders
 * an "init repo" empty state from that.
 */
export default defineAction({
  description:
    "Get the git status of a Code Room workspace — branch, ahead/behind, " +
    "and staged / unstaged / untracked file lists.",
  schema: z.object({
    workspaceId: z.string().min(1),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      throw new Error("Sign in to read git status.");
    }
    const orgId = getRequestOrgId() ?? "";
    const workspace = await getCodeWorkspace(
      args.workspaceId,
      ownerEmail,
      orgId,
    );

    const status = await getGitStatus(workspace.path);
    return {
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      ...status,
    };
  },
});
