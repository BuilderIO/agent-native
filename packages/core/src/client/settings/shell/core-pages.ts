import {
  IconAdjustmentsHorizontal,
  IconApps,
  IconBell,
  IconBolt,
  IconBuilding,
  IconChartBar,
  IconClockPlay,
  IconCpu,
  IconFileText,
  IconFlask,
  IconFolder,
  IconHistory,
  IconKey,
  IconLibrary,
  IconLockAccess,
  IconMessages,
  IconNews,
  IconNotebook,
  IconPlugConnected,
  IconServer,
  IconServerBolt,
  IconShieldLock,
  IconTopologyRing2,
  IconUserCircle,
  IconUsers,
} from "@tabler/icons-react";
import { lazy } from "react";

import { AGENT_PROVIDER_CATALOG } from "../../agent-provider-catalog.js";
import { listChannelsForSettings } from "../../integrations/channel-setup.js";
import { DEFAULT_MCP_INTEGRATIONS } from "../../resources/mcp-integration-catalog.js";
import { SIGN_OUT_SEARCH_TERMS } from "../../sign-out.js";
import {
  PREFERENCES_SEARCH_ENTRIES,
  PROFILE_SEARCH_ENTRIES,
  SECURITY_SEARCH_ENTRIES,
} from "../account/search-entries.js";
import {
  canManageOrganizationPages,
  defineSettingsPage,
  type SettingsPageDefinition,
  type SettingsPageSearchEntry,
} from "./registry.js";

const label = (key: string) => `agentChat.settingsShell.page.${key}`;
const modelRow = (key: string) => `agentChat.settingsModel.${key}`;

// Provider key names are keywords so searching `OPENAI_API_KEY` finds the
// page; anchors are its group ids.
const API_KEYS_KEYWORDS = [
  "api keys secret secrets credential credentials token tokens vault shared organization keys",
  "environment variables github_token figma_access_token",
  ...AGENT_PROVIDER_CATALOG.flatMap((option) =>
    [option.key, option.endpointKey].filter(Boolean),
  ),
]
  .join(" ")
  .toLowerCase();

const API_KEYS_SEARCH_ENTRIES: readonly SettingsPageSearchEntry[] = [
  {
    id: "api-keys:add",
    labelKey: "agentChat.settingsApiKeys.addKey",
    keywords: "add new key secret token custom",
    anchor: "your-keys",
  },
  {
    id: "api-keys:yours",
    labelKey: "agentChat.settingsApiKeys.yourKeys",
    keywords: "personal keys secrets tokens",
    anchor: "your-keys",
  },
  {
    id: "api-keys:managed",
    labelKey: "agentChat.settingsApiKeys.managedKeys",
    keywords:
      "managed integrations oauth system tokens builder storage calendar",
    anchor: "managed-keys",
  },
];

// Anchors are the Model page's row and group ids.
const MODEL_PAGE_SEARCH_ENTRIES: readonly SettingsPageSearchEntry[] = [
  {
    id: "model:org-providers",
    labelKey: modelRow("orgProviders"),
    keywords: "organization providers shared api keys byok builder",
    anchor: "llm",
  },
  {
    id: "model:personal-providers",
    labelKey: modelRow("personalProviders"),
    keywords: "personal providers own api key byok",
    anchor: "personal-providers",
  },
  {
    id: "model:default-model",
    labelKey: "agentChat.settingsShell.search.defaultModel",
    keywords: "default model llm engine provider app",
    anchor: "default-model",
  },
  {
    id: "model:restrict-personal-keys",
    labelKey: modelRow("restrictLabel"),
    keywords: "restrict personal api keys byok members policy",
    anchor: "restrict-personal-keys",
  },
  {
    id: "model:max-iterations",
    labelKey: "agentChat.settingsShell.search.maxIterations",
    keywords: "max iterations agent limits steps loop budget",
    anchor: "max-iterations",
  },
  {
    id: "model:chatgpt-subscription",
    labelKey: modelRow("chatgptTitle"),
    keywords: "chatgpt subscription codex openai labs",
    anchor: "chatgpt-subscription",
  },
  // Provider names aren't translated.
  ...AGENT_PROVIDER_CATALOG.map((option) => ({
    id: `model:provider:${option.id}`,
    label: option.label,
    keywords: `${option.id} provider api key model byok`,
  })),
];

