import { z } from "zod";

export const authConfig = z.object({
  previousSecretEncryptionKeys: z.array(z.string().min(1)).default([]).meta({
    env: "SECRETS_ENCRYPTION_KEYS_PREVIOUS",
    doc: "Comma-separated previous encryption material accepted for reads during a coordinated re-encryption. New values always use the current key. Remove after migration.",
  }),
  disableDesktopSsoFallbackInDevelopment: z.boolean().default(false).meta({
    env: "AGENT_NATIVE_DISABLE_DESKTOP_SSO_FALLBACK",
    doc: "Disable the loopback Desktop SSO fallback in development so isolated acceptance runs can use their configured local identity. Ignored in production.",
  }),
  mcpOwnerEmail: z.string().trim().email().optional().meta({
    env: "AGENT_NATIVE_OWNER_EMAIL",
    doc: "Owner email used to scope static-token MCP requests when no per-caller identity is available.",
  }),
  requireEmailVerification: z.boolean().optional().meta({
    env: "AUTH_REQUIRE_EMAIL_VERIFICATION",
    doc: "Whether password signup must verify email before a session. Unset: hosted deployments verify with a provider and skip verification without one; local development skips it. Setting false accepts unverified email in production. Email remains optional.",
  }),
});
