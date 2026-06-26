import enUS from "../i18n/en-US";
import {
  DEFAULT_DOCS_LOCALE,
  docsPathForSlug,
  type DocsLocale,
} from "./docs-locale";

export type NavItem = {
  id: string;
  label: string;
  to?: string;
  children?: NavItem[];
};
export type NavSection = { id: string; title: string; items: NavItem[] };

type Translate = (key: string) => string;

type NavItemConfig = {
  id: string;
  labelKey: keyof typeof enUS.nav;
  slug?: string;
  children?: NavItemConfig[];
};

type NavSectionConfig = {
  id: string;
  titleKey: keyof typeof enUS.nav;
  items: NavItemConfig[];
};

const NAV_SECTION_CONFIG: NavSectionConfig[] = [
  {
    id: "overview",
    titleKey: "overview",
    items: [
      {
        id: "getting-started",
        labelKey: "gettingStarted",
        slug: "getting-started",
      },
      {
        id: "what-is-agent-native",
        labelKey: "whatIsAgentNative",
        slug: "what-is-agent-native",
      },
      {
        id: "agent-surfaces",
        labelKey: "agentSurfaces",
        slug: "agent-surfaces",
      },
      { id: "key-concepts", labelKey: "keyConcepts", slug: "key-concepts" },
      { id: "cloneable-saas", labelKey: "templates", slug: "cloneable-saas" },
      { id: "faq", labelKey: "faq", slug: "faq" },
    ],
  },
  {
    id: "core-architecture",
    titleKey: "coreArchitecture",
    items: [
      { id: "server", labelKey: "server", slug: "server" },
      { id: "client", labelKey: "client", slug: "client" },
      { id: "routing", labelKey: "routing", slug: "routing" },
      { id: "actions", labelKey: "actions", slug: "actions" },
      {
        id: "human-approval",
        labelKey: "humanApproval",
        slug: "human-approval",
      },
      {
        id: "agent-web-surfaces",
        labelKey: "publicAgentWeb",
        slug: "agent-web-surfaces",
      },
      { id: "database", labelKey: "database", slug: "database" },
      {
        id: "internationalization",
        labelKey: "internationalization",
        slug: "internationalization",
      },
      {
        id: "local-file-mode",
        labelKey: "localFileMode",
        slug: "local-file-mode",
      },
      { id: "file-uploads", labelKey: "fileUploads", slug: "file-uploads" },
      { id: "deployment", labelKey: "deployment", slug: "deployment" },
      { id: "progress", labelKey: "progress", slug: "progress" },
    ],
  },
  {
    id: "data-auth-governance",
    titleKey: "dataAuthGovernance",
    items: [
      {
        id: "authentication",
        labelKey: "authentication",
        slug: "authentication",
      },
      { id: "multi-tenancy", labelKey: "multiTenancy", slug: "multi-tenancy" },
      {
        id: "security",
        labelKey: "securityDataScoping",
        slug: "security",
      },
      { id: "sharing", labelKey: "sharingPrivacy", slug: "sharing" },
      {
        id: "tracking",
        labelKey: "trackingAnalytics",
        slug: "tracking",
      },
      { id: "audit-log", labelKey: "auditLog", slug: "audit-log" },
      { id: "observability", labelKey: "observability", slug: "observability" },
      {
        id: "observational-memory",
        labelKey: "observationalMemory",
        slug: "observational-memory",
      },
      { id: "evals", labelKey: "ciEvalGate", slug: "evals" },
    ],
  },
  {
    id: "using-your-agent",
    titleKey: "usingYourAgent",
    items: [
      {
        id: "using-your-agent-overview",
        labelKey: "usingYourAgentOverview",
        slug: "using-your-agent",
      },
      {
        id: "context-awareness",
        labelKey: "contextAwareness",
        slug: "context-awareness",
      },
      {
        id: "agent-mentions",
        labelKey: "agentMentions",
        slug: "agent-mentions",
      },
      { id: "voice-input", labelKey: "voiceInput", slug: "voice-input" },
      { id: "drop-in-agent", labelKey: "dropInAgent", slug: "drop-in-agent" },
      { id: "components", labelKey: "componentApi", slug: "components" },
      {
        id: "native-chat-ui",
        labelKey: "nativeChatUi",
        slug: "native-chat-ui",
      },
      {
        id: "generative-ui",
        labelKey: "generativeUi",
        slug: "generative-ui",
      },
      {
        id: "real-time-collaboration",
        labelKey: "realTimeCollaboration",
        slug: "real-time-collaboration",
      },
    ],
  },
  {
    id: "workspace",
    titleKey: "workspace",
    items: [
      {
        id: "workspace-overview",
        labelKey: "workspaceOverview",
        slug: "workspace",
      },
      { id: "skills-guide", labelKey: "skills", slug: "skills-guide" },
      {
        id: "agent-teams",
        labelKey: "customAgentsTeams",
        slug: "agent-teams",
      },
      {
        id: "workspace-management",
        labelKey: "workspaceGovernance",
        slug: "workspace-management",
      },
      {
        id: "recurring-jobs",
        labelKey: "recurringJobs",
        slug: "recurring-jobs",
      },
      { id: "automations", labelKey: "automations", slug: "automations" },
      { id: "extensions", labelKey: "extensions", slug: "extensions" },
      {
        id: "multi-app-workspace",
        labelKey: "multiAppWorkspaces",
        slug: "multi-app-workspace",
      },
      {
        id: "onboarding",
        labelKey: "onboardingApiKeys",
        slug: "onboarding",
      },
    ],
  },
  {
    id: "integrations",
    titleKey: "integrations",
    items: [
      { id: "messaging", labelKey: "messaging", slug: "messaging" },
      { id: "dispatch", labelKey: "dispatch", slug: "dispatch" },
      { id: "a2a-protocol", labelKey: "a2aProtocol", slug: "a2a-protocol" },
      { id: "mcp-clients", labelKey: "mcpClients", slug: "mcp-clients" },
      {
        id: "mcp-protocol",
        labelKey: "mcpServer",
        slug: "mcp-protocol",
      },
      {
        id: "external-agents",
        labelKey: "externalAgents",
        slug: "external-agents",
      },
      { id: "mcp-apps", labelKey: "mcpApps", slug: "mcp-apps" },
      { id: "cross-app-sso", labelKey: "crossAppSso", slug: "cross-app-sso" },
      { id: "notifications", labelKey: "notifications", slug: "notifications" },
      {
        id: "workspace-connections",
        labelKey: "workspaceConnections",
        slug: "workspace-connections",
      },
    ],
  },
  {
    id: "build-apps",
    titleKey: "buildApps",
    items: [
      {
        id: "creating-templates",
        labelKey: "creatingTemplates",
        slug: "creating-templates",
      },
      {
        id: "writing-agent-instructions",
        labelKey: "writingAgentInstructions",
        slug: "writing-agent-instructions",
      },
      { id: "embedding-sdk", labelKey: "embeddingSdk", slug: "embedding-sdk" },
      { id: "frames", labelKey: "frames", slug: "frames" },
    ],
  },
  {
    id: "advanced-runtime",
    titleKey: "advancedRuntime",
    items: [
      {
        id: "code-agents-ui",
        labelKey: "agentNativeCodeUi",
        slug: "code-agents-ui",
      },
      {
        id: "migration-workbench",
        labelKey: "migrating",
        slug: "migration-workbench",
      },
      {
        id: "harness-agents",
        labelKey: "harnessAgents",
        slug: "harness-agents",
      },
      {
        id: "sandbox-adapters",
        labelKey: "adapters",
        slug: "sandbox-adapters",
      },
      { id: "cli-adapters", labelKey: "cliAdapters", slug: "cli-adapters" },
      { id: "processors", labelKey: "processors", slug: "processors" },
      {
        id: "durable-resume",
        labelKey: "durableResume",
        slug: "durable-resume",
      },
      {
        id: "durable-background-runs",
        labelKey: "durableBackgroundRuns",
        slug: "durable-background-runs",
      },
      {
        id: "blueprint-installer",
        labelKey: "blueprintInstaller",
        slug: "blueprint-installer",
      },
    ],
  },
  {
    id: "templates",
    titleKey: "templatesSection",
    // Do not add new templates here directly. The public-facing template list
    // is the strict allow-list in `packages/shared-app-config/templates.ts`
    // (entries with `hidden: false`). The CI guard enforces this.
    items: [
      { id: "template-chat", labelKey: "chat", slug: "template-chat" },
      {
        id: "template-calendar",
        labelKey: "calendar",
        slug: "template-calendar",
      },
      { id: "template-content", labelKey: "content", slug: "template-content" },
      {
        id: "plans-group",
        labelKey: "plans",
        children: [
          {
            id: "template-plan",
            labelKey: "visualPlans",
            slug: "template-plan",
          },
          {
            id: "pr-visual-recap",
            labelKey: "prVisualRecap",
            slug: "pr-visual-recap",
          },
          {
            id: "plan-plugin",
            labelKey: "planPluginMarketplace",
            slug: "plan-plugin",
          },
        ],
      },
      { id: "template-slides", labelKey: "slides", slug: "template-slides" },
      { id: "template-videos", labelKey: "video", slug: "template-videos" },
      {
        id: "template-analytics",
        labelKey: "analytics",
        slug: "template-analytics",
      },
      { id: "template-mail", labelKey: "mail", slug: "template-mail" },
      { id: "template-clips", labelKey: "clips", slug: "template-clips" },
      { id: "template-brain", labelKey: "brain", slug: "template-brain" },
      { id: "template-assets", labelKey: "assets", slug: "template-assets" },
      { id: "template-design", labelKey: "design", slug: "template-design" },
      {
        id: "template-dispatch",
        labelKey: "dispatch",
        slug: "template-dispatch",
      },
      { id: "template-forms", labelKey: "forms", slug: "template-forms" },
    ],
  },
];

