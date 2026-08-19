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
  draft?: boolean;
  children?: NavItem[];
};
export type NavSection = { id: string; title: string; items: NavItem[] };

type Translate = (key: string) => string;

type NavItemConfig = {
  id: string;
  labelKey: keyof typeof enUS.nav;
  slug?: string;
  draft?: boolean;
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
      { id: "key-concepts", labelKey: "keyConcepts", slug: "key-concepts" },
      {
        id: "agent-surfaces",
        labelKey: "agentSurfaces",
        slug: "agent-surfaces",
      },
      { id: "faq", labelKey: "faq", slug: "faq" },
    ],
  },
  {
    id: "apps",
    titleKey: "templatesSection",
    // Do not add new templates here directly. The public-facing template list
    // is the strict allow-list in `packages/shared-app-config/templates.ts`
    // (entries with `hidden: false`). The CI guard enforces this.
    items: [
      {
        id: "cloneable-saas",
        labelKey: "templatesOverview",
        slug: "cloneable-saas",
      },
      {
        id: "pure-agent-apps",
        labelKey: "pureAgentApps",
        slug: "pure-agent-apps",
      },
      {
        id: "chat-group",
        labelKey: "chat",
        children: [
          {
            id: "template-chat",
            labelKey: "chatOverview",
            slug: "template-chat",
          },
          {
            id: "template-chat-first-edits",
            labelKey: "chatFirstEdits",
            slug: "template-chat-first-edits",
          },
          {
            id: "template-chat-developers",
            labelKey: "chatDevelopers",
            slug: "template-chat-developers",
          },
        ],
      },
      {
        id: "calendar-group",
        labelKey: "calendar",
        children: [
          {
            id: "template-calendar",
            labelKey: "calendarOverview",
            slug: "template-calendar",
          },
          {
            id: "template-calendar-agent",
            labelKey: "calendarAgent",
            slug: "template-calendar-agent",
          },
          {
            id: "template-calendar-scheduling",
            labelKey: "calendarScheduling",
            slug: "template-calendar-scheduling",
          },
          {
            id: "template-calendar-booking-links",
            labelKey: "calendarBookingLinks",
            slug: "template-calendar-booking-links",
          },
          {
            id: "template-calendar-developers",
            labelKey: "calendarDevelopers",
            slug: "template-calendar-developers",
          },
        ],
      },
      {
        id: "content-group",
        labelKey: "content",
        children: [
          {
            id: "template-content",
            labelKey: "contentOverview",
            slug: "template-content",
          },
          {
            id: "template-content-editing",
            labelKey: "contentEditing",
            slug: "template-content-editing",
          },
          {
            id: "template-content-databases",
            labelKey: "contentDatabases",
            slug: "template-content-databases",
          },
          {
            id: "template-content-sync",
            labelKey: "contentSync",
            slug: "template-content-sync",
          },
          {
            id: "template-content-local-files",
            labelKey: "localFileMode",
            slug: "template-content-local-files",
          },
          {
            id: "template-content-developers",
            labelKey: "contentDevelopers",
            slug: "template-content-developers",
          },
        ],
      },
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
            id: "template-plan-review-workflow",
            labelKey: "planReviewWorkflow",
            slug: "template-plan-review-workflow",
          },
          {
            id: "template-plan-automations",
            labelKey: "planAutomations",
            slug: "template-plan-automations",
          },
          {
            id: "template-plan-local-and-desktop",
            labelKey: "planLocalAndDesktop",
            slug: "template-plan-local-and-desktop",
          },
          {
            id: "template-plan-developers",
            labelKey: "planDevelopers",
            slug: "template-plan-developers",
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
      {
        id: "slides-group",
        labelKey: "slides",
        children: [
          {
            id: "template-slides",
            labelKey: "slidesOverview",
            slug: "template-slides",
          },
          {
            id: "template-slides-agent",
            labelKey: "slidesAgent",
            slug: "template-slides-agent",
          },
          {
            id: "template-slides-editing",
            labelKey: "slidesEditing",
            slug: "template-slides-editing",
          },
          {
            id: "template-slides-design-and-media",
            labelKey: "slidesDesignAndMedia",
            slug: "template-slides-design-and-media",
          },
          {
            id: "template-slides-developers",
            labelKey: "slidesDevelopers",
            slug: "template-slides-developers",
          },
        ],
      },
      {
        id: "analytics-group",
        labelKey: "analytics",
        children: [
          {
            id: "template-analytics",
            labelKey: "analyticsOverview",
            slug: "template-analytics",
          },
          {
            id: "template-analytics-dashboards",
            labelKey: "analyticsDashboards",
            slug: "template-analytics-dashboards",
          },
          {
            id: "template-analytics-connectors",
            labelKey: "analyticsConnectors",
            slug: "template-analytics-connectors",
          },
          {
            id: "template-analytics-monitoring-and-sessions",
            labelKey: "analyticsMonitoringAndSessions",
            slug: "template-analytics-monitoring-and-sessions",
          },
          {
            id: "template-analytics-developers",
            labelKey: "analyticsDevelopers",
            slug: "template-analytics-developers",
          },
        ],
      },
      {
        id: "mail-group",
        labelKey: "mail",
        children: [
          {
            id: "template-mail",
            labelKey: "mailOverview",
            slug: "template-mail",
          },
          {
            id: "template-mail-agent",
            labelKey: "mailAgent",
            slug: "template-mail-agent",
          },
          {
            id: "template-mail-inbox",
            labelKey: "mailInbox",
            slug: "template-mail-inbox",
          },
          {
            id: "template-mail-drafts-and-queue",
            labelKey: "mailDraftsAndQueue",
            slug: "template-mail-drafts-and-queue",
          },
          {
            id: "template-mail-developers",
            labelKey: "mailDevelopers",
            slug: "template-mail-developers",
          },
        ],
      },
      {
        id: "clips-group",
        labelKey: "clips",
        children: [
          {
            id: "template-clips",
            labelKey: "clipsOverview",
            slug: "template-clips",
          },
          {
            id: "template-clips-capture-everywhere",
            labelKey: "clipsCaptureEverywhere",
            slug: "template-clips-capture-everywhere",
          },
          {
            id: "template-clips-ai-and-editing",
            labelKey: "clipsAiAndEditing",
            slug: "template-clips-ai-and-editing",
          },
          {
            id: "template-clips-sharing-and-teams",
            labelKey: "clipsSharingAndTeams",
            slug: "template-clips-sharing-and-teams",
          },
          {
            id: "template-clips-developers",
            labelKey: "clipsDevelopers",
            slug: "template-clips-developers",
          },
        ],
      },
      {
        id: "brain-group",
        labelKey: "brain",
        children: [
          {
            id: "template-brain",
            labelKey: "brainOverview",
            slug: "template-brain",
          },
          {
            id: "template-brain-sources",
            labelKey: "brainSources",
            slug: "template-brain-sources",
          },
          {
            id: "template-brain-knowledge",
            labelKey: "brainKnowledge",
            slug: "template-brain-knowledge",
          },
          {
            id: "template-brain-agent",
            labelKey: "brainAgent",
            slug: "template-brain-agent",
          },
          {
            id: "template-brain-developers",
            labelKey: "brainDevelopers",
            slug: "template-brain-developers",
          },
        ],
      },
      {
        id: "assets-group",
        labelKey: "assets",
        children: [
          {
            id: "template-assets",
            labelKey: "assetsOverview",
            slug: "template-assets",
          },
          {
            id: "template-assets-generation",
            labelKey: "assetsGeneration",
            slug: "template-assets-generation",
          },
          {
            id: "template-assets-presets",
            labelKey: "assetsPresets",
            slug: "template-assets-presets",
          },
          {
            id: "template-assets-integrations",
            labelKey: "assetsIntegrations",
            slug: "template-assets-integrations",
          },
          {
            id: "template-assets-developers",
            labelKey: "assetsDevelopers",
            slug: "template-assets-developers",
          },
        ],
      },
      {
        id: "design-group",
        labelKey: "design",
        children: [
          {
            id: "template-design",
            labelKey: "designOverview",
            slug: "template-design",
          },
          {
            id: "template-design-quality-and-components",
            labelKey: "designQualityAndComponents",
            slug: "template-design-quality-and-components",
          },
          {
            id: "template-design-brand-and-figma",
            labelKey: "designBrandAndFigma",
            slug: "template-design-brand-and-figma",
          },
          {
            id: "template-design-collaboration-and-full-apps",
            labelKey: "designCollaborationAndFullApps",
            slug: "template-design-collaboration-and-full-apps",
          },
          {
            id: "template-design-developers",
            labelKey: "designDevelopers",
            slug: "template-design-developers",
          },
        ],
      },
      {
        id: "dispatch-group",
        labelKey: "dispatch",
        children: [
          {
            id: "template-dispatch",
            labelKey: "dispatchOverview",
            slug: "template-dispatch",
          },
          {
            id: "template-dispatch-messaging-routing",
            labelKey: "dispatchMessagingRouting",
            slug: "template-dispatch-messaging-routing",
          },
          {
            id: "template-dispatch-operations",
            labelKey: "dispatchOperations",
            slug: "template-dispatch-operations",
          },
          {
            id: "template-dispatch-vault-integrations",
            labelKey: "dispatchVaultIntegrations",
            slug: "template-dispatch-vault-integrations",
          },
          {
            id: "template-dispatch-developers",
            labelKey: "dispatchDevelopers",
            slug: "template-dispatch-developers",
          },
        ],
      },
      {
        id: "forms-group",
        labelKey: "forms",
        children: [
          {
            id: "template-forms",
            labelKey: "formsOverview",
            slug: "template-forms",
          },
          {
            id: "template-forms-building-publishing",
            labelKey: "formsBuildingPublishing",
            slug: "template-forms-building-publishing",
          },
          {
            id: "template-forms-responses",
            labelKey: "formsResponses",
            slug: "template-forms-responses",
          },
          {
            id: "template-forms-developers",
            labelKey: "formsDevelopers",
            slug: "template-forms-developers",
          },
        ],
      },
    ],
  },
  {
    id: "core-architecture",
    titleKey: "coreArchitecture",
    items: [
      {
        id: "server-section",
        labelKey: "server",
        children: [
          {
            id: "server-overview",
            labelKey: "serverOverview",
            slug: "server-overview",
          },
          {
            id: "server-database",
            labelKey: "database",
            slug: "server-database",
          },
          {
            id: "server-middleware",
            labelKey: "serverMiddleware",
            slug: "server-middleware",
          },
          {
            id: "server-plugins",
            labelKey: "serverPlugins",
            slug: "server-plugins",
          },
          {
            id: "server-routes",
            labelKey: "serverRoutes",
            slug: "server-routes",
          },
        ],
      },
      {
        id: "client-section",
        labelKey: "client",
        children: [
          {
            id: "client-overview",
            labelKey: "clientOverview",
            slug: "client-overview",
          },
          {
            id: "client-data",
            labelKey: "clientDataSync",
            slug: "client-data",
          },
          {
            id: "client-agent-chat",
            labelKey: "clientAgentChat",
            slug: "client-agent-chat",
          },
          {
            id: "client-routing",
            labelKey: "routing",
            slug: "client-routing",
          },
          {
            id: "client-advanced",
            labelKey: "clientAdvanced",
            slug: "client-advanced",
          },
          {
            id: "client-sync-internals",
            labelKey: "clientSyncInternals",
            slug: "client-sync-internals",
          },
          {
            id: "client-entry-points",
            labelKey: "clientEntryPoints",
            slug: "client-entry-points",
          },
        ],
      },
      {
        id: "actions-section",
        labelKey: "actions",
        children: [
          {
            id: "actions-overview",
            labelKey: "actionsOverview",
            slug: "actions-overview",
          },
          {
            id: "actions-defining",
            labelKey: "actionsDefining",
            slug: "actions-defining",
          },
          {
            id: "actions-access-control",
            labelKey: "actionsAccessControl",
            slug: "actions-access-control",
          },
          {
            id: "actions-run-context",
            labelKey: "actionsRunContext",
            slug: "actions-run-context",
          },
          {
            id: "actions-other-surfaces",
            labelKey: "actionsOtherSurfaces",
            slug: "actions-other-surfaces",
          },
          {
            id: "actions-advanced",
            labelKey: "actionsAdvanced",
            slug: "actions-advanced",
          },
          {
            id: "actions-agent-tools",
            labelKey: "actionsAgentTools",
            slug: "actions-agent-tools",
          },
        ],
      },
      {
        id: "internationalization",
        labelKey: "internationalization",
        slug: "internationalization",
      },
      { id: "file-uploads", labelKey: "fileUploads", slug: "file-uploads" },
      {
        id: "environment-variables",
        labelKey: "environmentVariables",
        slug: "environment-variables",
      },
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
        id: "organizations-teams-permissions",
        labelKey: "organizationsTeamsPermissions",
        slug: "organizations-teams-permissions",
      },
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
      {
        id: "doctor",
        labelKey: "doctorCodeChecks",
        slug: "doctor",
      },
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
    id: "agent-resources",
    titleKey: "agentResources",
    items: [
      {
        id: "agent-resources-overview",
        labelKey: "agentResourcesOverview",
        slug: "agent-resources",
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
        id: "data-programs",
        labelKey: "dataPrograms",
        slug: "data-programs",
      },
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
      {
        id: "integration-directory",
        labelKey: "integrations",
        slug: "integrations",
      },
      { id: "messaging", labelKey: "messaging", slug: "messaging" },
      {
        id: "messaging-recipes",
        labelKey: "messagingRecipes",
        slug: "messaging-recipes",
      },
      {
        id: "messaging-internals",
        labelKey: "messagingInternals",
        slug: "messaging-internals",
      },
      { id: "dispatch", labelKey: "dispatch", slug: "dispatch" },
      { id: "portal", labelKey: "portal", slug: "portal" },
      { id: "a2a-protocol", labelKey: "a2aProtocol", slug: "a2a-protocol" },
      { id: "mcp-clients", labelKey: "mcpClients", slug: "mcp-clients" },
      { id: "http-api", labelKey: "httpApi", slug: "http-api" },
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
      {
        id: "external-agents-catalog",
        labelKey: "externalAgentsCatalog",
        slug: "external-agents-catalog",
      },
      {
        id: "agent-web-surfaces",
        labelKey: "publicAgentWeb",
        slug: "agent-web-surfaces",
      },
      { id: "mcp-apps", labelKey: "mcpApps", slug: "mcp-apps" },
      { id: "cross-app-sso", labelKey: "crossAppSso", slug: "cross-app-sso" },
      { id: "notifications", labelKey: "notifications", slug: "notifications" },
      { id: "progress", labelKey: "progress", slug: "progress" },
      {
        id: "automation-connectors",
        labelKey: "automationConnectors",
        slug: "automation-connectors",
      },
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
        id: "syncing-template-changes",
        labelKey: "syncingTemplateChanges",
        slug: "syncing-template-changes",
      },
      {
        id: "writing-agent-instructions",
        labelKey: "writingAgentInstructions",
        slug: "writing-agent-instructions",
      },
      { id: "embedding-sdk", labelKey: "embeddingSdk", slug: "embedding-sdk" },
      { id: "frames", labelKey: "frames", slug: "frames" },
      {
        id: "deployment-section",
        labelKey: "deployment",
        children: [
          {
            id: "deployment",
            labelKey: "deploymentOverview",
            slug: "deployment",
          },
          {
            id: "workspace-deployment",
            labelKey: "workspaceDeployment",
            slug: "workspace-deployment",
          },
          {
            id: "node-docker",
            labelKey: "deploymentNodeDocker",
            slug: "node-docker",
          },
          {
            id: "vercel",
            labelKey: "deploymentVercel",
            slug: "vercel",
          },
          {
            id: "netlify",
            labelKey: "deploymentNetlify",
            slug: "netlify",
          },
          {
            id: "cloudflare",
            labelKey: "deploymentCloudflare",
            slug: "cloudflare",
          },
          {
            id: "other-platforms",
            labelKey: "deploymentOtherPlatforms",
            slug: "other-platforms",
          },
          { id: "ssr-caching", labelKey: "ssrCaching", slug: "ssr-caching" },
          {
            id: "deployment-environment-variables",
            labelKey: "deploymentEnvironmentVariables",
            slug: "deployment-environment-variables",
          },
          {
            id: "updating-ui-in-production",
            labelKey: "updatingUiInProduction",
            slug: "updating-ui-in-production",
          },
        ],
      },
    ],
  },
  {
    id: "toolkits",
    titleKey: "agentNativeToolkit",
    items: [
      {
        id: "agent-native-toolkit",
        labelKey: "toolkitOverview",
        slug: "agent-native-toolkit",
      },
      {
        id: "toolkit-ui",
        labelKey: "toolkitUiPrimitives",
        slug: "toolkit-ui",
      },
      {
        id: "custom-design-system",
        labelKey: "customDesignSystem",
        slug: "custom-design-system",
      },
      {
        id: "toolkit-editors-canvases",
        labelKey: "toolkitEditorsCanvases",
        slug: "toolkit-editors-canvases",
      },
      {
        id: "toolkit-context-knowledge",
        labelKey: "toolkitContextKnowledge",
        slug: "toolkit-context-knowledge",
      },
      {
        id: "toolkit-feature-kits",
        labelKey: "featureKits",
        children: [
          {
            id: "toolkit-sharing",
            labelKey: "toolkitSharing",
            slug: "toolkit-sharing",
          },
          {
            id: "toolkit-collaboration",
            labelKey: "toolkitCollaboration",
            slug: "toolkit-collaboration",
          },
          {
            id: "toolkit-history",
            labelKey: "toolkitHistory",
            slug: "toolkit-history",
          },
          {
            id: "toolkit-comments-review",
            labelKey: "toolkitCommentsReview",
            slug: "toolkit-comments-review",
          },
          {
            id: "toolkit-observability",
            labelKey: "toolkitObservability",
            slug: "toolkit-observability",
          },
        ],
      },
      {
        id: "toolkit-app-chrome",
        labelKey: "appChrome",
        children: [
          {
            id: "toolkit-settings",
            labelKey: "toolkitSettings",
            slug: "toolkit-settings",
          },
          {
            id: "toolkit-org-team",
            labelKey: "toolkitOrgTeam",
            slug: "toolkit-org-team",
          },
          {
            id: "toolkit-setup-connections",
            labelKey: "toolkitSetupConnections",
            slug: "toolkit-setup-connections",
          },
          {
            id: "toolkit-command-navigation",
            labelKey: "toolkitCommandNavigation",
            slug: "toolkit-command-navigation",
          },
          {
            id: "toolkit-resources",
            labelKey: "toolkitResources",
            slug: "toolkit-resources",
          },
          {
            id: "toolkit-agent-ux",
            labelKey: "toolkitAgentUx",
            slug: "toolkit-agent-ux",
          },
        ],
      },
      {
        id: "toolkit-capability-packages",
        labelKey: "capabilityPackages",
        children: [
          {
            id: "toolkit-capability-packages-overview",
            labelKey: "capabilityPackagesOverview",
            slug: "toolkit-capability-packages",
          },
          {
            id: "package-lifecycle",
            labelKey: "packageLifecycle",
            slug: "package-lifecycle",
          },
        ],
      },
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

const SHOW_DRAFTS = import.meta.env.VITE_SHOW_DRAFTS === "true";

function toNavItem(
  config: NavItemConfig,
  locale: DocsLocale,
  t: Translate,
): NavItem | null {
  if (config.draft && !SHOW_DRAFTS) return null;
  const slug = config.slug;
  const children = config.children
    ?.map((child) => toNavItem(child, locale, t))
    .filter((item): item is NavItem => item !== null);
  return {
    id: config.id,
    label: navLabel(t, config.labelKey),
    to: slug ? docsPathForSlug(slug, locale) : undefined,
    draft: config.draft || undefined,
    children,
  };
}

export function getDocsNavSections(
  locale: DocsLocale = DEFAULT_DOCS_LOCALE,
  t: Translate = enMessage,
): NavSection[] {
  return NAV_SECTION_CONFIG.map((section) => ({
    id: section.id,
    title: navLabel(t, section.titleKey),
    items: section.items
      .map((item) => toNavItem(item, locale, t))
      .filter((item): item is NavItem => item !== null),
  })).filter((section) => section.items.length > 0);
}

// Flat list for prev/next navigation and current-item lookups. Nested
// children (e.g. the plan docs under the Plans group, or the Toolkit
// "Feature Kits" / "App Chrome" groups) are flattened in place where their
// parent sits; chevron-only group headers (no `to`) are skipped so reading
// order stays intuitive and prev/next only lands on real pages.
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
