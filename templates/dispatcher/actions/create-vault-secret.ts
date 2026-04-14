import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { createSecret } from "../server/lib/vault-store.js";

export default defineAction({
  description:
    "Store a new secret in the workspace vault. Admin only. The secret can then be granted to specific apps.",
  schema: z.object({
    credentialKey: z
      .string()
      .describe("Environment variable name, e.g. GOOGLE_CLIENT_ID"),
    value: z.string().describe("The secret value"),
    name: z.string().describe("Human-readable label for this secret"),
    provider: z
      .string()
      .optional()
      .describe("Provider grouping tag, e.g. google, sendgrid, slack"),
    description: z.string().optional().describe("Optional description"),
  }),
  run: async (args) => createSecret(args),
});
