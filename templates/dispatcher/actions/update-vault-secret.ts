import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { updateSecret } from "../server/lib/vault-store.js";

export default defineAction({
  description: "Update the value of an existing vault secret. Admin only.",
  schema: z.object({
    id: z.string().describe("Secret ID"),
    value: z.string().describe("New secret value"),
  }),
  run: async (args) => updateSecret(args.id, args.value),
});
