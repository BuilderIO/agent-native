import { z } from "zod";

import { defineAction } from "../../action.js";
import { getDbExec } from "../../db/client.js";
import { requireOrgMember } from "../actions.js";
import { invalidateWorkspaceAppAccessCache } from "../workspace-app-access-cache.js";

const modeSchema = z.enum(["all", "restricted", "disabled"]);

export default defineAction({
  description:
    "Set whether a workspace application is available to all organization members, restricted to existing shares, or disabled for the organization.",
  schema: z.object({
    appId: z.string().trim().min(1).max(200),
    mode: modeSchema,
  }),
  audit: {
    target: (args, _result, meta) => ({
      type: "workspace-app-access",
      id: args.appId,
      ownerEmail: meta.userEmail,
      visibility: "org",
    }),
    summary: (args) => `Set ${args.appId} workspace access to ${args.mode}`,
  },
  run: async ({ appId, mode }, ctx) => {
    const caller = await requireOrgMember(ctx, true);
    const db = getDbExec();
    const existing = await db.execute({
      sql: `SELECT id FROM workspace_apps WHERE id = ? AND org_id = ? LIMIT 1`,
      args: [appId, caller.orgId],
    });
    if (!existing.rows[0]) throw new Error("Workspace app not found.");
    await db.execute({
      sql: `UPDATE workspace_apps
            SET visibility = ?, org_enabled = ?, updated_at = ?
            WHERE id = ? AND org_id = ?`,
      args: [
        mode === "all" ? "org" : "private",
        mode === "disabled" ? false : true,
        Date.now(),
        appId,
        caller.orgId,
      ],
    });
    await invalidateWorkspaceAppAccessCache();
    return { appId, mode };
  },
});
