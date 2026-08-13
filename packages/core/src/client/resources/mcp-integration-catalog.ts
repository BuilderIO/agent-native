import {
  normalizeMcpIntegrationsConfig,
  type McpIntegrationsConfigInput,
  type NormalizedMcpIntegrationsConfig,
} from "../../shared/mcp-integration-config.js";
import { mergeDefinitionsById } from "../../shared/merge-by-id.js";
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
declare const __AGENT_NATIVE_TEMPLATE__: string | undefined;

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
  /**
   * The server has a first-party OAuth client configured for this provider.
   * Keep the connection user-scoped even when the client itself is shared.
   */
  managedOAuth?: boolean;
  /**
   * The provider supports a workspace connection whose access can be shared
   * with permitted workspace members. Keep this opt-in until provider scope
   * semantics are verified.
   */
  supportsOrganizationScope?: boolean;
  docsUrl?: string;
  setupNoteKey?: string;
  apiFallback?: {
    secretKey: string;
    docsUrl: string;
    templateUses?: readonly string[];
  };
  headerPlaceholder?: string;
  brandAliases?: string[];
  aliases?: string[];
  keywords: string[];
  /**
   * Overrides `name` for prose intent matching in `findMcpIntegrationForText`
   * when the display name is a common English word (e.g. "Box") that would
   * otherwise false-positive on unrelated text. Leave unset unless the name
   * itself is the ambiguous term; `brandAliases` still apply.
   */
  promptAliases?: string[];
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
    supportsOrganizationScope: true,
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
    id: "fullstory",
    name: "FullStory",
    provider: "fullstory",
    description: "Read behavioral analytics and inspect session replays.",
    descriptionKey: "mcpIntegrations.catalog.fullstory.description",
    useCase:
      "product analytics, session replay, qualitative behavior, user research",
    useCaseKey: "mcpIntegrations.catalog.fullstory.useCase",
    url: "https://api.fullstory.com/mcp/fullstory",
    authMode: "oauth",
    connectionMode: "oauth",
    availability: "ready",
    verification: "preflight-only",
    logoUrl: mcpIntegrationLogo("fullstory"),
    docsUrl: "https://developer.fullstory.com/mcp/introduction/",
    setupNoteKey: "mcpIntegrations.catalog.fullstory.setupNote",
    keywords: [
      "product analytics",
      "session replay",
      "behavior",
      "user research",
      "sessions",
      "prompts",
      "screenshots",
    ],
  },
  {
    id: "amplitude",
    name: "Amplitude",
    provider: "amplitude",
    description: "Read and work with Amplitude product analytics.",
    descriptionKey: "mcpIntegrations.catalog.amplitude.description",
    useCase: "product analytics, charts, dashboards, cohorts, experiments",
    useCaseKey: "mcpIntegrations.catalog.amplitude.useCase",
    url: "https://mcp.amplitude.com/mcp",
    authMode: "oauth",
    connectionMode: "oauth",
    availability: "ready",
    verification: "preflight-only",
    logoUrl: mcpIntegrationLogo("amplitude"),
    docsUrl:
      "https://amplitude.com/docs/amplitude-ai/amplitude-mcp/other-clients",
    setupNoteKey: "mcpIntegrations.catalog.amplitude.setupNote",
    keywords: [
      "analytics",
      "product analytics",
      "charts",
      "dashboards",
      "cohorts",
      "experiments",
    ],
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
    id: "granola",
    name: "Granola",
    provider: "granola",
    description: "Search meeting notes, transcripts, and action items.",
    descriptionKey: "mcpIntegrations.catalog.granola.description",
    useCase: "meeting notes, recordings, transcripts, action items, follow-ups",
    useCaseKey: "mcpIntegrations.catalog.granola.useCase",
    url: "https://mcp.granola.ai/mcp",
    authMode: "oauth",
    connectionMode: "oauth",
    availability: "ready",
    verification: "preflight-only",
    logoUrl: mcpIntegrationLogo("granola"),
    docsUrl: "https://docs.granola.ai/help-center/sharing/integrations/mcp",
    setupNoteKey: "mcpIntegrations.catalog.granola.setupNote",
    keywords: [
      "meetings",
      "meeting notes",
      "recordings",
      "transcripts",
      "action items",
      "follow-ups",
      "decisions",
    ],
  },
  {
    id: "gong",
    name: "Gong",
    provider: "gong",
    description: "Search Gong calls and generate account and deal insights.",
    descriptionKey: "mcpIntegrations.catalog.gong.description",
    useCase: "sales calls, transcripts, deal insights, account summaries",
    useCaseKey: "mcpIntegrations.catalog.gong.useCase",
    url: "https://mcp.gong.io/mcp",
    authMode: "oauth",
    connectionMode: "manual",
    availability: "provider-setup",
    verification: "restricted",
    logoUrl: mcpIntegrationLogo("gong"),
    supportsOrganizationScope: true,
    docsUrl:
      "https://help.gong.io/docs/create-an-integration-to-connect-to-the-mcp-server",
    setupNoteKey: "mcpIntegrations.catalog.gong.setupNote",
    keywords: [
      "sales calls",
      "calls",
      "transcripts",
      "deals",
      "accounts",
      "revenue intelligence",
    ],
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
    supportsOrganizationScope: true,
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
    id: "apollo",
    name: "Apollo",
    provider: "apollo",
    description: "Search, enrich, and manage Apollo GTM data.",
    descriptionKey: "mcpIntegrations.catalog.apollo.description",
    useCase: "prospecting, enrichment, contacts, sequences, account research",
    useCaseKey: "mcpIntegrations.catalog.apollo.useCase",
    url: "https://mcp.apollo.io/mcp",
    authMode: "oauth",
    connectionMode: "oauth",
    availability: "ready",
    verification: "preflight-only",
    logoUrl: mcpIntegrationLogo("apollo"),
    docsUrl: "https://docs.apollo.io/docs/apollo-mcp",
    setupNoteKey: "mcpIntegrations.catalog.apollo.setupNote",
    keywords: [
      "prospecting",
      "enrichment",
      "contacts",
      "sequences",
      "accounts",
      "GTM",
    ],
  },
  {
    id: "common-room",
    name: "Common Room",
    provider: "common-room",
    description: "Research buyer signals, contacts, and organizations.",
    descriptionKey: "mcpIntegrations.catalog.commonRoom.description",
    useCase: "buyer intelligence, product signals, intent, contact enrichment",
    useCaseKey: "mcpIntegrations.catalog.commonRoom.useCase",
    url: "https://mcp.commonroom.io/mcp",
    authMode: "oauth",
    connectionMode: "oauth",
    availability: "ready",
    verification: "preflight-only",
    logoUrl: mcpIntegrationLogo("common-room"),
    docsUrl: "https://www.commonroom.io/docs/using-common-room/mcp-server/",
    setupNoteKey: "mcpIntegrations.catalog.commonRoom.setupNote",
    keywords: [
      "buyer intelligence",
      "intent",
      "signals",
      "contacts",
      "organizations",
      "GTM",
    ],
  },
  {
    id: "exa",
    name: "Exa",
    provider: "exa",
    description: "Search the web and fetch pages with Exa.",
    descriptionKey: "mcpIntegrations.catalog.exa.description",
    useCase: "web search, research, code search, page fetching",
    useCaseKey: "mcpIntegrations.catalog.exa.useCase",
    url: "https://mcp.exa.ai/mcp",
    authMode: "none",
    connectionMode: "direct",
    availability: "ready",
    verification: "preflight-only",
    logoUrl: mcpIntegrationLogo("exa"),
    supportsOrganizationScope: true,
    docsUrl: "https://exa.ai/docs/reference/exa-mcp",
    setupNoteKey: "mcpIntegrations.catalog.exa.setupNote",
    keywords: [
      "web search",
      "research",
      "code search",
      "crawl",
      "fetch",
      "web",
    ],
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
    brandAliases: ["Jira", "Confluence", "Rovo"],
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
    docsUrl:
      "https://www.builder.io/c/docs/fusion-connect-to-supabase?utm_source=agent-native&utm_medium=product&utm_campaign=integrations&utm_content=fusion_connect_supabase",
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
    docsUrl:
      "https://www.builder.io/c/docs/fusion-connect-to-neon?utm_source=agent-native&utm_medium=product&utm_campaign=integrations&utm_content=fusion_connect_neon",
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
    description: "Search and operate Cloudflare services.",
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
    id: "grafana",
    name: "Grafana",
    provider: "grafana",
    description: "Query Grafana Cloud metrics, logs, and observability data.",
    descriptionKey: "mcpIntegrations.catalog.grafana.description",
    useCase: "observability, metrics, logs, traces, dashboards",
    useCaseKey: "mcpIntegrations.catalog.grafana.useCase",
    url: "https://mcp.grafana.com/mcp",
    authMode: "oauth",
    connectionMode: "oauth",
    availability: "beta",
    verification: "preflight-only",
    logoUrl: mcpIntegrationLogo("grafana"),
    docsUrl:
      "https://grafana.com/docs/grafana-cloud/ai-tools/mcp-servers/cloud-mcp/",
    setupNoteKey: "mcpIntegrations.catalog.grafana.setupNote",
    keywords: [
      "observability",
      "metrics",
      "logs",
      "traces",
      "dashboards",
      "Grafana Cloud",
    ],
  },
  {
    id: "google-workspace",
    name: "Google Workspace",
    provider: "google-workspace",
    description: "Search Google Workspace data through its remote MCP server.",
    descriptionKey: "mcpIntegrations.catalog.googleWorkspace.description",
    useCase:
      "Workspace search across Gmail, Drive, Calendar, Chat, Docs, Sheets, Slides",
    useCaseKey: "mcpIntegrations.catalog.googleWorkspace.useCase",
    url: "https://workspacemcp.googleapis.com/mcp/v1",
    authMode: "oauth",
    connectionMode: "manual",
    availability: "beta",
    verification: "restricted",
    logoUrl: mcpIntegrationLogo("google-workspace"),
    docsUrl:
      "https://developers.google.com/workspace/guides/configure-mcp-servers",
    setupNoteKey: "mcpIntegrations.catalog.googleWorkspace.setupNote",
    brandAliases: ["Google", "Gmail", "Google Drive", "Google Calendar"],
    keywords: [
      "email",
      "gmail",
      "drive",
      "calendar",
      "chat",
      "docs",
      "sheets",
      "slides",
    ],
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
    apiFallback: {
      secretKey: "FIGMA_ACCESS_TOKEN",
      docsUrl:
        "https://developers.figma.com/docs/rest-api/personal-access-tokens/",
      templateUses: ["design"],
    },
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
    description: "Search Slack conversations and take workspace actions.",
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
    description: "Search and update HubSpot CRM records.",
    descriptionKey: "mcpIntegrations.catalog.hubspot.description",
    useCase: "CRM, contacts, companies, deals, tickets, customer analytics",
    useCaseKey: "mcpIntegrations.catalog.hubspot.useCase",
    url: "https://mcp.hubspot.com",
    authMode: "oauth",
    connectionMode: "manual",
    availability: "provider-setup",
    verification: "restricted",
    logoUrl: mcpIntegrationLogo("hubspot"),
    managedOAuth: true,
    docsUrl:
      "https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server",
    setupNoteKey: "mcpIntegrations.catalog.hubspot.setupNote",
    keywords: ["crm", "contacts", "companies", "deals", "tickets"],
  },
  {
    id: "pylon",
    name: "Pylon",
    provider: "pylon",
    description: "Search and update Pylon support data.",
    descriptionKey: "mcpIntegrations.catalog.pylon.description",
    useCase: "customer support, issues, accounts, contacts, conversations",
    useCaseKey: "mcpIntegrations.catalog.pylon.useCase",
    url: "https://mcp.usepylon.com/",
    authMode: "oauth",
    connectionMode: "oauth",
    availability: "provider-setup",
    verification: "restricted",
    logoUrl: mcpIntegrationLogo("pylon"),
    docsUrl: "https://www.usepylon.com/integrations/mcp",
    setupNoteKey: "mcpIntegrations.catalog.pylon.setupNote",
    keywords: [
      "support",
      "issues",
      "accounts",
      "contacts",
      "conversations",
      "customer support",
    ],
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
    // "Box" alone collides with everyday nouns (text box, checkbox, bounding
    // box), so require a qualified phrase before suggesting the connection.
    promptAliases: [
      "Box.com",
      "Box file",
      "Box files",
      "Box folder",
      "Box folders",
      "Box drive",
    ],
  },
  {
    id: "builder-cms",
    name: "Builder.io",
    provider: "builder",
    description: "Search Builder Publish and Hybrid Space content.",
    descriptionKey: "mcpIntegrations.catalog.builder.description",
    useCase: "content models, pages, entries, Publish and Hybrid Spaces",
    useCaseKey: "mcpIntegrations.catalog.builder.useCase",
    url: "https://mcp.builder.io/mcp/publish",
    authMode: "oauth",
    connectionMode: "oauth",
    availability: "ready",
    verification: "preflight-only",
    logoUrl: mcpIntegrationLogo("builder-cms"),
    docsUrl: "https://www.builder.io/c/docs/mcp-builder-server/",
    setupNoteKey: "mcpIntegrations.catalog.builder.setupNote",
    keywords: [
      "Builder",
      "content",
      "CMS",
      "pages",
      "models",
      "Publish",
      "Hybrid",
    ],
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
    description: "Connect tools to thousands of app actions.",
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

function normalizeTemplateName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function getActiveTemplateName(): string | null {
  try {
    const compiledTemplate = normalizeTemplateName(__AGENT_NATIVE_TEMPLATE__);
    if (compiledTemplate) return compiledTemplate;
  } catch {
    // Test and non-Vite contexts may not define the compile-time constant.
  }

  const runtimeConfig = (
    globalThis as typeof globalThis & {
      __AGENT_NATIVE_CONFIG__?: { template?: unknown };
    }
  ).__AGENT_NATIVE_CONFIG__;
  return normalizeTemplateName(runtimeConfig?.template);
}

export function getMcpIntegrationApiFallback(
  integration: DefaultMcpIntegration,
  templateName = getActiveTemplateName(),
): DefaultMcpIntegration["apiFallback"] | null {
  const fallback = integration.apiFallback;
  if (!fallback) return null;
  if (!fallback.templateUses?.length) return fallback;
  if (!templateName) return null;
  return fallback.templateUses.includes(templateName) ? fallback : null;
}

function normalizePresetConfig(
  config?: McpIntegrationsConfigInput | NormalizedMcpIntegrationsConfig,
): NormalizedMcpIntegrationsConfig {
  if (config === undefined) return readRuntimeMcpIntegrationsConfig();
  return normalizeMcpIntegrationsConfig(config);
}

export function getDefaultMcpIntegrations(
  config?: McpIntegrationsConfigInput | NormalizedMcpIntegrationsConfig,
  overrides: readonly DefaultMcpIntegration[] = [],
): DefaultMcpIntegration[] {
  const normalized = normalizePresetConfig(config);
  if (!normalized.enabled || !normalized.defaults.enabled) return [];

  const include = normalized.defaults.include
    ? new Set(normalized.defaults.include)
    : null;
  const exclude = new Set(normalized.defaults.exclude);
  return mergeDefaultMcpIntegrations(overrides).filter((integration) => {
    const id = integration.id.toLowerCase();
    if (include && !include.has(id)) return false;
    return !exclude.has(id);
  });
}

export function mergeDefaultMcpIntegrations(
  overrides: readonly DefaultMcpIntegration[] = [],
): DefaultMcpIntegration[] {
  return mergeDefinitionsById(DEFAULT_MCP_INTEGRATIONS, overrides);
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

export function navigateToMcpOAuthStart(url: string): void {
  if (typeof window === "undefined") return;

  const navigate = () => {
    window.setTimeout(() => window.location.assign(url), 0);
  };
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(navigate);
  } else {
    navigate();
  }
}

export function resolveMcpIntegrationScope(
  defaultScope: "user" | "org",
  hasOrg: boolean,
  canCreateOrgMcp: boolean,
  supportsOrganizationScope = true,
): "user" | "org" {
  return defaultScope === "org" &&
    hasOrg &&
    canCreateOrgMcp &&
    supportsOrganizationScope
    ? "org"
    : "user";
}

export function shouldOfferMcpOrganizationScope(
  hasOrg: boolean,
  canCreateOrgMcp: boolean,
): boolean {
  return hasOrg && canCreateOrgMcp;
}

export function shouldOfferMcpIntegrationOrganizationScope(
  integration: DefaultMcpIntegration,
  hasOrg: boolean,
  canCreateOrgMcp: boolean,
): boolean {
  return (
    shouldOfferMcpOrganizationScope(hasOrg, canCreateOrgMcp) &&
    integration.supportsOrganizationScope === true &&
    integration.managedOAuth !== true
  );
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
      ...(integration.brandAliases ?? []),
      ...(integration.aliases ?? []),
      ...integration.keywords,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

const MCP_LINK_HOSTS: Record<string, string[]> = {
  amplitude: ["amplitude.com"],
  apollo: ["apollo.io"],
  "common-room": ["commonroom.io"],
  context7: ["context7.com"],
  exa: ["exa.ai"],
  sentry: ["sentry.io", "sentry.dev"],
  gong: ["gong.io"],
  grafana: ["grafana.com", "grafana.net"],
  "google-workspace": ["google.com", "googleapis.com"],
  "builder-cms": ["builder.io"],
  notion: ["notion.so", "notion.site"],
  granola: ["granola.ai"],
  semgrep: ["semgrep.dev", "semgrep.com"],
  canva: ["canva.com", "canva.ai"],
  figma: ["figma.com"],
  linear: ["linear.app"],
  atlassian: ["atlassian.com", "atlassian.net", "jira.com", "confluence.com"],
  supabase: ["supabase.com"],
  neon: ["neon.tech"],
  stripe: ["stripe.com"],
  cloudflare: ["cloudflare.com"],
  github: ["github.com", "github.dev"],
  gitlab: ["gitlab.com"],
  slack: ["slack.com"],
  asana: ["asana.com"],
  hubspot: ["hubspot.com"],
  intercom: ["intercom.com"],
  pylon: ["usepylon.com", "pylon.com"],
  monday: ["monday.com"],
  webflow: ["webflow.com"],
  paypal: ["paypal.com"],
  box: ["box.com"],
  netlify: ["netlify.com"],
  vercel: ["vercel.com"],
  zapier: ["zapier.com"],
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
  /\b(?:action|add|access|board|check|connect|connected|connection|create|decision|design|document|doc|do|extract|fetch|file|find|follow[- ]?ups?|get|import|integration|integrate|issue|link|list|meeting|message|notes?|open|page|populate|project|pull|read|recordings?|review|search|see|summary|summarize|sync|task|ticket|todo|transcripts?|turn|use|workspace)\b/i;

function textContainsTerm(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}

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
  const matchesCanonicalName = (integration: DefaultMcpIntegration) =>
    [
      ...(integration.promptAliases ?? [integration.name]),
      ...(integration.brandAliases ?? []),
    ].some((alias) => textContainsTerm(normalizedText, alias));
  const canonicalMatch = integrations.find(matchesCanonicalName);
  if (canonicalMatch) return canonicalMatch;
  return null;
}

/**
 * Matches the server segment of an `mcp__<server>__<tool>` name, not prose, so
 * ambiguous brand words ("box", "monday", "linear") are safe here in a way they
 * are not in `findMcpIntegrationForText`.
 */
export function findMcpIntegrationForToolName(
  toolName: string,
  integrations: readonly DefaultMcpIntegration[] = DEFAULT_MCP_INTEGRATIONS,
): DefaultMcpIntegration | null {
  const server = /^mcp__(.+?)__/.exec(toolName.toLowerCase())?.[1];
  if (!server) return null;
  return (
    integrations.find((integration) =>
      [
        integration.id,
        integration.provider,
        ...(integration.brandAliases ?? []),
        ...(integration.aliases ?? []),
      ].some((alias) => textContainsTerm(server, alias)),
    ) ?? null
  );
}

export function isMcpConnectionFailureText(text: string): boolean {
  return /\b(?:can(?:not|'t|’t)|could(?: not|n't|n’t)|unable|failed|don't have access|don’t have access|not connected|not able)\b[\s\S]{0,80}\b(?:read|access|open|see|fetch|connect)\b/i.test(
    text,
  );
}

/**
 * Agent responses need a stronger signal than a provider name alone before
 * they create an actionable card. This intentionally accepts both an
 * imperative ("connect HubSpot") and a blocked-work explanation ("HubSpot
 * access is required"), while avoiding positive status text such as
 * "HubSpot is connected".
 */
export function isMcpConnectionSuggestionText(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;

  const hasConnectionAction = /\b(?:connect|authorize|link)\b/i.test(
    normalized,
  );
  const hasConnectionNeed =
    /\b(?:please|need(?:s)?|required?|requires?|must|should|unable|can(?:not|'t|’t)|could(?: not|n't|n’t)|don't|do not|no|without|before|continue|access|account|workspace)\b/i.test(
      normalized,
    );
  const isImperativeConnectionAction =
    /^\s*(?:please\s+)?(?:connect|authorize|link)\b/i.test(normalized);
  const isConnectionQuestion =
    /^\s*(?:can|could|would)\s+you\s+(?:please\s+)?(?:connect|authorize|link)\b/i.test(
      normalized,
    );
  const hasMissingConnection =
    /\b(?:isn't|is not|aren't|are not|hasn't|has not|not|never)\s+(?:currently\s+)?connected\b/i.test(
      normalized,
    ) ||
    /\b(?:no|without)\s+(?:a\s+)?(?:connection|access)\b/i.test(normalized);
  const hasMissingAccess =
    /\b(?:don't|do not|cannot|can't|unable)\b[\s\S]{0,80}\baccess\b/i.test(
      normalized,
    );
  const hasRequiredConnection =
    /\b(?:connection|access)\b[\s\S]{0,60}\b(?:required|needed|missing|unavailable)\b/i.test(
      normalized,
    );
  const hasRequiredAccess =
    /\b(?:need(?:s)?|require(?:s|d)?|must\s+have)\b[\s\S]{0,40}\b(?:access|connection|authorization)\b/i.test(
      normalized,
    );

  return (
    (hasConnectionAction && hasConnectionNeed) ||
    isImperativeConnectionAction ||
    isConnectionQuestion ||
    hasMissingConnection ||
    hasMissingAccess ||
    hasRequiredConnection ||
    hasRequiredAccess
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
