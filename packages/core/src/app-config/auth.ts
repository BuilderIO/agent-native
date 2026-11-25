import { z } from "zod";

export const authConfig = z.object({
  previousSecretEncryptionKeys: z.array(z.string().min(1)).default([]).meta({
    env: "SECRETS_ENCRYPTION_KEYS_PREVIOUS",
    doc: "Comma-separated previous encryption material accepted for reads during a coordinated re-encryption. New values always use the current key. Remove after migration.",
  }),
  identitySsoAppRegistryJson: z.string().optional().meta({
    env: "IDENTITY_SSO_APP_REGISTRY_JSON",
    doc: "First-party workspace application registrations used for document and agent chat trust. Parsed and validated by the workspace SSO registry resolver.",
  }),
  identitySsoExistingAccountsOnly: z.boolean().default(false).meta({
    env: "AGENT_NATIVE_IDENTITY_SSO_EXISTING_ACCOUNTS_ONLY",
    doc: "Restrict identity SSO to verified existing accounts with existing organization membership; do not provision users or organizations.",
  }),
  allowBuilderPreviewLocalDev: z.boolean().default(false).meta({
    env: "AGENT_NATIVE_ALLOW_BUILDER_PREVIEW_LOCAL_DEV",
    doc: "Enable local development conveniences (local-dev sign-in, the automatic dev account, and dev agent tools) when running in a Builder cloud dev container. Ignored in production.",
  }),
  disableDesktopSsoFallbackInDevelopment: z.boolean().default(false).meta({
    env: "AGENT_NATIVE_DISABLE_DESKTOP_SSO_FALLBACK",
    doc: "Disable the loopback Desktop SSO fallback in development so isolated acceptance runs can use their configured local identity. Ignored in production.",
  }),
  mcpOwnerEmail: z.string().trim().email().optional().meta({
    env: "AGENT_NATIVE_OWNER_EMAIL",
    doc: "Owner email used to scope static-token MCP requests when no per-caller identity is available.",
  }),
  runnerSessionSecret: z.string().min(32).optional().meta({
    env: "RUNNER_SESSION_SECRET",
    doc: "Shared secret that signs requests to the automated test-runner sign-in route. The route stays off unless this and an email allowlist are both set. At least 32 characters.",
  }),
  runnerSessionAllowedEmails: z
    .array(z.string().trim().toLowerCase().email())
    .default([])
    .meta({
      env: "RUNNER_SESSION_ALLOWED_EMAILS",
      doc: "Comma-separated existing accounts the automated test-runner sign-in route may sign in. Empty keeps the route off.",
    }),
  requireEmailVerification: z.boolean().optional().meta({
    env: "AUTH_REQUIRE_EMAIL_VERIFICATION",
    doc: "Whether password signup must verify email before a session. Unset: hosted deployments verify with a provider and skip verification without one; local development skips it. Setting false accepts unverified email in production. Email remains optional.",
  }),
});
