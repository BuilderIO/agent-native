import { TEMPLATES } from "../cli/templates-meta.js";

export function normalizeAgentId(id: string): string {
  const normalized = id.trim().toLowerCase();
  if (
    normalized === "image" ||
    normalized === "images" ||
    normalized === "asset"
  ) {
    return "assets";
  }
  if (normalized === "videos") return "clips";
  return normalized;
}

/** Every first-party template with a production deployment. */
export const BUILTIN_AGENT_CATALOG_IDS: readonly string[] = TEMPLATES.filter(
  (template) => !!template.prodUrl,
).map((template) => template.name);

/**
 * The built-ins a workspace offers when its `agent-native.builtinAgents`
 * config is absent or `mode: "all"`.
 */
export const DEFAULT_BUILTIN_AGENT_IDS: readonly string[] = TEMPLATES.filter(
  (template) =>
    (!template.hidden || template.defaultAgent) && !!template.prodUrl,
).map((template) => template.name);

/**
 * First-party agent ids discovery never lists, shared by agent discovery and
 * the Settings Sub-agents page so both agree on what the agent can call.
 */
export const HIDDEN_FIRST_PARTY_AGENT_IDS: ReadonlySet<string> = new Set([
  ...BUILTIN_AGENT_CATALOG_IDS.filter(
    (id) => !DEFAULT_BUILTIN_AGENT_IDS.includes(id),
  ),
  // Stale resources for removed first-party apps should not reappear as
  // custom remote agents just because the template metadata entry is gone.
  "calls",
  "code",
  "issues",
  "meeting-notes",
  "migration",
  "recruiting",
  "scheduling",
  "voice",
  "workbench",
]);

export function isBuiltinAgentCatalogId(id: string): boolean {
  return BUILTIN_AGENT_CATALOG_IDS.includes(normalizeAgentId(id));
}
