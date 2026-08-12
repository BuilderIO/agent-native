import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  assertWorkspaceUserGroupManager,
  listWorkspaceUserGroupsForOrg,
} from "../index.js";

export default defineAction({
  description:
    "List reusable workspace user groups. Group management is restricted to workspace owners and admins.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => {
    await assertWorkspaceUserGroupManager(ctx?.orgId, ctx?.userEmail);
    return listWorkspaceUserGroupsForOrg(ctx?.orgId ?? "");
  },
});
