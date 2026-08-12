import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  assertWorkspaceUserGroupManager,
  updateWorkspaceUserGroupMembers,
} from "../index.js";

export default defineAction({
  description:
    "Add or remove multiple workspace members from one reusable user group. Only workspace owners and admins can change group membership.",
  schema: z.object({
    groupId: z.string().min(1).describe("User group ID to update."),
    memberEmails: z
      .array(z.string().email())
      .min(1)
      .max(100)
      .describe("Workspace member email addresses to change."),
    operation: z.enum(["add", "remove"]).describe("Membership operation."),
  }),
  run: async (args, ctx) => {
    await assertWorkspaceUserGroupManager(ctx?.orgId, ctx?.userEmail);
    return updateWorkspaceUserGroupMembers({
      ...args,
      orgId: ctx?.orgId,
    });
  },
});