const infraRow = (key: string) => `agentChat.settingsInfra.${key}`;

// Anchors are the Infrastructure page's row ids; `hosting`, `database`,
// `uploads`, and `background` are also where legacy section links land.
const INFRA_PAGE_SEARCH_ENTRIES: readonly SettingsPageSearchEntry[] = [
  {
    id: "infra:builder",
    label: "Builder.io",
    keywords: "builder setup byok configure manually credits connect",
    anchor: "builder",
  },
  {
    id: "infra:ai-model",
    labelKey: infraRow("aiModel"),
    keywords: "ai model llm provider byok every app",
    anchor: "ai-model",
  },
  {
    id: "infra:uploads",
    labelKey: "agentChat.settingsShell.search.fileUploads",
    keywords:
      "s3 r2 bucket storage uploads supabase minio amazon cloudflare file storage",
    anchor: "uploads",
  },
  {
    id: "infra:voice",
    labelKey: infraRow("voice"),
    keywords: "voice input dictation transcription speech gemini groq openai",
    anchor: "voice",
  },
  {
    id: "infra:images",
    labelKey: infraRow("images"),
    keywords: "image generation images slides design gemini openai",
    anchor: "images",
  },
  {
    id: "infra:embeddings",
    labelKey: infraRow("embeddings"),
    keywords: "embeddings semantic search brain gemini cohere voyage",
    anchor: "embeddings",
  },
  {
    id: "infra:design-system-intelligence",
    labelKey: infraRow("designSystem"),
    keywords: "design system intelligence brand builder only",
    anchor: "design-system-intelligence",
  },
  {
    id: "infra:background",
    labelKey: "agentChat.settingsShell.search.backgroundAgents",
    keywords: "background agent builder code changes production",
    anchor: "background",
  },
  {
    id: "infra:browser-automation",
    labelKey: "agentChat.settingsShell.search.browserAutomation",
    keywords: "browser automation builder only production",
    anchor: "browser-automation",
  },
  {
    id: "infra:database",
    labelKey: "agentChat.settingsShell.search.database",
    keywords: "database postgres database_url neon supabase pglite",
    anchor: "database",
  },
  {
    id: "infra:hosting",
    labelKey: "agentChat.settingsShell.search.hosting",
    keywords:
      "hosting deploy deployment netlify vercel cloudflare addresses nitro_preset",
    anchor: "hosting",
  },
  {
    id: "infra:variables",
    labelKey: infraRow("variables"),
    keywords:
      "env environment variables secrets database_url a2a_secret better_auth_secret app_url secrets_encryption_key",
    anchor: "variables",
  },
];

/** The read-only group of resources Dispatch shares with every app. */
const fromDispatchSearchEntry: SettingsPageSearchEntry = {
  id: "from-dispatch",
  labelKey: "agentChat.settingsResources.fromDispatch",
  keywords: "dispatch workspace shared inherited all apps",
  anchor: "from-dispatch",
};

const CATALOG_INTEGRATIONS = DEFAULT_MCP_INTEGRATIONS.filter(
  (integration) => integration.id !== "builder-cms",
);

// One result per catalog tool, opening its page, plus the Builder.io page.
// Builder Publish is the content grant, which the page leaves out.
const INTEGRATION_SEARCH_ENTRIES: readonly SettingsPageSearchEntry[] = [
  {
    id: "builder",
    label: "Builder.io",
    keywords:
      "builder builder.io connect account credits model storage organization personal",
    sub: "builder",
  },
  ...CATALOG_INTEGRATIONS.map((integration) => ({
    id: `integration:${integration.id}`,
    label: integration.name,
    keywords: [integration.provider, ...integration.keywords].join(" "),
    sub: integration.id,
  })),
];

// One page per channel, and one search result each opening it. Brand names
// aren't translated.
const CHANNELS = listChannelsForSettings();
const CHANNEL_SEARCH_ENTRIES: readonly SettingsPageSearchEntry[] = CHANNELS.map(
  (channel) => ({
    id: `channel:${channel.id}`,
    label: channel.name,
    keywords: [
      channel.id.replace(/-/g, " "),
      "agent channel messaging bot mention webhook",
      ...channel.credentialRequirements.map((item) => item.key),
    ].join(" "),
    sub: channel.id,
  }),
);

