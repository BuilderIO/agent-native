import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { revokeGrant } from "../server/lib/vault-store.js";

export default defineAction({
  description: "Revoke an app's access to a vault secret. Admin only.",
  schema: z.object({
    grantId: z.string().describe("Grant ID to revoke"),
  }),
  // It creates, changes, or revokes a credential or who may use one: every
  // call needs the user's approval, and "always allow" is not offered.
  needsApproval: true,
  allowPersistentApproval: false,
  run: async (args) => revokeGrant(args.grantId),
});
