import {
  normalizeMcpIntegrationsConfig,
  type McpIntegrationsConfigInput,
  type NormalizedMcpIntegrationsConfig,
} from "../../shared/mcp-integration-config.js";

export type McpIntegrationAuthMode = "none" | "headers" | "oauth";

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
  docsUrl?: string;
  headerPlaceholder?: string;
  keywords: string[];
}

export interface McpIntegrationFormDefaults {
  name: string;
  url: string;
  description: string;
  headersText: string;
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
    url: "https://mcp.linear.app/sse",
    authMode: "oauth",
    docsUrl: "https://www.builder.io/c/docs/fusion-connect-to-linear",
    keywords: ["issues", "tickets", "planning", "project management"],
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
    docsUrl: "https://docs.stripe.com/mcp",
    keywords: ["payments", "billing", "subscriptions", "customers"],
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
