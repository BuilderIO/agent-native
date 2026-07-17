import {
  normalizeMcpIntegrationsConfig,
  type McpIntegrationsConfigInput,
  type NormalizedMcpIntegrationsConfig,
} from "../../shared/mcp-integration-config.js";

export type McpIntegrationAuthMode = "none" | "headers" | "oauth";
export type McpIntegrationConnectionMode =
  | "direct"
  | "headers"
  | "oauth"
  | "manual";
export type McpIntegrationAvailability =
  | "ready"
  | "beta"
  | "provider-setup"
  | "client-restricted";

declare const __AGENT_NATIVE_MCP_INTEGRATIONS_CONFIG__:
  | NormalizedMcpIntegrationsConfig
  | undefined;

export interface DefaultMcpIntegration {
  id: string;
  name: string;
  provider: string;
  description: string;
  descriptionKey: string;
  useCase: string;
  useCaseKey: string;
  url: string;
  authMode: McpIntegrationAuthMode;
  connectionMode: McpIntegrationConnectionMode;
  availability: McpIntegrationAvailability;
  logoUrl: string;
  docsUrl?: string;
  setupNoteKey?: string;
  headerPlaceholder?: string;
  keywords: string[];
}

function simpleIcon(slug: string): string {
  return `https://cdn.simpleicons.org/${slug}`;
}

export interface McpIntegrationFormDefaults {
  name: string;
  url: string;
  description: string;
  headersText: string;
}

export interface McpOAuthStartParams {
  name: string;
  url: string;
  description: string;
  scope: "user" | "org";
  returnUrl: string;
}

