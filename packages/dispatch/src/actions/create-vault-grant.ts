import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { createGrant } from "../server/lib/vault-store.js";

export default defineAction({
  description:
    "Grant an app access to a vault secret in manual vault access mode. Admin only.",
  schema: z.object({
    secretId: z.string().describe("ID of the secret to grant"),
    appId: z
      .string()
      .describe("App ID to grant access to, e.g. mail, calendar"),
  }),
  // It creates, changes, or revokes a credential or who may use one: every
  // call needs the user's approval, and "always allow" is not offered.
  needsApproval: true,
  allowPersistentApproval: false,
  run: async (args) => createGrant(args.secretId, args.appId),
});
