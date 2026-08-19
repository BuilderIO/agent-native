import { z } from "zod";

export const authConfig = z.object({
  disableDesktopSsoFallbackInDevelopment: z.boolean().default(false).meta({
    env: "AGENT_NATIVE_DISABLE_DESKTOP_SSO_FALLBACK",
    doc: "Disable the loopback Desktop SSO fallback in development so isolated acceptance runs can use their configured local identity. Ignored in production.",
  }),
});