export const DEFAULT_MCP_INTEGRATIONS: DefaultMcpIntegration[] = [
  {
    id: "context7",
    name: "Context7",
    provider: "context7",
    description: "Fetch current library docs in agent chats.",
    descriptionKey: "mcpIntegrations.catalog.context7.description",
    useCase: "documentation, technical reference, API docs, framework guides",
    useCaseKey: "mcpIntegrations.catalog.context7.useCase",
    url: "https://mcp.context7.com/mcp",
    authMode: "none",
    connectionMode: "direct",
    availability: "ready",
    logoUrl: "https://context7.com/favicon.ico",
    docsUrl: "https://context7.com/",
    keywords: ["docs", "documentation", "libraries", "frameworks"],
  },
  {
    id: "sentry",
    name: "Sentry",
    provider: "sentry",
    description: "Inspect issues, events, and debugging data.",
    descriptionKey: "mcpIntegrations.catalog.sentry.description",
    useCase: "error monitoring, debugging, performance, crash reports",
    useCaseKey: "mcpIntegrations.catalog.sentry.useCase",
    url: "https://mcp.sentry.dev/mcp",
    authMode: "headers",
    connectionMode: "headers",
    availability: "ready",
    logoUrl: simpleIcon("sentry"),
    docsUrl: "https://docs.sentry.io/product/sentry-mcp/",
    headerPlaceholder: "Authorization: Bearer <sentry-token>",
    keywords: ["errors", "monitoring", "debugging", "issues"],
  },
  {
    id: "notion",
    name: "Notion",
    provider: "notion",
    description: "Search pages and team knowledge.",
    descriptionKey: "mcpIntegrations.catalog.notion.description",
    useCase: "documentation, knowledge management, notes, content creation",
    useCaseKey: "mcpIntegrations.catalog.notion.useCase",
    url: "https://mcp.notion.com/sse",
    authMode: "oauth",
    connectionMode: "oauth",
    availability: "ready",
    logoUrl: simpleIcon("notion"),
    docsUrl: "https://developers.notion.com/docs/mcp",
    keywords: ["docs", "knowledge", "notes", "pages"],
  },
  {
    id: "semgrep",
    name: "Semgrep",
    provider: "semgrep",
    description: "Scan code for security findings.",
    descriptionKey: "mcpIntegrations.catalog.semgrep.description",
    useCase: "security scanning, vulnerability detection, code analysis",
    useCaseKey: "mcpIntegrations.catalog.semgrep.useCase",
    url: "https://mcp.semgrep.ai/mcp",
    authMode: "none",
    connectionMode: "direct",
    availability: "ready",
    logoUrl: "https://semgrep.dev/favicon.ico",
    docsUrl: "https://github.com/semgrep/mcp#readme",
    keywords: ["security", "sast", "code scanning", "vulnerabilities"],
  },
  {
    id: "linear",
    name: "Linear",
    provider: "linear",
    description: "Read and write Linear issues.",
    descriptionKey: "mcpIntegrations.catalog.linear.description",
    useCase: "project management, issue tracking, planning, bug reports",
    useCaseKey: "mcpIntegrations.catalog.linear.useCase",
    url: "https://mcp.linear.app/mcp",
    authMode: "oauth",
    connectionMode: "oauth",
    availability: "ready",
    logoUrl: simpleIcon("linear"),
    docsUrl: "https://linear.app/docs/mcp",
    keywords: ["issues", "tickets", "planning", "project management"],
  },
  {
    id: "atlassian",
    name: "Atlassian",
    provider: "atlassian",
    description: "Read and write Jira issues and Confluence content.",
    descriptionKey: "mcpIntegrations.catalog.atlassian.description",
    useCase:
      "project management, issue tracking, documentation, team collaboration",
    useCaseKey: "mcpIntegrations.catalog.atlassian.useCase",
    url: "https://mcp.atlassian.com/v1/mcp/authv2",
    authMode: "oauth",
    connectionMode: "oauth",
    availability: "provider-setup",
    logoUrl: simpleIcon("atlassian"),
    docsUrl:
      "https://developer.atlassian.com/cloud/rovo-mcp/guides/getting-started/",
    setupNoteKey: "mcpIntegrations.catalog.atlassian.setupNote",
    keywords: ["atlassian", "jira", "confluence", "issues", "tickets"],
  },
  {
    id: "supabase",
    name: "Supabase",
    provider: "supabase",
    description: "Manage data, auth, and backend services.",
    descriptionKey: "mcpIntegrations.catalog.supabase.description",
    useCase: "database, authentication, storage, edge functions",
    useCaseKey: "mcpIntegrations.catalog.supabase.useCase",
    url: "https://mcp.supabase.com/mcp",
    authMode: "oauth",
    connectionMode: "oauth",
    availability: "ready",
    logoUrl: simpleIcon("supabase"),
    docsUrl: "https://www.builder.io/c/docs/fusion-connect-to-supabase",
    keywords: ["database", "auth", "postgres", "storage"],
  },
  {
    id: "neon",
    name: "Neon",
    provider: "neon",
    description: "Work with serverless Postgres projects.",
    descriptionKey: "mcpIntegrations.catalog.neon.description",
    useCase: "database management, serverless postgres, data storage",
    useCaseKey: "mcpIntegrations.catalog.neon.useCase",
    url: "https://mcp.neon.tech/sse",
    authMode: "oauth",
    connectionMode: "oauth",
    availability: "ready",
    logoUrl: simpleIcon("neon"),
    docsUrl: "https://www.builder.io/c/docs/fusion-connect-to-neon",
    keywords: ["database", "postgres", "serverless", "backend"],
  },
  {
    id: "stripe",
    name: "Stripe",
    provider: "stripe",
    description: "Manage payments, subscriptions, and customers.",
    descriptionKey: "mcpIntegrations.catalog.stripe.description",
    useCase: "payments, subscriptions, invoicing, customer management",
    useCaseKey: "mcpIntegrations.catalog.stripe.useCase",
    url: "https://mcp.stripe.com",
    authMode: "oauth",
    connectionMode: "oauth",
    availability: "ready",
    logoUrl: simpleIcon("stripe"),
    docsUrl: "https://docs.stripe.com/mcp",
    keywords: ["payments", "billing", "subscriptions", "customers"],
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    provider: "cloudflare",
    description: "Search and operate Cloudflare services through MCP.",
    descriptionKey: "mcpIntegrations.catalog.cloudflare.description",
    useCase: "DNS, Workers, domains, security, observability, platform APIs",
    useCaseKey: "mcpIntegrations.catalog.cloudflare.useCase",
    url: "https://mcp.cloudflare.com/mcp",
    authMode: "oauth",
    connectionMode: "oauth",
    availability: "ready",
    logoUrl: simpleIcon("cloudflare"),
    docsUrl:
      "https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/",
    setupNoteKey: "mcpIntegrations.catalog.cloudflare.setupNote",
    keywords: ["cloud", "workers", "dns", "security", "observability"],
  },
  {
    id: "gitlab",
    name: "GitLab",
    provider: "gitlab",
    description: "Read and manage GitLab projects, issues, and merge requests.",
    descriptionKey: "mcpIntegrations.catalog.gitlab.description",
    useCase: "repositories, issues, merge requests, CI/CD, code analytics",
    useCaseKey: "mcpIntegrations.catalog.gitlab.useCase",
    url: "https://gitlab.com/api/v4/mcp",
    authMode: "oauth",
    connectionMode: "oauth",
    availability: "beta",
    logoUrl: simpleIcon("gitlab"),
    docsUrl: "https://docs.gitlab.com/user/model_context_protocol/mcp_server/",
    setupNoteKey: "mcpIntegrations.catalog.gitlab.setupNote",
    keywords: ["git", "repositories", "issues", "merge requests", "ci"],
  },
  {
    id: "figma",
    name: "Figma",
    provider: "figma",
    description: "Bring Figma design context and canvas actions into an agent.",
    descriptionKey: "mcpIntegrations.catalog.figma.description",
    useCase: "design files, components, variables, design systems, canvas",
    useCaseKey: "mcpIntegrations.catalog.figma.useCase",
    url: "https://mcp.figma.com/mcp",
    authMode: "oauth",
    connectionMode: "manual",
    availability: "client-restricted",
    logoUrl: simpleIcon("figma"),
    docsUrl: "https://developers.figma.com/docs/figma-mcp-server/",
    setupNoteKey: "mcpIntegrations.catalog.figma.setupNote",
    keywords: ["design", "figjam", "components", "variables", "canvas"],
  },
  {
    id: "vercel",
    name: "Vercel",
    provider: "vercel",
    description:
      "Search Vercel docs and inspect projects, deployments, and logs.",
    descriptionKey: "mcpIntegrations.catalog.vercel.description",
    useCase: "deployments, projects, logs, domains, hosting, documentation",
    useCaseKey: "mcpIntegrations.catalog.vercel.useCase",
    url: "https://mcp.vercel.com",
    authMode: "oauth",
    connectionMode: "manual",
    availability: "client-restricted",
    logoUrl: simpleIcon("vercel"),
    docsUrl: "https://vercel.com/docs/agent-resources/vercel-mcp",
    setupNoteKey: "mcpIntegrations.catalog.vercel.setupNote",
    keywords: ["deployments", "hosting", "projects", "logs", "domains"],
  },
  {
    id: "github",
    name: "GitHub",
    provider: "github",
    description: "Read repositories, issues, pull requests, and code context.",
    descriptionKey: "mcpIntegrations.catalog.github.description",
    useCase: "repositories, issues, pull requests, code, engineering analytics",
    useCaseKey: "mcpIntegrations.catalog.github.useCase",
    url: "https://api.githubcopilot.com/mcp/",
    authMode: "oauth",
    connectionMode: "manual",
    availability: "client-restricted",
    logoUrl: simpleIcon("github"),
    docsUrl: "https://github.com/github/github-mcp-server",
    setupNoteKey: "mcpIntegrations.catalog.github.setupNote",
    keywords: ["git", "repositories", "issues", "pull requests", "code"],
  },
  {
    id: "slack",
    name: "Slack",
    provider: "slack",
    description:
      "Search Slack conversations and take workspace actions through MCP.",
    descriptionKey: "mcpIntegrations.catalog.slack.description",
    useCase: "messages, channels, people, company memory, workflows",
    useCaseKey: "mcpIntegrations.catalog.slack.useCase",
    url: "https://mcp.slack.com/mcp",
    authMode: "oauth",
    connectionMode: "manual",
    availability: "client-restricted",
    logoUrl: "https://slack.com/favicon.ico",
    docsUrl: "https://docs.slack.dev/ai/slack-mcp-server/",
    setupNoteKey: "mcpIntegrations.catalog.slack.setupNote",
    keywords: ["messages", "channels", "search", "people", "chat"],
  },
  {
    id: "asana",
    name: "Asana",
    provider: "asana",
    description:
      "Search and manage Asana tasks, projects, and work graph data.",
    descriptionKey: "mcpIntegrations.catalog.asana.description",
    useCase: "tasks, projects, portfolios, planning, workload",
    useCaseKey: "mcpIntegrations.catalog.asana.useCase",
    url: "https://mcp.asana.com/v2/mcp",
    authMode: "oauth",
    connectionMode: "manual",
    availability: "provider-setup",
    logoUrl: simpleIcon("asana"),
    docsUrl:
      "https://developers.asana.com/docs/integrating-with-asanas-mcp-server",
    setupNoteKey: "mcpIntegrations.catalog.asana.setupNote",
    keywords: ["tasks", "projects", "planning", "workload", "portfolios"],
  },
  {
    id: "hubspot",
    name: "HubSpot",
    provider: "hubspot",
    description: "Search and update HubSpot CRM records through MCP.",
    descriptionKey: "mcpIntegrations.catalog.hubspot.description",
    useCase: "CRM, contacts, companies, deals, tickets, customer analytics",
    useCaseKey: "mcpIntegrations.catalog.hubspot.useCase",
    url: "https://mcp.hubspot.com",
    authMode: "oauth",
    connectionMode: "manual",
    availability: "provider-setup",
    logoUrl: simpleIcon("hubspot"),
    docsUrl:
      "https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server",
    setupNoteKey: "mcpIntegrations.catalog.hubspot.setupNote",
    keywords: ["crm", "contacts", "companies", "deals", "tickets"],
  },
];

