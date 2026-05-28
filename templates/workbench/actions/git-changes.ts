import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";
import { getCodeWorkspace } from "../server/lib/code-workspace.js";
import { getGitStatus, type ChangedFile } from "../server/lib/git-ops.js";

/**
 * A focused view on changed files — grouped by stage. The Changes panel
 * uses this to render Staged / Unstaged / Untracked sections without
 * needing the full GitStatus payload.
 */
export default defineAction({
  description:
    "List changed files in a Code Room workspace, grouped by stage " +
    "(staged / unstaged / untracked). Pass `scope` to filter to one group.",
  schema: z.object({
    workspaceId: z.string().min(1),
    scope: z.enum(["unstaged", "staged", "all"]).default("all"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      throw new Error("Sign in to list changes.");
    }
    const orgId = getRequestOrgId() ?? "";
    const workspace = await getCodeWorkspace(
      args.workspaceId,
      ownerEmail,
      orgId,
    );

    const status = await getGitStatus(workspace.path);
    if (!status.isRepo) {
      return {
        workspaceId: workspace.id,
        isRepo: false as const,
        staged: [] as ChangedFile[],
        unstaged: [] as ChangedFile[],
        untracked: [] as string[],
      };
    }

    const include = (group: "staged" | "unstaged") =>
      args.scope === "all" || args.scope === group;

    return {
      workspaceId: workspace.id,
      isRepo: true as const,
      branch: status.branch,
      ahead: status.ahead,
      behind: status.behind,
      staged: include("staged") ? status.staged : [],
      unstaged: include("unstaged") ? status.unstaged : [],
      untracked: args.scope === "staged" ? [] : status.untracked,
    };
  },
});