function enMessage(key: string): string {
  const value = key
    .split(".")
    .reduce<unknown>(
      (current, part) =>
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[part]
          : undefined,
      enUS,
    );
  return typeof value === "string" ? value : key;
}

function navLabel(t: Translate, key: keyof typeof enUS.nav): string {
  return t(`nav.${key}`) || enMessage(`nav.${key}`);
}

function toNavItem(
  config: NavItemConfig,
  locale: DocsLocale,
  t: Translate,
): NavItem {
  const slug = config.slug;
  return {
    id: config.id,
    label: navLabel(t, config.labelKey),
    to: slug ? docsPathForSlug(slug, locale) : undefined,
    children: config.children?.map((child) => toNavItem(child, locale, t)),
  };
}

export function getDocsNavSections(
  locale: DocsLocale = DEFAULT_DOCS_LOCALE,
  t: Translate = enMessage,
): NavSection[] {
  return NAV_SECTION_CONFIG.map((section) => ({
    id: section.id,
    title: navLabel(t, section.titleKey),
    items: section.items.map((item) => toNavItem(item, locale, t)),
  }));
}

// Flat list for prev/next navigation and current-item lookups. Nested
// children (e.g. the plan docs under the Plans group) are flattened in place
// where their parent sits; chevron-only group headers (no `to`) are skipped
// so reading order stays intuitive and prev/next only lands on real pages.
function flattenItems(items: NavItem[]): NavItem[] {
  return items.flatMap((item) =>
    item.children
      ? // A group header has no `to`; keep only real pages in the flat
        // prev/next list so navigation never targets a non-page.
        [...(item.to ? [item] : []), ...flattenItems(item.children)]
      : [item],
  );
}

export function getDocsNavItems(
  locale: DocsLocale = DEFAULT_DOCS_LOCALE,
  t: Translate = enMessage,
): (NavItem & { to: string })[] {
  return getDocsNavSections(locale, t)
    .flatMap((section) => flattenItems(section.items))
    .filter((item): item is NavItem & { to: string } => item.to !== undefined);
}

export const NAV_SECTIONS: NavSection[] = getDocsNavSections();
export const NAV_ITEMS: (NavItem & { to: string })[] = getDocsNavItems();
