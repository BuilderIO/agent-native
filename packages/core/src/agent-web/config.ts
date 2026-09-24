import {
  normalizeWorkspaceAppAudience,
  normalizeWorkspaceAppPathList,
  type WorkspaceAppAudience,
} from "../shared/workspace-app-audience.js";

export const AGENT_WEB_CRAWLER_CATEGORIES = [
  "training",
  "search",
  "userTriggered",
  "codingAgents",
  "autonomousAgents",
] as const;

export type AgentWebCrawlerCategory =
  (typeof AGENT_WEB_CRAWLER_CATEGORIES)[number];

export type AgentWebCrawlerDecision = "allow" | "disallow";

export type AgentWebCrawlerPolicy =
  | "discoverable-no-training"
  | "allow-all"
  | "disallow-all";

export type AgentWebCrawlerOverrides = Partial<
  Record<AgentWebCrawlerCategory, AgentWebCrawlerDecision>
>;

export interface AgentWebInputConfig {
  discoverable?: boolean;
  markdownTwins?: boolean;
  llmsTxt?: boolean;
  jsonLd?: boolean;
  publicAgentCard?: boolean;
  publicMcp?: boolean;
  crawlerPolicy?: AgentWebCrawlerPolicy;
  crawlers?: AgentWebCrawlerOverrides;
}

export interface AgentWebConfig {
  discoverable: boolean;
  markdownTwins: boolean;
  llmsTxt: boolean;
  jsonLd: boolean;
  publicAgentCard: boolean;
  publicMcp: boolean;
  crawlerPolicy: AgentWebCrawlerPolicy;
  crawlers: AgentWebCrawlerOverrides;
}

export interface DeriveAgentWebPublicRoutesOptions {
  audience?: WorkspaceAppAudience;
  publicPaths?: string[];
  protectedPaths?: string[];
  routes?: string[];
}

export const DEFAULT_AGENT_WEB_CRAWLER_POLICY: AgentWebCrawlerPolicy =
  "discoverable-no-training";

export function normalizeAgentWebConfig(
  value: unknown,
  options: { hasPublicRoutes?: boolean } = {},
): AgentWebConfig {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const disabled = value === false;
  const hasPublicRoutes = options.hasPublicRoutes === true;

  return {
    discoverable: disabled
      ? false
      : typeof record.discoverable === "boolean"
        ? record.discoverable
        : hasPublicRoutes,
    markdownTwins:
      typeof record.markdownTwins === "boolean" ? record.markdownTwins : true,
    llmsTxt: typeof record.llmsTxt === "boolean" ? record.llmsTxt : true,
    jsonLd: typeof record.jsonLd === "boolean" ? record.jsonLd : true,
    publicAgentCard:
      typeof record.publicAgentCard === "boolean"
        ? record.publicAgentCard
        : true,
    publicMcp: typeof record.publicMcp === "boolean" ? record.publicMcp : false,
    crawlerPolicy: isCrawlerPolicy(record.crawlerPolicy)
      ? record.crawlerPolicy
      : DEFAULT_AGENT_WEB_CRAWLER_POLICY,
    crawlers: normalizeCrawlerOverrides(record.crawlers),
  };
}

export function agentWebConfigFromPackageJson(
  pkg: unknown,
): AgentWebInputConfig | boolean | undefined {
  const config = agentNativeConfigFromPackageJson(pkg);
  const raw =
    config?.workspaceApp?.agentWeb ??
    config?.workspace?.agentWeb ??
    config?.agentWeb ??
    config?.root?.agentWeb;
  if (raw === undefined) return undefined;
  if (raw === false) return false;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  return raw as AgentWebInputConfig;
}

