import { z } from "zod";

/**
 * The framework's default plugin slots, mirroring `DEFAULT_PLUGIN_REGISTRY`.
 *
 * Spelled out here rather than imported: that registry lives in the deploy
 * layer, which reaches for `node:fs`, and this schema is parsed on edge
 * runtimes too. `plugins.spec.ts` fails when the two lists drift.
 */
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

/**
 * Which framework default plugins this deployment refuses.
 *
 * A refused slot mounts nothing, so every route it owns 404s and the UI and
 * agent surfaces that call them stop working — `agent-chat`, `auth`, and
 * `core-routes` carry most of an app with them. Only the framework's own
 * default is withheld: an app that ships `server/plugins/<slot>.ts` mounted
 * that plugin deliberately and keeps it.
 */
export const pluginsConfig = z.object({
  disabled: z
    .array(z.enum(DEFAULT_PLUGIN_SLOTS))
    .default([])
    .meta({
      env: ["AGENT_NATIVE_DISABLED_PLUGINS"],
      doc: "Framework default plugins this deployment refuses to auto-mount, comma-separated. A refused slot mounts none of its routes; an app supplying its own `server/plugins/<slot>.ts` is unaffected.",
    }),
});
