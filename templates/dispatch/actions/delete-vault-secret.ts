import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { deleteSecret } from "../server/lib/vault-store.js";

export default defineAction({
  description:
    "Delete a secret from the workspace vault. Also revokes all active grants for this secret. Admin only.",
  schema: z.object({
    id: z.string().describe("Secret ID to delete"),
  }),
  run: async (args) => deleteSecret(args.id),
});
