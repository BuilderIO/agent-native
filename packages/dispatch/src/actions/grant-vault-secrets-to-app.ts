import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { grantSecretsToApp } from "../server/lib/vault-store.js";

export default defineAction({
  description:
    "Grant multiple Dispatch vault secrets to a workspace app in manual vault access mode. Admin only. Existing active grants are skipped.",
  http: { method: "POST" },
  schema: z.object({
    appId: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,63}$/)
      .describe("Workspace app id/path, e.g. customer-health"),
    secretIds: z
      .array(z.string())
      .max(100)
      .describe("Vault secret IDs to grant to the app"),
  }),
  // It creates, changes, or revokes a credential or who may use one: every
  // call needs the user's approval, and "always allow" is not offered.
  needsApproval: true,
  allowPersistentApproval: false,
  run: async (args) => grantSecretsToApp(args.secretIds, args.appId),
});
