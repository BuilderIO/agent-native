import { z } from "zod";

export const analyticsConfig = z.object({
  authSessionReplay: z.boolean().default(false).meta({
    doc: "Opt in to privacy-masked session replay on hosted signup and login pages.",
  }),
  agentNativePublicKey: z
    .string()
    .min(1)
    .optional()
    .meta({
      env: [
        "AGENT_NATIVE_ANALYTICS_PUBLIC_KEY",
        "VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY",
        "AGENT_NATIVE_BUILD_ANALYTICS_PUBLIC_KEY",
      ],
      doc: "Public key for first-party Agent-Native Analytics events.",
    }),
  agentNativeEndpoint: z
    .string()
    .min(1)
    .default("https://analytics.agent-native.com/track")
    .meta({
      env: [
        "AGENT_NATIVE_ANALYTICS_ENDPOINT",
        "VITE_AGENT_NATIVE_ANALYTICS_ENDPOINT",
        "AGENT_NATIVE_BUILD_ANALYTICS_ENDPOINT",
      ],
      doc: "Endpoint for first-party Agent-Native Analytics events.",
    }),
});
