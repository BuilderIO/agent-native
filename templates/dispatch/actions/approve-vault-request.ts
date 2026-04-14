import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { approveRequest } from "../server/lib/vault-store.js";

export default defineAction({
  description:
    "Approve a pending vault secret request. Creates the secret (if it doesn't exist) and grants it to the requesting app. Admin only.",
  schema: z.object({
    id: z.string().describe("Request ID to approve"),
    secretValue: z.string().describe("The secret value to store"),
    secretName: z
      .string()
      .optional()
      .describe("Human-readable name for the secret"),
  }),
  run: async (args) =>
    approveRequest(args.id, args.secretValue, args.secretName),
});
