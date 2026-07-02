import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { updateSecret } from "../server/lib/vault-store.js";

export default defineAction({
  description:
    "Update an existing vault secret's label, credential key, value, provider, or description. Admin only.",
  schema: z
    .object({
      id: z.string().min(1).describe("Secret ID"),
      credentialKey: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Environment variable name, e.g. GOOGLE_CLIENT_ID"),
      value: z.string().min(1).optional().describe("New secret value"),
      name: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Human-readable label for this secret"),
      provider: z
        .string()
        .nullable()
        .optional()
        .describe("Provider grouping tag, e.g. google, sendgrid, slack"),
      description: z
        .string()
        .nullable()
        .optional()
        .describe("Optional description"),
    })
    .refine(
      ({ credentialKey, value, name, provider, description }) =>
        credentialKey !== undefined ||
        value !== undefined ||
        name !== undefined ||
        provider !== undefined ||
        description !== undefined,
      "At least one secret field must be updated",
    ),
  // Carries a secret `value`. Record THAT the secret changed, never the value —
  // keep the audit trail from becoming a second credential store.
  audit: { recordInputs: false },
  run: async (args) => updateSecret(args.id, args),
});
