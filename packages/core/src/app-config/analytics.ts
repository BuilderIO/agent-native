import { z } from "zod";

const privateProviderOrigin = z.url().refine((value) => {
  const url = new URL(value);
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    !url.username &&
    !url.password &&
    value === url.origin
  );
}, "Expected an exact HTTP origin without a path or userinfo");

export const analyticsConfig = z.object({
  trustedPrivateProviderOrigins: z
    .object({
      grafana: z.array(privateProviderOrigin).default([]).meta({
        doc: "Exact Grafana origins explicitly trusted to resolve to private addresses.",
      }),
      prometheus: z.array(privateProviderOrigin).default([]).meta({
        doc: "Exact Prometheus origins explicitly trusted to resolve to private addresses.",
      }),
    })
    .prefault({}),
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
  headScriptSrc: z
    .url({ protocol: /^https$/ })
    .optional()
    .meta({
      env: "AGENT_NATIVE_HEAD_SCRIPT_SRC",
      doc: "HTTPS URL of a script added to every server-rendered page, for deployment-specific tooling such as support or feedback widgets. Where the consent banner shows, it waits for analytics consent, like Google Analytics.",
    }),
});
