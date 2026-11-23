import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import { listPendingWorkspaceInvites } from "../server/model/pending-workspace-invites.js";

export default defineAction({
  description:
    "List the pending workspace invitations addressed to the signed-in account, so the invitee can find and accept them.",
  schema: z.object({}).strict(),
  outputSchema: z.object({
    invitations: z.array(
      z.object({
        id: z.string(),
        orgId: z.string(),
        orgName: z.string(),
        invitedBy: z.string(),
      }),
    ),
  }),
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async () => ({
    invitations: await listPendingWorkspaceInvites(getRequestUserEmail()),
  }),
});
