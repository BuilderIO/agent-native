import { z } from "zod";

export const authConfig = z.object({
  disableDesktopSsoFallbackInDevelopment: z.boolean().default(false).meta({
    env: "AGENT_NATIVE_DISABLE_DESKTOP_SSO_FALLBACK",
    doc: "Disable the loopback Desktop SSO fallback in development so isolated acceptance runs can use their configured local identity. Ignored in production.",
  }),
  // Deliberately optional rather than defaulted: unset means "derive from the
  // deployment", which is not a boolean. A default here would erase the
  // difference between an operator who chose a policy and one who never spoke.
  requireEmailVerification: z.boolean().optional().meta({
    env: "AUTH_REQUIRE_EMAIL_VERIFICATION",
    doc: "Whether password signup must verify the email address before it gets a session. Unset derives it: hosted deployments require it, local development skips it. Setting it false accepts an unverified email as a login credential, including in production.",
  }),
});
