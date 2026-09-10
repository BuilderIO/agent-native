import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  listWorkspaceUserGroupsForOrg,
  workspaceUserGroupRole,
} from "../groups.js";

export default defineAction({
  description:
    "List reusable workspace user groups. Workspace members can see group names for sharing; only owners and admins receive member details and can manage groups.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => {
    const role = await workspaceUserGroupRole(ctx?.orgId, ctx?.userEmail);
    if (!role) throw new Error("Workspace membership is required.");
    const groups = await listWorkspaceUserGroupsForOrg(ctx?.orgId ?? "");
    if (role === "owner" || role === "admin") return groups;
    return groups.map((group) => ({ ...group, memberEmails: [] }));
  },
});
