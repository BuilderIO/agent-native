import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

const WORKSPACE_APPS_ENV_KEY = "AGENT_NATIVE_WORKSPACE_APPS_JSON";
const WORKSPACE_APPS_MANIFEST_FILE = "workspace-apps.json";

interface WorkspaceAppManifestEntry {
  id: string;
  name: string;
  description: string;
  path: string;
  url?: string | null;
  isDispatch?: boolean;
}

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

    const { parseRemoteAgentManifest, REMOTE_AGENT_RESOURCE_PREFIXES } =
      await import("../resources/metadata.js");

    const resources: Array<{ id: string; path: string }> = [];
    for (const prefix of [...REMOTE_AGENT_RESOURCE_PREFIXES].reverse()) {
      resources.push(
        ...(isDevMode
          ? await resourceListAccessible(DEV_MODE_USER_EMAIL, prefix)
          : await resourceList(SHARED_OWNER, prefix)),
      );
    }

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

  // Overlay sibling workspace apps last so same-origin workspaces prefer the
  // app mounted in this workspace over the public template with the same id.
  for (const agent of discoverWorkspaceAgents(selfAppId)) {
    agentsById.set(agent.id, agent);
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

function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function findWorkspaceRoot(startDir = process.cwd()): string | null {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 20; i++) {
    const pkg = readJson(path.join(dir, "package.json"));
    if (typeof pkg?.["agent-native"]?.workspaceCore === "string") {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseWorkspaceAppsManifest(
  parsed: any,
): WorkspaceAppManifestEntry[] | null {
  const rawApps = Array.isArray(parsed?.apps)
    ? parsed.apps
    : Array.isArray(parsed)
      ? parsed
      : null;
  if (!rawApps) return null;

  const apps = rawApps
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const id = typeof entry.id === "string" ? entry.id.trim() : "";
      const pathValue = typeof entry.path === "string" ? entry.path.trim() : "";
      if (!id || !pathValue.startsWith("/")) return null;
      return {
        id,
        name:
          typeof entry.name === "string" && entry.name.trim()
            ? entry.name.trim()
            : titleCase(id),
        description:
          typeof entry.description === "string" ? entry.description : "",
        path: pathValue,
        url:
          typeof entry.url === "string" && entry.url.trim()
            ? entry.url.trim()
            : null,
        isDispatch:
          typeof entry.isDispatch === "boolean"
            ? entry.isDispatch
            : id === "dispatch",
      } satisfies WorkspaceAppManifestEntry;
    })
    .filter((app): app is WorkspaceAppManifestEntry => !!app)
    .sort((a, b) => {
      if (a.id === "dispatch") return -1;
      if (b.id === "dispatch") return 1;
      return a.name.localeCompare(b.name);
    });

  return apps.length ? apps : null;
}

function readWorkspaceAppsFromEnv(): WorkspaceAppManifestEntry[] | null {
  const raw = process.env[WORKSPACE_APPS_ENV_KEY];
  if (!raw) return null;
  try {
    return parseWorkspaceAppsManifest(JSON.parse(raw));
  } catch {
    return null;
  }
}

function workspaceAppsManifestCandidates(): string[] {
  const candidates: string[] = [];
  try {
    candidates.push(
      path.join(process.cwd(), ".agent-native", WORKSPACE_APPS_MANIFEST_FILE),
      path.join(process.cwd(), WORKSPACE_APPS_MANIFEST_FILE),
    );
  } catch {
    // Some edge runtimes do not expose process.cwd().
  }
  try {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(
      path.join(moduleDir, ".agent-native", WORKSPACE_APPS_MANIFEST_FILE),
      path.join(moduleDir, WORKSPACE_APPS_MANIFEST_FILE),
    );
  } catch {
    // Some edge runtimes expose non-file module URLs. The env manifest still
    // works there, so skip file-relative candidates.
  }
  return candidates;
}

function readWorkspaceAppsFromManifestFile():
  | WorkspaceAppManifestEntry[]
  | null {
  for (const file of workspaceAppsManifestCandidates()) {
    if (!fs.existsSync(file)) continue;
    const apps = parseWorkspaceAppsManifest(readJson(file));
    if (apps) return apps;
  }
  return null;
}

function readWorkspaceAppsFromFilesystem(): WorkspaceAppManifestEntry[] | null {
  const workspaceRoot = findWorkspaceRoot();
  if (!workspaceRoot) return null;
  const appsDir = path.join(workspaceRoot, "apps");
  if (!fs.existsSync(appsDir)) return null;

  const apps = fs
    .readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry): WorkspaceAppManifestEntry | null => {
      const appDir = path.join(appsDir, entry.name);
      const pkg = readJson(path.join(appDir, "package.json"));
      if (!pkg) return null;
      return {
        id: entry.name,
        name: pkg.displayName || titleCase(entry.name),
        description: pkg.description || "",
        path: `/${entry.name}`,
        isDispatch: entry.name === "dispatch",
      } satisfies WorkspaceAppManifestEntry;
    })
    .filter((app): app is WorkspaceAppManifestEntry => !!app)
    .sort((a, b) => {
      if (a.id === "dispatch") return -1;
      if (b.id === "dispatch") return 1;
      return a.name.localeCompare(b.name);
    });

  return apps.length ? apps : null;
}

function workspaceBaseUrl(): string | null {
  return (
    process.env.WORKSPACE_GATEWAY_URL ||
    process.env.APP_URL ||
    process.env.URL ||
    process.env.DEPLOY_URL ||
    process.env.BETTER_AUTH_URL ||
    null
  );
}

function workspaceAppUrl(app: WorkspaceAppManifestEntry): string | null {
  if (app.url) return app.url;
  const base = workspaceBaseUrl();
  if (!base) return null;
  try {
    return new URL(app.path, `${base.replace(/\/$/, "")}/`).toString();
  } catch {
    return null;
  }
}

function discoverWorkspaceAgents(selfAppId?: string): DiscoveredAgent[] {
  const workspaceApps =
    readWorkspaceAppsFromEnv() ??
    readWorkspaceAppsFromManifestFile() ??
    readWorkspaceAppsFromFilesystem();
  if (!workspaceApps) return [];

  return workspaceApps
    .filter((app) => app.id !== selfAppId)
    .map((app) => {
      const url = workspaceAppUrl(app);
      if (!url) return null;
      const builtin = BUILTIN_AGENTS.find((agent) => agent.id === app.id);
      return {
        id: app.id,
        name: app.name,
        description:
          app.description ||
          builtin?.description ||
          `Workspace app mounted at ${app.path}`,
        url,
        color: builtin?.color || "#6B7280",
      } satisfies DiscoveredAgent;
    })
    .filter((agent): agent is DiscoveredAgent => !!agent);
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
