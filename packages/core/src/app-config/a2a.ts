import { z } from "zod";

/**
 * A2A transport policy.
 *
 * Deliberately does not carry `A2A_SECRET`. That value is a secret, and it is
 * also the key-derivation root the secrets vault uses to decrypt its own rows
 * (`secrets/crypto.ts`) — so it is read below this layer, before configuration
 * is available. Secrets resolve through `readDeployCredentialEnv` and the
 * vault; this domain holds only the policy toggles around them.
 */
export const a2aConfig = z.object({
  allowedOrigins: z
    .array(z.string().min(1))
    .default([])
    .meta({
      env: ["AGENT_NATIVE_A2A_ALLOWED_ORIGINS"],
      doc: "Comma-separated extra origins trusted as private A2A siblings.",
    }),
  allowUnsignedInternal: z
    .boolean()
    .default(false)
    .meta({
      env: ["A2A_ALLOW_UNSIGNED_INTERNAL"],
      doc: "Trust unsigned internal self-dispatch on an unrecognized non-production host. Never grants trust in production.",
    }),
});
