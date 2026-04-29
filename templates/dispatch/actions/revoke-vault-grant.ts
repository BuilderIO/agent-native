import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { requireVaultCtx, revokeGrant } from "../server/lib/vault-store.js";

export default defineAction({
  description: "Revoke an app's access to a vault secret. Admin only.",
  schema: z.object({
    grantId: z.string().describe("Grant ID to revoke"),
  }),
  run: async (args) => revokeGrant(args.grantId, requireVaultCtx()),
});
