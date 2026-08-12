import { defineAction } from "@agent-native/core";
import {
  assertWorkspaceUserGroupManager,
  listWorkspaceUserGroupsForOrg,
} from "@agent-native/core/workspace-connections";
import { z } from "zod";

export default defineAction({
  description:
    "List reusable workspace user groups for assigning access to shared integrations.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => {
    await assertWorkspaceUserGroupManager(ctx?.orgId, ctx?.userEmail);
    if (!ctx?.orgId) return [];
    return listWorkspaceUserGroupsForOrg(ctx.orgId);
  },
});
