import { TEMPLATES, visibleTemplates } from "../cli/templates-meta.js";

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
}

/**
 * Built-in agent registry. Derive this from the published CLI metadata so
 * connected-agent discovery stays aligned with the public template allow-list
 * without depending on @agent-native/shared-app-config at runtime.
 */
const BUILTIN_AGENTS: AgentEntry[] = visibleTemplates()
  .filter((template) => !!template.prodUrl)
  .map((template) => ({
    id: template.name,
    name: template.label,
    description: template.description ?? template.hint,
    url: template.prodUrl!,
    devUrl: `http://localhost:${template.devPort}`,
    devPort: template.devPort,
    color: template.color,
  }));

const HIDDEN_FIRST_PARTY_AGENT_IDS = new Set(
  TEMPLATES.filter((template) => template.hidden && template.prodUrl).map(
    (template) => template.name,
  ),
);

/**
 * Get built-in agents (static, no DB). Used as fallback and for seeding.
 */
export function getBuiltinAgents(selfAppId?: string): DiscoveredAgent[] {
  return BUILTIN_AGENTS.filter((app) => app.id !== selfAppId && app.url).map(
    (app) => ({
      id: app.id,
      name: app.name,
      description: app.description,
      url: resolveAgentUrl(app),
      color: app.color,
    }),
  );
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
        if (HIDDEN_FIRST_PARTY_AGENT_IDS.has(manifest.id)) continue;

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
  BUILTIN_AGENTS.filter((app) => app.url).map((app) => ({
    id: app.id,
    name: app.name,
    description: app.description,
    url: app.url, // ALWAYS prod
    color: app.color,
  }));