function readRuntimeMcpIntegrationsConfig(): NormalizedMcpIntegrationsConfig {
  try {
    if (typeof __AGENT_NATIVE_MCP_INTEGRATIONS_CONFIG__ !== "undefined") {
      return normalizeMcpIntegrationsConfig(
        __AGENT_NATIVE_MCP_INTEGRATIONS_CONFIG__,
      );
    }
  } catch {
    // Test and non-Vite contexts may not define the compile-time constant.
  }
  return normalizeMcpIntegrationsConfig();
}

function normalizePresetConfig(
  config?: McpIntegrationsConfigInput | NormalizedMcpIntegrationsConfig,
): NormalizedMcpIntegrationsConfig {
  if (config === undefined) return readRuntimeMcpIntegrationsConfig();
  return normalizeMcpIntegrationsConfig(config);
}

export function getDefaultMcpIntegrations(
  config?: McpIntegrationsConfigInput | NormalizedMcpIntegrationsConfig,
): DefaultMcpIntegration[] {
  const normalized = normalizePresetConfig(config);
  if (!normalized.enabled || !normalized.defaults.enabled) return [];

  const include = normalized.defaults.include
    ? new Set(normalized.defaults.include)
    : null;
  const exclude = new Set(normalized.defaults.exclude);
  return DEFAULT_MCP_INTEGRATIONS.filter((integration) => {
    const id = integration.id.toLowerCase();
    if (include && !include.has(id)) return false;
    return !exclude.has(id);
  });
}

