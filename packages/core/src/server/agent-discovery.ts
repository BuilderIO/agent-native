export interface DiscoveredAgent {
  id: string;
  name: string;
  description: string;
  url: string;
  color: string;
}

interface AgentEntry {
  id: string;
  name: string;
  description: string;
  url: string;
  devUrl?: string;
  devPort: number;
  color: string;
  enabled: boolean;
  placeholder?: boolean;
  mode?: "dev" | "prod";
}

/**
 * Built-in agent registry. Mirrors DEFAULT_APPS from @agent-native/shared-app-config
 * but inlined here to avoid a cross-package dependency that breaks tsc.
 */
const BUILTIN_AGENTS: AgentEntry[] = [
  {
    id: "mail",
    name: "Mail",
    description: "Email client",
    url: "https://mail.agent-native.com",
    devUrl: "http://localhost:8085",
    devPort: 8085,
    color: "#3B82F6",
    enabled: true,
    mode: "prod",
  },
  {
    id: "calendar",
    name: "Calendar",
    description: "Google Calendar integration",
    url: "https://calendar.agent-native.com",
    devUrl: "http://localhost:8082",
    devPort: 8082,
    color: "#8B5CF6",
    enabled: true,
    mode: "prod",
  },
  {
    id: "content",
    name: "Content",
    description: "Notion-like content workspace",
    url: "https://content.agent-native.com",
    devUrl: "http://localhost:8083",
    devPort: 8083,
    color: "#10B981",
    enabled: true,
    mode: "prod",
  },
  {
    id: "analytics",
    name: "Analytics",
    description: "Analytics dashboard",
    url: "https://analytics.agent-native.com",
    devUrl: "http://localhost:8088",
    devPort: 8088,
    color: "#F59E0B",
    enabled: true,
    mode: "prod",
  },
  {
    id: "slides",
    name: "Slides",
    description: "AI slide deck creator",
    url: "https://slides.agent-native.com",
    devUrl: "http://localhost:8086",
    devPort: 8086,
    color: "#EC4899",
    enabled: true,
    mode: "prod",
  },
  {
    id: "videos",
    name: "Videos",
    description: "AI video creator",
    url: "https://videos.agent-native.com",
    devUrl: "http://localhost:8087",
    devPort: 8087,
    color: "#EF4444",
    enabled: true,
    mode: "prod",
  },
  {
    id: "issues",
    name: "Issues",
    description: "Jira project tracker",
    url: "https://issues.agent-native.com",
    devUrl: "http://localhost:8091",
    devPort: 8091,
    color: "#6366F1",
    enabled: true,
    mode: "dev",
  },
  {
    id: "forms",
    name: "Forms",
    description: "Form builder",
    url: "https://forms.agent-native.com",
    devUrl: "http://localhost:8084",
    devPort: 8084,
    color: "#06B6D4",
    enabled: true,
    mode: "prod",
  },
  {
    id: "recruiting",
    name: "Recruiting",
    description: "AI-powered recruiting",
    url: "https://recruiting.agent-native.com",
    devUrl: "http://localhost:8090",
    devPort: 8090,
    color: "#16A34A",
    enabled: true,
    mode: "dev",
  },
];

/**
 * Get built-in agents (static, no DB). Used as fallback and for seeding.
 */
export function getBuiltinAgents(selfAppId?: string): DiscoveredAgent[] {
  return BUILTIN_AGENTS.filter(
    (app) => app.id !== selfAppId && app.enabled && !app.placeholder && app.url,
  ).map((app) => ({
    id: app.id,
    name: app.name,
    description: app.description,
    url: resolveAgentUrl(app),
    color: app.color,
  }));
}

/**
 * Discover all agents: built-in + custom agents stored as resources.
 * Custom agents override built-in agents with the same ID.
 */
export async function discoverAgents(
  selfAppId?: string,
): Promise<DiscoveredAgent[]> {
  const builtins = getBuiltinAgents(selfAppId);
  const agentsById = new Map<string, DiscoveredAgent>();

  // Start with built-ins
  for (const agent of builtins) {
    agentsById.set(agent.id, agent);
  }

  // Overlay custom agents from resources
  try {
    const { resourceList, resourceGet, SHARED_OWNER, resourceListAccessible } =
      await import("../resources/store.js");
    const { DEV_MODE_USER_EMAIL } = await import("./auth.js");

    const isDevMode =
      typeof process !== "undefined" && process.env?.NODE_ENV !== "production";

    const resources = isDevMode
      ? await resourceListAccessible(DEV_MODE_USER_EMAIL, "remote-agents/")
      : await resourceList(SHARED_OWNER, "remote-agents/");
    const { parseRemoteAgentManifest } =
      await import("../resources/metadata.js");

    for (const r of resources) {
      if (!r.path.endsWith(".json")) continue;
      try {
        const full = await resourceGet(r.id);
        if (!full) continue;
        const manifest = parseRemoteAgentManifest(full.content, r.path);
        if (!manifest || manifest.id === selfAppId) continue;

        // If the resource override carries a localhost URL but we're running
        // in production (e.g. a stale dev-time seed got promoted to the prod
        // DB), fall back to the matching built-in's prod URL instead of
        // letting the override win — otherwise outbound `call-agent` fetches
        // from a serverless function would target localhost and fail with
        // "fetch failed" instantly. The override still wins for non-localhost
        // URLs (the supported case for self-hosted custom agents).
        let url = manifest.url;
        if (
          !isDevMode &&
          typeof url === "string" &&
          /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/.test(url)
        ) {
          const builtin = agentsById.get(manifest.id);
          if (builtin?.url) url = builtin.url;
        }

        agentsById.set(manifest.id, {
          id: manifest.id,
          name: manifest.name,
          description: manifest.description || "",
          url,
          color: manifest.color || "#6B7280",
        });
      } catch {
        // Skip unreadable resources
      }
    }
  } catch {
    // Resources not available — use built-ins only
  }

  return Array.from(agentsById.values());
}

/**
 * Look up a single agent by ID or name (case-insensitive).
 */
export async function findAgent(
  idOrName: string,
  selfAppId?: string,
): Promise<DiscoveredAgent | undefined> {
  const lower = idOrName.toLowerCase();
  const agents = await discoverAgents(selfAppId);
  return agents.find((a) => a.id === lower || a.name.toLowerCase() === lower);
}

function isDevEnvironment(): boolean {
  return (
    typeof process !== "undefined" && process.env?.NODE_ENV !== "production"
  );
}

function resolveAgentUrl(app: AgentEntry): string {
  if (isDevEnvironment()) {
    return app.devUrl || `http://localhost:${app.devPort}`;
  }
  return app.url;
}

/**
 * Like `getBuiltinAgents`, but always returns the production URL — never the
 * env-resolved devUrl. Used by the resource seeder so that a one-time seed
 * (`ON CONFLICT DO NOTHING`) can't permanently bake a localhost URL into the
 * DB, which would override the built-in's prod URL for every later
 * production deploy.
 */
export const BUILTIN_AGENTS_FOR_SEEDING: DiscoveredAgent[] =
  BUILTIN_AGENTS.filter(
    (app) => app.enabled && !app.placeholder && app.url,
  ).map((app) => ({
    id: app.id,
    name: app.name,
    description: app.description,
    url: app.url, // ALWAYS prod
    color: app.color,
  }));
