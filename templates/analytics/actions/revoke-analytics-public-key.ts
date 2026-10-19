import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { revokeAnalyticsPublicKey } from "../server/lib/first-party-analytics.js";

function resolveScope() {
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  return { userEmail, orgId: getRequestOrgId() || null };
}

export default defineAction({
  description:
    "Revoke a first-party analytics public write key. Future /track calls with that key will be rejected.",
  schema: z.object({
    id: z.string().describe("Public key row id to revoke."),
  }),
  // It creates, changes, or revokes a credential or who may use one: every
  // call needs the user's approval, and "always allow" is not offered.
  needsApproval: true,
  allowPersistentApproval: false,
  run: async (args) => {
    return revokeAnalyticsPublicKey(resolveScope(), args.id);
  },
});
