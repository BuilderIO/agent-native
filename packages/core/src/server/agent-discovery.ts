import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TEMPLATES } from "../cli/templates-meta.js";
import { getRequestOrgId, getRequestUserEmail } from "./request-context.js";
import {
  DEFAULT_WORKSPACE_APP_AUDIENCE,
  normalizeWorkspaceAppAudience,
  workspaceAppAudienceFromPackageJson,
  type WorkspaceAppAudience,
} from "../shared/workspace-app-audience.js";

export interface DiscoveredAgent {
  id: string;
  name: string;
  description: string;
  url: string;
  color: string;
}

export interface WorkspaceAppMetadataOverride {
  name?: string;
  description?: string;
  generated?: boolean;
  sourcePrompt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface WorkspaceAppMetadataSettings {
  apps: Record<string, WorkspaceAppMetadataOverride>;
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
 * connected-agent discovery stays aligned with first-party template metadata
 * without depending on @agent-native/shared-app-config at runtime.
 */
const BUILTIN_AGENTS: AgentEntry[] = TEMPLATES.filter(
  (template) =>
    (!template.hidden || template.defaultAgent) && !!template.prodUrl,
).map((template) => ({
  id: template.name,
  name: template.label,
  description: template.description ?? template.hint,
  url: template.prodUrl!,
  devUrl: `http://localhost:${template.devPort}`,
  devPort: template.devPort,
  color: template.color,
}));

const HIDDEN_FIRST_PARTY_AGENT_IDS = new Set(
  TEMPLATES.filter(
    (template) => template.hidden && !template.defaultAgent && template.prodUrl,
  ).map((template) => template.name),
);

const WORKSPACE_APPS_ENV_KEY = "AGENT_NATIVE_WORKSPACE_APPS_JSON";
const WORKSPACE_APPS_MANIFEST_FILE = "workspace-apps.json";
export const WORKSPACE_APP_METADATA_SETTINGS_KEY = "workspace-app-metadata";

export interface WorkspaceAppManifestEntry {
  id: string;
  name: string;
  description: string;
  path: string;
  url?: string | null;
  isDispatch?: boolean;
  audience?: WorkspaceAppAudience;
}

export function workspaceAppMetadataSettingsKey(input?: {
  orgId?: string | null;
  userEmail?: string | null;
}): string | null {
  const orgId = input?.orgId ?? getRequestOrgId() ?? null;
  if (orgId) return `${WORKSPACE_APP_METADATA_SETTINGS_KEY}:org:${orgId}`;

  const userEmail = input?.userEmail ?? getRequestUserEmail() ?? null;
  if (userEmail)
    return `${WORKSPACE_APP_METADATA_SETTINGS_KEY}:user:${userEmail}`;

  return null;
}

function cleanOptionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function parseWorkspaceAppMetadataSettings(
  raw: unknown,
): WorkspaceAppMetadataSettings {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const rawApps =
    record.apps &&
    typeof record.apps === "object" &&
    !Array.isArray(record.apps)
      ? (record.apps as Record<string, unknown>)
      : {};
  const apps: Record<string, WorkspaceAppMetadataOverride> = {};

  for (const [id, value] of Object.entries(rawApps)) {
    if (!id.trim() || !value || typeof value !== "object") continue;
    const item = value as Record<string, unknown>;
    const override: WorkspaceAppMetadataOverride = {};
    const name = cleanOptionalText(item.name);
    const description = cleanOptionalText(item.description);
    const sourcePrompt = cleanOptionalText(item.sourcePrompt);
    const updatedAt = cleanOptionalText(item.updatedAt);
    const updatedBy = cleanOptionalText(item.updatedBy);

    if (name) override.name = name;
    if (description) override.description = description;
    if (item.generated === true) override.generated = true;
    if (sourcePrompt) override.sourcePrompt = sourcePrompt;
    if (updatedAt) override.updatedAt = updatedAt;
    if (updatedBy) override.updatedBy = updatedBy;

    if (Object.keys(override).length > 0) apps[id.trim()] = override;
  }

  return { apps };
}

export async function readWorkspaceAppMetadataSettings(): Promise<WorkspaceAppMetadataSettings> {
  const key = workspaceAppMetadataSettingsKey();
  if (!key) return { apps: {} };

  try {
    const { getSetting } = await import("../settings/index.js");
    return parseWorkspaceAppMetadataSettings(await getSetting(key));
  } catch {
    return { apps: {} };
  }
}

export async function writeWorkspaceAppMetadataOverride(input: {
  appId: string;
  name?: string | null;
  description?: string | null;
  generated?: boolean;
  sourcePrompt?: string | null;
  updatedBy?: string | null;
}): Promise<WorkspaceAppMetadataSettings> {
  const key = workspaceAppMetadataSettingsKey();
  if (!key) throw new Error("no authenticated user");

  const appId = input.appId.trim();
  if (!appId) throw new Error("appId is required");

  const { getSetting, putSetting } = await import("../settings/index.js");
  const current = parseWorkspaceAppMetadataSettings(await getSetting(key));
  const existing = current.apps[appId] ?? {};
  const next: WorkspaceAppMetadataOverride = {
    ...existing,
    updatedAt: new Date().toISOString(),
  };

  const name = cleanOptionalText(input.name);
  const description = cleanOptionalText(input.description);
  const sourcePrompt = cleanOptionalText(input.sourcePrompt);
  const updatedBy = cleanOptionalText(input.updatedBy);

  if (name) next.name = name;
  else delete next.name;
  if (description) next.description = description;
  else delete next.description;
  if (input.generated === true) next.generated = true;
  else if (input.generated === false) delete next.generated;
  if (sourcePrompt) next.sourcePrompt = sourcePrompt;
  if (updatedBy) next.updatedBy = updatedBy;

  current.apps[appId] = next;
  await putSetting(key, current as unknown as Record<string, unknown>);
  return current;
}

export function applyWorkspaceAppMetadataOverride<
  T extends {
    id: string;
    name: string;
    description?: string | null;
  },
>(app: T, settings: WorkspaceAppMetadataSettings): T {
  const override = settings.apps[app.id];
  if (!override) return app;

  const name = cleanOptionalText(override.name);
  const description = cleanOptionalText(override.description);
  const generated = override.generated === true;
  const shouldApplyName = !!name && !generated;
  const shouldApplyDescription =
    !!description && (!generated || !cleanOptionalText(app.description));
  if (!shouldApplyName && !shouldApplyDescription) return app;

  return {
    ...app,
    ...(shouldApplyName ? { name } : {}),
    ...(shouldApplyDescription ? { description } : {}),
  };
}

/**
 * Resolve the workspace app manifest from the same fallback chain that
 * `discoverWorkspaceAgents` uses: `AGENT_NATIVE_WORKSPACE_APPS_JSON` env →
 * `.agent-native/workspace-apps.json` (or sibling) on disk → live filesystem
 * scan of `apps/<id>/package.json` under the workspace root.
 *
 * Callers (e.g. the dispatch `/dispatch/<appId>` catch-all loader) need this
 * to behave the same in production deploys (which write the manifest file)
 * and during local dev (where new apps appear under `apps/` without an env
 * restart). Reading only the env var would silently downgrade the behavior
 * in both cases.
 */
export function loadWorkspaceAppsManifest():
  | WorkspaceAppManifestEntry[]
  | null {
  return (
    readWorkspaceAppsFromEnv() ??
    readWorkspaceAppsFromManifestFile() ??
    readWorkspaceAppsFromFilesystem()
  );
}

export function shouldIncludeRemoteAgentManifest(
  manifest: { id?: string | null },
  selfAppId?: string,
): boolean {
  const id = manifest.id?.trim();
  if (!id) return false;
  const normalizedId = id.toLowerCase();
  const normalizedSelfAppId = selfAppId?.trim().toLowerCase();
  if (normalizedSelfAppId && normalizedId === normalizedSelfAppId) {
    return false;
  }
  return !HIDDEN_FIRST_PARTY_AGENT_IDS.has(normalizedId);
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
    const { resourceList, resourceGet, SHARED_OWNER } =
      await import("../resources/store.js");

    const { parseRemoteAgentManifest, REMOTE_AGENT_RESOURCE_PREFIXES } =
      await import("../resources/metadata.js");

    const resources: Array<{ id: string; path: string }> = [];
    for (const prefix of [...REMOTE_AGENT_RESOURCE_PREFIXES].reverse()) {
      resources.push(...(await resourceList(SHARED_OWNER, prefix)));
    }

    for (const r of resources) {
      if (!r.path.endsWith(".json")) continue;
      try {
        const full = await resourceGet(r.id);
        if (!full) continue;
        const manifest = parseRemoteAgentManifest(full.content, r.path);
        if (!manifest || !shouldIncludeRemoteAgentManifest(manifest, selfAppId))
          continue;

        // If the resource override carries a localhost URL but we're running
        // in production (e.g. a stale dev-time seed got promoted to the prod
        // DB), fall back to the matching built-in's prod URL instead of
        // letting the override win — otherwise outbound `call-agent` fetches
        // from a serverless function would target localhost and fail with
        // "fetch failed" instantly. The override still wins for non-localhost
        // URLs (the supported case for self-hosted custom agents).
        let url = manifest.url;
        const isProduction =
          typeof process !== "undefined" &&
          process.env?.NODE_ENV === "production";
        if (
          isProduction &&
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
  for (const agent of await discoverWorkspaceAgents(selfAppId)) {
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
        audience:
          entry.audience === undefined
            ? DEFAULT_WORKSPACE_APP_AUDIENCE
            : normalizeWorkspaceAppAudience(entry.audience),
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
        audience:
          workspaceAppAudienceFromPackageJson(pkg) ??
          DEFAULT_WORKSPACE_APP_AUDIENCE,
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

async function discoverWorkspaceAgents(
  selfAppId?: string,
): Promise<DiscoveredAgent[]> {
  const workspaceApps = loadWorkspaceAppsManifest();
  if (!workspaceApps) return [];

  const metadataSettings = await readWorkspaceAppMetadataSettings();

  return workspaceApps
    .filter((app) => app.id !== selfAppId)
    .map((app) => {
      const withOverride = applyWorkspaceAppMetadataOverride(
        app,
        metadataSettings,
      );
      const url = workspaceAppUrl(withOverride);
      if (!url) return null;
      const builtin = BUILTIN_AGENTS.find(
        (agent) => agent.id === withOverride.id,
      );
      return {
        id: withOverride.id,
        name: withOverride.name,
        description:
          withOverride.description ||
          builtin?.description ||
          `Workspace app mounted at ${withOverride.path}`,
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
