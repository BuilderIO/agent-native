import type { SettingsSearchEntry } from "./SettingsTabsPage.js";

export type SettingsSectionId =
  | "account"
  | "llm"
  | "app-models"
  | "limits"
  | "voice"
  | "demo-mode"
  | "automations"
  | "secrets"
  | "hosting"
  | "database"
  | "uploads"
  | "auth"
  | "email"
  | "browser"
  | "background"
  | "integrations"
  | "usage"
  | "a2a";

export const SETTINGS_SECTION_IDS = new Set<SettingsSectionId>([
  "account",
  "llm",
  "app-models",
  "limits",
  "voice",
  "demo-mode",
  "automations",
  "secrets",
  "hosting",
  "database",
  "uploads",
  "auth",
  "email",
  "browser",
  "background",
  "integrations",
  "usage",
  "a2a",
]);

export const ALL_SETTINGS_SECTIONS: readonly SettingsSectionId[] = [
  "account",
  "llm",
  "app-models",
  "limits",
  "voice",
  "demo-mode",
  "automations",
  "secrets",
  "hosting",
  "database",
  "uploads",
  "auth",
  "email",
  "browser",
  "background",
  "integrations",
  "usage",
  "a2a",
];

export const AGENT_SETTINGS_SECTIONS: readonly SettingsSectionId[] = [
  "llm",
  "app-models",
  "limits",
  "voice",
  "automations",
  "background",
  "a2a",
];

export const CONNECTION_SETTINGS_SECTIONS: readonly SettingsSectionId[] = [
  "secrets",
  "integrations",
  "email",
  "browser",
  "usage",
];

export const WORKSPACE_SETTINGS_SECTIONS: readonly SettingsSectionId[] = [
  "account",
  "demo-mode",
  "hosting",
  "database",
  "uploads",
  "auth",
];

const SETTINGS_SECTION_SEARCH_META: Record<
  SettingsSectionId,
  { label: string; keywords: string; description?: string }
> = {
  account: {
    label: "Account",
    keywords: "profile photo avatar identity signed in email name",
  },
  llm: {
    label: "LLM",
    keywords:
      "model claude gpt openai anthropic gemini api key provider ai engine llm",
  },
  "app-models": {
    label: "App Default Model",
    keywords: "default model provider app template composer",
  },
  limits: {
    label: "Agent Limits",
    keywords: "max iterations budget loop timeout runtime",
  },
  voice: {
    label: "Voice Transcription",
    keywords: "microphone dictation speech to text whisper",
  },
  "demo-mode": {
    label: "Demo mode",
    keywords: "fake data anonymize redact screenshot privacy mask",
  },
  automations: {
    label: "Automations",
    keywords: "triggers scheduled events cron jobs",
  },
  secrets: {
    label: "API Keys & Connections",
    keywords: "secrets credentials tokens api keys environment variables",
  },
  hosting: {
    label: "Hosting",
    keywords: "deploy netlify vercel cloudflare builder nitro",
  },
  database: {
    label: "Database",
    keywords: "postgres sqlite neon supabase turso storage sql pglite",
  },
  uploads: {
    label: "File uploads",
    keywords: "files storage s3 avatars attachments bucket blob",
  },
  auth: {
    label: "Authentication",
    keywords: "login signup oauth google github better auth access sso",
  },
  email: {
    label: "Email",
    keywords: "resend sendgrid smtp transactional notifications reports",
  },
  browser: {
    label: "Browser Automation",
    keywords: "web scraping playwright chrome headless",
  },
  background: {
    label: "Background Agent",
    keywords: "code changes branches builder production async",
  },
  integrations: {
    label: "Integrations",
    keywords: "slack telegram whatsapp discord messaging connect",
  },
  usage: {
    label: "Usage",
    keywords: "tokens cost spend billing consumption",
  },
  a2a: {
    label: "Connected Agents (A2A)",
    keywords: "remote agents protocol a2a connected",
  },
};

export function buildSectionSearchEntries(
  sections: readonly SettingsSectionId[],
): SettingsSearchEntry[] {
  return sections.map((section) => {
    const meta = SETTINGS_SECTION_SEARCH_META[section];
    return {
      id: `section:${section}`,
      label: meta.label,
      keywords: meta.keywords,
      description: meta.description,
      hash: section,
    };
  });
}

export interface AgentSettingsSearchTab {
  id: string;
  label: string;
  keywords: string;
  searchEntries?: SettingsSearchEntry[];
}

export function getAgentSettingsSearchTabs(): AgentSettingsSearchTab[] {
  return [
    {
      id: "agent",
      label: "Agent",
      keywords: "agent model llm limits voice automations",
      searchEntries: buildSectionSearchEntries(AGENT_SETTINGS_SECTIONS),
    },
    {
      id: "connections",
      label: "Connections",
      keywords: "connections secrets integrations email browser usage",
      searchEntries: buildSectionSearchEntries(CONNECTION_SETTINGS_SECTIONS),
    },
    {
      id: "organization",
      label: "Organization",
      keywords: "organization org team members invites collaborators",
    },
    {
      id: "workspace",
      label: "Workspace",
      keywords: "workspace account hosting database uploads auth",
      searchEntries: buildSectionSearchEntries(WORKSPACE_SETTINGS_SECTIONS),
    },
  ];
}
