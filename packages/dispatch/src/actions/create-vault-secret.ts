import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { createSecret } from "../server/lib/vault-store.js";

export default defineAction({
  description:
    "Store a secret in the workspace vault. Admin only. Existing credential keys are updated. By default, saved vault keys are available to every workspace app; manual mode uses per-app grants.",
  schema: z.object({
    credentialKey: z
      .string()
      .min(1)
      .describe("Environment variable name, e.g. GOOGLE_CLIENT_ID"),
    value: z.string().min(1).describe("The secret value"),
    name: z.string().min(1).describe("Human-readable label for this secret"),
    provider: z
      .string()
      .optional()
      .describe("Provider grouping tag, e.g. google, sendgrid, slack"),
    description: z.string().optional().describe("Optional description"),
  }),
  run: async (args) => createSecret(args),
});
