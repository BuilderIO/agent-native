import { TEMPLATES } from "../cli/templates-meta.js";

/**
 * First-party agent ids discovery never lists, shared by agent discovery and
 * the Settings Sub-agents page so both agree on what the agent can call.
 */
export const HIDDEN_FIRST_PARTY_AGENT_IDS: ReadonlySet<string> = new Set([
  ...TEMPLATES.filter(
    (template) => template.hidden && !template.defaultAgent && template.prodUrl,
  ).map((template) => template.name),
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
