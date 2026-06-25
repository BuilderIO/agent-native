import { defineAction } from "@agent-native/core";
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
  run: async (args) => createGrant(args.secretId, args.appId),
});