export function resolveAgentWebCrawlerPolicy(
  config: Pick<AgentWebConfig, "crawlerPolicy" | "crawlers">,
): Record<AgentWebCrawlerCategory, AgentWebCrawlerDecision> {
  const baseline: Record<AgentWebCrawlerCategory, AgentWebCrawlerDecision> =
    config.crawlerPolicy === "allow-all"
      ? {
          training: "allow",
          search: "allow",
          userTriggered: "allow",
          codingAgents: "allow",
          autonomousAgents: "allow",
        }
      : config.crawlerPolicy === "disallow-all"
        ? {
            training: "disallow",
            search: "disallow",
            userTriggered: "disallow",
            codingAgents: "disallow",
            autonomousAgents: "disallow",
          }
        : {
            training: "disallow",
            search: "allow",
            userTriggered: "allow",
            codingAgents: "allow",
            autonomousAgents: "allow",
          };

  for (const category of AGENT_WEB_CRAWLER_CATEGORIES) {
    const override = config.crawlers[category];
    if (override) baseline[category] = override;
  }
  return baseline;
}

export function deriveAgentWebPublicRoutes(
  options: DeriveAgentWebPublicRoutesOptions,
): string[] {
  const audience = normalizeWorkspaceAppAudience(options.audience);
  const publicPaths = normalizeWorkspaceAppPathList(options.publicPaths ?? []);
  const protectedPaths = normalizeWorkspaceAppPathList(
    options.protectedPaths ?? [],
  );
  const routes = normalizeWorkspaceAppPathList(options.routes ?? []);

  const sourceRoutes =
    routes.length > 0
      ? routes
      : audience === "public"
        ? publicPaths.length > 0
          ? publicPaths
          : ["/"]
        : publicPaths;

  const publicRoutes =
    audience === "public"
      ? sourceRoutes.filter(
          (route) =>
            !protectedPaths.some((pattern) =>
              pathPatternMatches(pattern, route),
            ),
        )
      : sourceRoutes.filter((route) =>
          publicPaths.some((pattern) => pathPatternMatches(pattern, route)),
        );

  return Array.from(new Set(publicRoutes)).sort((a, b) => {
    if (a === "/") return -1;
    if (b === "/") return 1;
    return a.localeCompare(b);
  });
}

export function pathPatternMatches(pattern: string, route: string): boolean {
  const normalizedPattern = normalizeWorkspaceAppPathList([pattern])[0];
  const normalizedRoute = normalizeWorkspaceAppPathList([route])[0];
  if (!normalizedPattern || !normalizedRoute) return false;
  if (normalizedPattern === "/*" || normalizedPattern === "/**") return true;
  if (normalizedPattern.endsWith("/*") || normalizedPattern.endsWith("/**")) {
    const base = normalizedPattern.replace(/\/\*\*?$/, "") || "/";
    return (
      normalizedRoute === base ||
      (base === "/"
        ? normalizedRoute.startsWith("/")
        : normalizedRoute.startsWith(`${base}/`))
    );
  }
  return normalizedPattern === normalizedRoute;
}

function normalizeCrawlerOverrides(value: unknown): AgentWebCrawlerOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const out: AgentWebCrawlerOverrides = {};
  for (const category of AGENT_WEB_CRAWLER_CATEGORIES) {
    const decision = record[category];
    if (decision === "allow" || decision === "disallow") {
      out[category] = decision;
    }
  }
  return out;
}

function isCrawlerPolicy(value: unknown): value is AgentWebCrawlerPolicy {
  return (
    value === "discoverable-no-training" ||
    value === "allow-all" ||
    value === "disallow-all"
  );
}

function agentNativeConfigFromPackageJson(pkg: unknown):
  | {
      root: Record<string, any>;
      workspaceApp?: Record<string, any>;
      workspace?: Record<string, any>;
      agentWeb?: unknown;
    }
  | undefined {
  if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) return undefined;
  const record = pkg as Record<string, any>;
  const config = record["agent-native"] ?? record.agentNative;
  const nested =
    config && typeof config === "object" && !Array.isArray(config)
      ? (config as Record<string, any>)
      : {};
  const workspaceApp =
    nested.workspaceApp &&
    typeof nested.workspaceApp === "object" &&
    !Array.isArray(nested.workspaceApp)
      ? (nested.workspaceApp as Record<string, any>)
      : undefined;
  const workspace =
    nested.workspace &&
    typeof nested.workspace === "object" &&
    !Array.isArray(nested.workspace)
      ? (nested.workspace as Record<string, any>)
      : undefined;
  return {
    root: record,
    workspaceApp,
    workspace,
    agentWeb: nested.agentWeb,
  };
}
