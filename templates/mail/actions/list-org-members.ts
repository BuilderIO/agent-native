import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  listOrgMembers,
  requireQueueContext,
} from "../server/lib/queued-drafts.js";

export default defineAction({
  description:
    "List members of the current organization who can receive queued email drafts.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const ctx = await requireQueueContext();
    const members = await listOrgMembers(ctx.orgId);
    return { orgId: ctx.orgId, currentUser: ctx.userEmail, members };
  },
});
