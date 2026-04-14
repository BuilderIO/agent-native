import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { createSecret, listSecrets } from "../server/lib/vault-store.js";

export default defineAction({
  description:
    "Store a new secret in the workspace vault. Admin only. The secret can then be granted to specific apps.",
  schema: z.object({
    credentialKey: z
      .string()
      .trim()
      .min(1, "credentialKey is required")
      .regex(
        /^[A-Z][A-Z0-9_]*$/,
        "credentialKey must be an uppercase env-var name (A-Z, 0-9, _)",
      )
      .describe("Environment variable name, e.g. GOOGLE_CLIENT_ID"),
    value: z
      .string()
      .min(1, "value is required — empty secrets are not allowed")
      .describe("The secret value"),
    name: z
      .string()
      .trim()
      .min(1, "name is required")
      .describe("Human-readable label for this secret"),
    provider: z
      .string()
      .optional()
      .describe("Provider grouping tag, e.g. google, sendgrid, slack"),
    description: z.string().optional().describe("Optional description"),
  }),
  run: async (args) => {
    // Reject duplicate credentialKey — keeping the vault unambiguous.
    const existing = await listSecrets();
    const dup = existing.find(
      (s: { credentialKey: string }) => s.credentialKey === args.credentialKey,
    );
    if (dup) {
      throw new Error(
        `A vault secret with credentialKey "${args.credentialKey}" already exists. Update it or choose a different key.`,
      );
    }
    return createSecret(args);
  },
});
