import {
  normalizeMcpIntegrationsConfig,
  type McpIntegrationsConfigInput,
  type NormalizedMcpIntegrationsConfig,
} from "../../shared/mcp-integration-config.js";
import { mcpIntegrationLogo } from "./mcp-integration-logos.js";

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
export type McpIntegrationVerification =
  | "verified"
  | "preflight-only"
  | "restricted";

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
  verification: McpIntegrationVerification;
  logoUrl: string;
  docsUrl?: string;
  setupNoteKey?: string;
  headerPlaceholder?: string;
  keywords: string[];
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
    verification: "verified",
    logoUrl: mcpIntegrationLogo("context7"),
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
    verification: "preflight-only",
    logoUrl: mcpIntegrationLogo("sentry"),
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
    url: "https://mcp.notion.com/mcp",
    authMode: "oauth",
    connectionMode: "oauth",
    availability: "ready",
    verification: "preflight-only",
    logoUrl: mcpIntegrationLogo("notion"),
    docsUrl: "https://developers.notion.com/guides/mcp/get-started-with-mcp",
    setupNoteKey: "mcpIntegrations.catalog.notion.setupNote",
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
    verification: "preflight-only",
    logoUrl: mcpIntegrationLogo("semgrep"),
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
    verification: "preflight-only",
    logoUrl: mcpIntegrationLogo("linear"),
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
    verification: "restricted",
    logoUrl: mcpIntegrationLogo("atlassian"),
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
    verification: "preflight-only",
    logoUrl: mcpIntegrationLogo("supabase"),
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
    verification: "preflight-only",
    logoUrl: mcpIntegrationLogo("neon"),
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
    verification: "preflight-only",
    logoUrl: mcpIntegrationLogo("stripe"),
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
    verification: "preflight-only",
    logoUrl: mcpIntegrationLogo("cloudflare"),
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
    verification: "restricted",
    logoUrl: mcpIntegrationLogo("gitlab"),
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
    verification: "restricted",
    logoUrl: mcpIntegrationLogo("figma"),
    docsUrl: "https://developers.figma.com/docs/figma-mcp-server/",
    setupNoteKey: "mcpIntegrations.catalog.figma.setupNote",
    keywords: ["design", "figjam", "components", "variables", "canvas"],
  },
  {
    id: "canva",
    name: "Canva",
    provider: "canva",
    description: "Search, create, and update Canva designs and assets.",
    descriptionKey: "mcpIntegrations.catalog.canva.description",
    useCase: "designs, templates, assets, brand kits, exports, collaboration",
    useCaseKey: "mcpIntegrations.catalog.canva.useCase",
    url: "https://mcp.canva.com/mcp",
    authMode: "oauth",
    connectionMode: "manual",
    availability: "client-restricted",
    verification: "restricted",
    logoUrl: mcpIntegrationLogo("canva"),
    docsUrl: "https://www.canva.dev/docs/mcp/",
    setupNoteKey: "mcpIntegrations.catalog.canva.setupNote",
    keywords: ["design", "templates", "assets", "brand", "exports"],
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
    verification: "restricted",
    logoUrl: mcpIntegrationLogo("vercel"),
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
    availability: "provider-setup",
    verification: "restricted",
    logoUrl: mcpIntegrationLogo("github"),
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
    verification: "restricted",
    logoUrl: mcpIntegrationLogo("slack"),
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
    verification: "restricted",
    logoUrl: mcpIntegrationLogo("asana"),
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
    verification: "restricted",
    logoUrl: mcpIntegrationLogo("hubspot"),
    docsUrl:
      "https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server",
    setupNoteKey: "mcpIntegrations.catalog.hubspot.setupNote",
    keywords: ["crm", "contacts", "companies", "deals", "tickets"],
  },
  {
    id: "intercom",
    name: "Intercom",
    provider: "intercom",
    description: "Search conversations and customer support knowledge.",
    descriptionKey: "mcpIntegrations.catalog.intercom.description",
    useCase: "customer support, conversations, contacts, help center content",
    useCaseKey: "mcpIntegrations.catalog.intercom.useCase",
    url: "https://mcp.intercom.com/mcp",
    authMode: "oauth",
    connectionMode: "oauth",
    availability: "ready",
    verification: "preflight-only",
    logoUrl: mcpIntegrationLogo("intercom"),
    docsUrl: "https://developers.intercom.com/docs/guides/mcp",
    setupNoteKey: "mcpIntegrations.catalog.intercom.setupNote",
    keywords: ["support", "conversations", "customers", "help center"],
  },
  {
    id: "monday",
    name: "monday.com",
    provider: "monday",
    description: "Work with boards, items, and team workflows.",
    descriptionKey: "mcpIntegrations.catalog.monday.description",
    useCase: "work management, boards, projects, tasks, team operations",
    useCaseKey: "mcpIntegrations.catalog.monday.useCase",
    url: "https://mcp.monday.com/mcp",
    authMode: "oauth",
    connectionMode: "oauth",
    availability: "ready",
    verification: "preflight-only",
    logoUrl: mcpIntegrationLogo("monday"),
    docsUrl:
      "https://developer.monday.com/api-reference/docs/build-on-monday-with-ai",
    setupNoteKey: "mcpIntegrations.catalog.monday.setupNote",
    keywords: ["work management", "boards", "projects", "tasks", "teams"],
  },
  {
    id: "webflow",
    name: "Webflow",
    provider: "webflow",
    description: "Read and update Webflow sites and content.",
    descriptionKey: "mcpIntegrations.catalog.webflow.description",
    useCase: "websites, CMS, site content, publishing, design workflows",
    useCaseKey: "mcpIntegrations.catalog.webflow.useCase",
    url: "https://mcp.webflow.com/mcp",
    authMode: "oauth",
    connectionMode: "oauth",
    availability: "ready",
    verification: "preflight-only",
    logoUrl: mcpIntegrationLogo("webflow"),
    docsUrl: "https://developers.webflow.com/mcp/reference/getting-started",
    setupNoteKey: "mcpIntegrations.catalog.webflow.setupNote",
    keywords: ["websites", "cms", "content", "publishing", "design"],
  },
  {
    id: "paypal",
    name: "PayPal",
    provider: "paypal",
    description: "Work with PayPal payments, invoices, and commerce data.",
    descriptionKey: "mcpIntegrations.catalog.paypal.description",
    useCase: "payments, invoices, transactions, merchant operations",
    useCaseKey: "mcpIntegrations.catalog.paypal.useCase",
    url: "https://mcp.paypal.com/sse",
    authMode: "oauth",
    connectionMode: "oauth",
    availability: "ready",
    verification: "preflight-only",
    logoUrl: mcpIntegrationLogo("paypal"),
    docsUrl: "https://developer.paypal.com/ai-tools/mcp-server/",
    setupNoteKey: "mcpIntegrations.catalog.paypal.setupNote",
    keywords: ["payments", "invoices", "transactions", "commerce"],
  },
  {
    id: "box",
    name: "Box",
    provider: "box",
    description: "Search and manage files and folders in Box.",
    descriptionKey: "mcpIntegrations.catalog.box.description",
    useCase: "files, folders, enterprise content, search, collaboration",
    useCaseKey: "mcpIntegrations.catalog.box.useCase",
    url: "https://mcp.box.com",
    authMode: "oauth",
    connectionMode: "manual",
    availability: "provider-setup",
    verification: "restricted",
    logoUrl: mcpIntegrationLogo("box"),
    docsUrl: "https://developer.box.com/guides/box-mcp",
    setupNoteKey: "mcpIntegrations.catalog.box.setupNote",
    keywords: ["files", "folders", "documents", "enterprise content"],
  },
  {
    id: "netlify",
    name: "Netlify",
    provider: "netlify",
    description: "Inspect and operate Netlify sites and deployments.",
    descriptionKey: "mcpIntegrations.catalog.netlify.description",
    useCase: "sites, deployments, builds, domains, hosting operations",
    useCaseKey: "mcpIntegrations.catalog.netlify.useCase",
    url: "https://netlify-mcp.netlify.app/mcp",
    authMode: "oauth",
    connectionMode: "oauth",
    availability: "ready",
    verification: "preflight-only",
    logoUrl: mcpIntegrationLogo("netlify"),
    docsUrl:
      "https://docs.netlify.com/build/build-with-ai/agent-setup-guides/agent-setup-overview/",
    setupNoteKey: "mcpIntegrations.catalog.netlify.setupNote",
    keywords: ["deployments", "builds", "sites", "hosting", "domains"],
  },
  {
    id: "zapier",
    name: "Zapier",
    provider: "zapier",
    description: "Connect MCP tools to thousands of app actions.",
    descriptionKey: "mcpIntegrations.catalog.zapier.description",
    useCase: "automation, workflows, app actions, cross-service operations",
    useCaseKey: "mcpIntegrations.catalog.zapier.useCase",
    url: "https://mcp.zapier.com/api/v1/connect",
    authMode: "headers",
    connectionMode: "headers",
    availability: "ready",
    verification: "restricted",
    logoUrl: mcpIntegrationLogo("zapier"),
    docsUrl:
      "https://help.zapier.com/hc/en-us/articles/36265392843917-Use-Zapier-MCP-with-your-client",
    setupNoteKey: "mcpIntegrations.catalog.zapier.setupNote",
    headerPlaceholder: "Authorization: Bearer <zapier-mcp-token>",
    keywords: ["automation", "workflows", "actions", "apps", "integrations"],
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

const MCP_LINK_HOSTS: Record<string, string[]> = {
  notion: ["notion.so", "notion.site"],
  canva: ["canva.com", "canva.ai"],
  figma: ["figma.com"],
  linear: ["linear.app"],
  github: ["github.com", "github.dev"],
  gitlab: ["gitlab.com"],
  slack: ["slack.com"],
  asana: ["asana.com"],
  hubspot: ["hubspot.com"],
  intercom: ["intercom.com"],
  monday: ["monday.com"],
  webflow: ["webflow.com"],
  paypal: ["paypal.com"],
  box: ["box.com"],
  netlify: ["netlify.com"],
};

function hostMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function findUrlForText(text: string): URL | null {
  const candidates = text.match(/https?:\/\/[^\s<>()[\]{}]+/gi) ?? [];
  for (const candidate of candidates) {
    try {
      return new URL(candidate.replace(/[.,!?;:'\"]+$/, ""));
    } catch {
      // Ignore prose that only looks like a URL.
    }
  }
  return null;
}

const MCP_RESOURCE_INTENT_PATTERN =
  /\b(?:connect|connected|connection|integration|integrate|link|page|document|doc|file|workspace|project|issue|design|board|channel|message|ticket|read|access|open|see|fetch|sync|import)\b/i;

export function findMcpIntegrationForText(
  text: string,
  integrations: DefaultMcpIntegration[] = getDefaultMcpIntegrations(),
): DefaultMcpIntegration | null {
  const url = findUrlForText(text);
  if (url) {
    const match = integrations.find((integration) =>
      (MCP_LINK_HOSTS[integration.id] ?? []).some((domain) =>
        hostMatches(url.hostname.toLowerCase(), domain),
      ),
    );
    if (match) return match;
  }

  const normalizedText = text.toLowerCase();
  const hasResourceIntent =
    MCP_RESOURCE_INTENT_PATTERN.test(normalizedText) ||
    isMcpConnectionFailureText(normalizedText);
  if (!hasResourceIntent) return null;
  return (
    integrations.find((integration) => {
      const aliases = [integration.name, integration.provider, integration.id];
      return aliases.some((alias) => {
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(
          normalizedText,
        );
      });
    }) ?? null
  );
}

export function isMcpConnectionFailureText(text: string): boolean {
  return /\b(?:can(?:not|'t|’t)|could(?: not|n't|n’t)|unable|failed|don't have access|don’t have access|not connected|not able)\b[\s\S]{0,80}\b(?:read|access|open|see|fetch|connect)\b/i.test(
    text,
  );
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
