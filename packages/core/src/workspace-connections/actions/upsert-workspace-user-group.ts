import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  assertWorkspaceUserGroupManager,
  upsertWorkspaceUserGroup,
} from "../index.js";

export default defineAction({
  description:
    "Create or update a reusable workspace user group and its member list. Only workspace owners and admins can change groups.",
  schema: z.object({
    id: z.string().optional().describe("Existing user group ID to update."),
    name: z.string().describe("Group name, such as Rev Ops."),
    memberEmails: z
      .array(z.string().email())
      .default([])
      .describe("Workspace member email addresses in this group."),
  }),
  run: async (args, ctx) => {
    await assertWorkspaceUserGroupManager(ctx?.orgId, ctx?.userEmail);
    return upsertWorkspaceUserGroup({
      ...args,
      orgId: ctx?.orgId,
      createdByEmail: ctx?.userEmail,
    });
  },
});
