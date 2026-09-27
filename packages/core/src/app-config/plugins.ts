import { z } from "zod";

export const DEFAULT_PLUGIN_SLOTS = [
  "agent-chat",
  "auth",
  "context-xray",
  "core-routes",
  "integrations",
  "observational-memory",
  "onboarding",
  "org",
  "resources",
  "sentry",
  "terminal",
] as const;

export type DefaultPluginSlot = (typeof DEFAULT_PLUGIN_SLOTS)[number];

export const pluginsConfig = z.object({
  disabled: z
    .array(z.enum(DEFAULT_PLUGIN_SLOTS))
    .default([])
    .meta({
      env: ["AGENT_NATIVE_DISABLED_PLUGINS"],
      doc: "Framework default plugins this deployment refuses to auto-mount, comma-separated. A refused slot mounts none of its routes; an app supplying its own `server/plugins/<slot>.ts` is unaffected.",
    }),
});