/**
 * Core pages in spec order (§4.2). Each renders today's component for its
 * area until its page task swaps the file under `pages/`; ids and
 * `legacyTabIds` stay stable across that swap.
 */
export const CORE_SETTINGS_PAGES: readonly SettingsPageDefinition[] = [
  defineSettingsPage({
    id: "profile",
    group: "account",
    order: 10,
    labelKey: label("profile"),
    icon: IconUserCircle,
    component: lazy(() => import("./pages/profile.js")),
    legacyTabIds: ["account"],
    keywords: [
      "profile photo avatar identity signed in email name",
      ...SIGN_OUT_SEARCH_TERMS,
    ].join(" "),
    searchEntries: PROFILE_SEARCH_ENTRIES,
  }),
  defineSettingsPage({
    id: "preferences",
    group: "account",
    order: 20,
    labelKey: label("preferences"),
    icon: IconAdjustmentsHorizontal,
    component: lazy(() => import("./pages/preferences.js")),
    legacyTabIds: ["language"],
    keywords: "language locale timezone voice transcription dictation",
    searchEntries: PREFERENCES_SEARCH_ENTRIES,
  }),
  defineSettingsPage({
    id: "security",
    group: "account",
    order: 30,
    labelKey: label("security"),
    icon: IconShieldLock,
    component: lazy(() => import("./pages/security.js")),
    keywords: "password two-factor 2fa authenticator privacy data deletion",
    searchEntries: SECURITY_SEARCH_ENTRIES,
  }),
  defineSettingsPage({
    id: "integrations",
    group: "connections",
    order: 10,
    labelKey: label("integrations"),
    icon: IconPlugConnected,
    component: lazy(() => import("./pages/integrations.js")),
    legacyTabIds: ["integrations", "connections", "browser"],
    keywords: "integrations connections mcp tools builder slack",
    // Brand names aren't translated.
    subpages: [
      { id: "builder", label: "Builder.io" },
      ...CATALOG_INTEGRATIONS.map((integration) => ({
        id: integration.id,
        label: integration.name,
      })),
    ],
    searchEntries: INTEGRATION_SEARCH_ENTRIES,
  }),
  defineSettingsPage({
    id: "api-keys",
    group: "connections",
    order: 20,
    labelKey: label("apiKeys"),
    icon: IconKey,
    component: lazy(() => import("./pages/api-keys.js")),
    legacyTabIds: ["keys", "secrets"],
    keywords: API_KEYS_KEYWORDS,
    searchEntries: API_KEYS_SEARCH_ENTRIES,
  }),
  defineSettingsPage({
    id: "model",
    group: "agent",
    order: 10,
    labelKey: label("model"),
    icon: IconCpu,
    component: lazy(() => import("./pages/model.js")),
    legacyTabIds: ["agent", "agent:overview", "providers"],
    keywords: "model llm provider default model max iterations limits",
    searchEntries: MODEL_PAGE_SEARCH_ENTRIES,
  }),
  defineSettingsPage({
    id: "instructions",
    group: "agent",
    order: 20,
    labelKey: label("instructions"),
    icon: IconFileText,
    component: lazy(() => import("./pages/instructions.js")),
    legacyTabIds: ["agent:resources:instructions"],
    keywords: "instructions agents md behavior",
    searchEntries: [fromDispatchSearchEntry],
  }),
  defineSettingsPage({
    id: "memory",
    group: "agent",
    order: 30,
    labelKey: label("memory"),
    icon: IconNotebook,
    component: lazy(() => import("./pages/memory.js")),
    legacyTabIds: ["agent:resources:memory", "agent:resources:learnings"],
    keywords: "memory learnings personalization",
    searchEntries: [
      {
        id: "learnings",
        labelKey: "agentChat.settingsShell.learnings",
        keywords: "learnings feedback memory",
        anchor: "learnings",
      },
    ],
  }),
  defineSettingsPage({
    id: "skills",
    group: "agent",
    order: 40,
    labelKey: label("skills"),
    icon: IconBolt,
    component: lazy(() => import("./pages/skills.js")),
    legacyTabIds: ["agent:resources:skills"],
    keywords: "skills capabilities workflows add upload skill file",
    searchEntries: [fromDispatchSearchEntry],
  }),
  defineSettingsPage({
    id: "files",
    group: "agent",
    order: 50,
    labelKey: label("files"),
    icon: IconFolder,
    component: lazy(() => import("./pages/files.js")),
    legacyTabIds: ["agent:resources", "agent:resources:files"],
    keywords: "files uploads documents context resources upload create file",
    searchEntries: [fromDispatchSearchEntry],
  }),
  defineSettingsPage({
    id: "sub-agents",
    group: "agent",
    order: 60,
    labelKey: label("subAgents"),
    icon: IconTopologyRing2,
    component: lazy(() => import("./pages/sub-agents.js")),
    legacyTabIds: [
      "agent:agents",
      "agent:directory",
      "agent:resources:agents",
      "agent:resources:remote-agents",
    ],
    keywords: "sub-agents custom agents remote agents a2a directory delegate",
    searchEntries: [
      {
        id: "workspace-apps",
        labelKey: "agentChat.settingsSubAgents.workspaceApps",
        keywords: "apps first-party workspace a2a reachable",
        anchor: "workspace-apps",
      },
      {
        id: "external-agents",
        labelKey: "agentChat.settingsSubAgents.external",
        keywords:
          "a2a connected agents remote agents foundry gemini anthropic managed",
        anchor: "external-agents",
      },
      {
        id: "custom-agents",
        labelKey: "agentChat.settingsSubAgents.custom",
        keywords: "custom agents profiles delegate add agent",
        anchor: "custom-agents",
      },
      {
        id: "agent-directory",
        labelKey: "agentChat.agents.directoryTab",
        keywords:
          "agent directory connect agent providers registry foundry gemini anthropic a2a",
        anchor: "external-agents",
      },
    ],
  }),
  defineSettingsPage({
    id: "org",
    group: "organization",
    order: 10,
    labelKey: label("orgGeneral"),
    icon: IconBuilding,
    component: lazy(() => import("./pages/org.js")),
    legacyTabIds: ["organization", "team"],
    keywords: "organization org team name",
  }),
  defineSettingsPage({
    id: "members",
    group: "organization",
    order: 20,
    labelKey: label("members"),
    icon: IconUsers,
    component: lazy(() => import("./pages/members.js")),
    keywords: "members invites roles people collaborators groups",
    searchEntries: [
      {
        id: "invite-members",
        labelKey: "org.inviteMembers",
        keywords: "invite add people email csv",
        anchor: "members",
      },
      {
        id: "member-roles",
        labelKey: "agentChat.settingsOrg.search.roles",
        keywords: "roles role admin owner member change remove",
        anchor: "members",
      },
      {
        id: "groups",
        labelKey: "org.groups",
        keywords: "groups teams app access",
        anchor: "groups",
      },
    ],
  }),
  defineSettingsPage({
    id: "usage",
    group: "organization",
    order: 30,
    labelKey: label("usage"),
    icon: IconChartBar,
    component: lazy(() => import("./pages/usage.js")),
    legacyTabIds: ["usage"],
    keywords: "usage tokens cost spend billing credits",
  }),
  defineSettingsPage({
    id: "auth",
    group: "organization",
    order: 40,
    labelKey: label("auth"),
    icon: IconLockAccess,
    visible: canManageOrganizationPages,
    component: lazy(() => import("./pages/auth.js")),
    keywords: "authentication sign-in sso saml oidc scim domain",
    searchEntries: [
      {
        id: "organization-sign-in",
        labelKey: "org.sso.signIn",
        keywords: "require enforce google sso provider",
        anchor: "organization-sign-in",
      },
      {
        id: "sso",
        labelKey: "org.sso.title",
        keywords: "sso saml oidc okta identity provider",
        anchor: "organization-sso",
      },
      {
        id: "scim",
        labelKey: "org.scim.title",
        keywords: "scim directory provisioning sync",
        anchor: "organization-scim",
      },
      {
        id: "email-domain",
        labelKey: "agentChat.settingsOrg.search.domainAutoJoin",
        keywords: "domain auto-join email join automatically",
        anchor: "email-domain",
      },
    ],
  }),
  defineSettingsPage({
    id: "apps",
    group: "organization",
    order: 50,
    labelKey: label("apps"),
    icon: IconApps,
    visible: canManageOrganizationPages,
    component: lazy(() => import("./pages/apps.js")),
    keywords: "apps access privacy workspace apps",
    searchEntries: [
      {
        id: "new-app-privacy",
        labelKey: "org.workspaceAppsDefaultPrivacy",
        keywords: "privacy creator only default visibility",
        anchor: "workspace-app-default-visibility",
      },
    ],
  }),
  defineSettingsPage({
    id: "infra",
    group: "organization",
    order: 60,
    labelKey: label("infra"),
    icon: IconServer,
    visible: canManageOrganizationPages,
    component: lazy(() => import("./pages/infra.js")),
    legacyTabIds: ["workspace"],
    keywords: "infrastructure hosting database storage uploads services",
    searchEntries: INFRA_PAGE_SEARCH_ENTRIES,
  }),
  defineSettingsPage({
    id: "audit",
    group: "organization",
    order: 70,
    labelKey: label("audit"),
    icon: IconHistory,
    visible: canManageOrganizationPages,
    component: lazy(() => import("./pages/audit.js")),
    keywords: "audit log history changes",
  }),
  defineSettingsPage({
    id: "app",
    group: "app",
    order: 10,
    labelKey: label("appGeneral"),
    // The shell swaps in the app's own icon for this page.
    icon: IconApps,
    component: lazy(() => import("./pages/app.js")),
    legacyTabIds: ["general"],
  }),
  defineSettingsPage({
    id: "notifications",
    group: "app",
    order: 20,
    labelKey: label("notifications"),
    icon: IconBell,
    visible: (_context, bridge) => Boolean(bridge.tab("notifications")),
    component: lazy(() => import("./pages/notifications.js")),
    legacyTabIds: ["notifications"],
    keywords: "notifications email alerts",
  }),
  defineSettingsPage({
    id: "automations",
    group: "app",
    order: 30,
    labelKey: label("automations"),
    icon: IconClockPlay,
    component: lazy(() => import("./pages/automations.js")),
    legacyTabIds: ["agent:automations"],
    keywords: "automations scheduled events cron jobs tasks",
  }),
  defineSettingsPage({
    id: "channels",
    group: "app",
    order: 40,
    labelKey: label("channels"),
    icon: IconMessages,
    component: lazy(() => import("./pages/channels.js")),
    keywords:
      "channels slack telegram whatsapp google docs discord teams email messaging",
    subpages: CHANNELS.map((channel) => ({
      id: channel.id,
      label: channel.name,
    })),
    searchEntries: CHANNEL_SEARCH_ENTRIES,
  }),
  defineSettingsPage({
    id: "mcp",
    group: "app",
    order: 50,
    labelKey: label("mcp"),
    icon: IconServerBolt,
    component: lazy(() => import("./pages/mcp.js")),
    legacyTabIds: ["mcp"],
    keywords: "mcp server url claude chatgpt cursor codex a2a",
  }),
  defineSettingsPage({
    id: "creative-context",
    group: "app",
    order: 60,
    labelKey: label("creativeContext"),
    icon: IconLibrary,
    visible: (_context, bridge) => Boolean(bridge.tab("library")),
    component: lazy(() => import("./pages/creative-context.js")),
    legacyTabIds: ["library"],
    keywords: "creative context library sources packs brand",
  }),
  defineSettingsPage({
    id: "labs",
    group: "footer",
    order: 10,
    labelKey: label("labs"),
    icon: IconFlask,
    component: lazy(() => import("./pages/labs.js")),
    legacyTabIds: ["labs", "experiments"],
    keywords: "labs experimental unstable beta",
  }),
  defineSettingsPage({
    id: "whats-new",
    group: "footer",
    order: 20,
    labelKey: label("whatsNew"),
    icon: IconNews,
    visible: (_context, bridge) =>
      bridge.whatsNew != null || bridge.whatsNewMarkdown != null,
    component: lazy(() => import("./pages/whats-new.js")),
    legacyTabIds: ["whats-new", "changelog", "updates"],
    keywords: "whats new changelog updates releases",
  }),
];

export const BridgedTabSettingsPage = lazy(
  () => import("./pages/bridged-tab.js"),
);