export function isCustomMcpIntegrationEnabled(
  config?: McpIntegrationsConfigInput | NormalizedMcpIntegrationsConfig,
): boolean {
  const normalized = normalizePresetConfig(config);
  return normalized.enabled && normalized.custom;
}

export function isMcpIntegrationCatalogAvailable(
  config?: McpIntegrationsConfigInput | NormalizedMcpIntegrationsConfig,
): boolean {
  const normalized = normalizePresetConfig(config);
  if (!normalized.enabled) return false;
  return normalized.custom || getDefaultMcpIntegrations(normalized).length > 0;
}

export function mcpIntegrationAuthLabel(mode: McpIntegrationAuthMode): string {
  if (mode === "none") return "No auth";
  if (mode === "headers") return "Header";
  return "OAuth";
}

export function buildMcpOAuthStartUrl({
  name,
  url,
  description,
  scope,
  returnUrl,
}: McpOAuthStartParams): string {
  const params = new URLSearchParams({
    name,
    url,
    description,
    scope,
    return: returnUrl,
  });
  return `/_agent-native/mcp/servers/oauth/start?${params.toString()}`;
}

export function resolveMcpIntegrationScope(
  defaultScope: "user" | "org",
  hasOrg: boolean,
  canCreateOrgMcp: boolean,
): "user" | "org" {
  return defaultScope === "org" && hasOrg && canCreateOrgMcp ? "org" : "user";
}

export function filterMcpIntegrations(
  query: string,
  integrations: DefaultMcpIntegration[] = getDefaultMcpIntegrations(),
): DefaultMcpIntegration[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return integrations;
  return integrations.filter((integration) => {
    const haystack = [
      integration.name,
      integration.provider,
      integration.description,
      integration.useCase,
      integration.url,
      ...integration.keywords,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export function createMcpIntegrationFormDefaults(
  integration?: DefaultMcpIntegration | null,
): McpIntegrationFormDefaults {
  if (!integration) {
    return {
      name: "",
      url: "",
      description: "",
      headersText: "",
    };
  }
  return {
    name: integration.name,
    url: integration.url,
    description: integration.description,
    headersText: "",
  };
}
