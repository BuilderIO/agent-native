import { z } from "zod";

import { defineAction } from "../../action.js";
import { getBuilderReferralInfo } from "../../server/fusion-app.js";

export default defineAction({
  description:
    "Get the connected Builder workspace's referral eligibility, invite link, and aggregate referral credit totals. The invite link is only available for eligible paid Builder workspaces; the workspace is resolved from the connected Builder credentials.",
  http: { method: "GET" },
  schema: z.object({}),
  run: async (_input, ctx) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    return getBuilderReferralInfo();
  },
});
