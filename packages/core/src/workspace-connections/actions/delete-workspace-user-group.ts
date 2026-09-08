import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  assertWorkspaceUserGroupManager,
  deleteWorkspaceUserGroup,
  listWorkspaceUserGroupsForOrg,
} from "../groups.js";
import { listWorkspaceConnections } from "../store.js";

export default defineAction({
  description:
    "Delete a reusable workspace user group after it is removed from shared connections. Only workspace owners and admins can delete groups.",
  schema: z.object({
    id: z.string().min(1).describe("User group ID to delete."),
  }),
  run: async ({ id }, ctx) => {
    await assertWorkspaceUserGroupManager(ctx?.orgId, ctx?.userEmail);
    const orgId = ctx?.orgId ?? "";
    const group = (await listWorkspaceUserGroupsForOrg(orgId, [id]))[0];
    if (!group) throw new Error(`User group "${id}" was not found.`);

    const connections = await listWorkspaceConnections({
      includeDisabled: true,
    });
    const references = connections.filter(
      (connection) =>
        connection.orgId === orgId &&
        (connection.allowedUserGroups ?? []).includes(group.id),
    );
    if (references.length > 0) {
      throw new Error(
        `Remove "${group.name}" from ${references.length === 1 ? "its connection" : `${references.length} connections`} before deleting the group.`,
      );
    }

    const deleted = await deleteWorkspaceUserGroup(id, orgId);
    if (!deleted) throw new Error(`User group "${id}" was not found.`);
    return { id, deleted };
  },
});
