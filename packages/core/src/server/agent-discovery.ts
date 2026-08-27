import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getAppConfig } from "../app-config/index.js";
import { TEMPLATES } from "../cli/templates-meta.js";
import {
  DEFAULT_WORKSPACE_APP_AUDIENCE,
  normalizeWorkspaceAppAudience,
  normalizeWorkspaceAppPathList,
  workspaceAppAudienceFromPackageJson,
  workspaceAppRouteAccessFromPackageJson,
  type WorkspaceAppAudience,
} from "../shared/workspace-app-audience.js";
import { getRequestOrgId, getRequestUserEmail } from "./request-context.js";

export interface DiscoveredAgent {
  id: string;
  name: string;
  description: string;
  url: string;
  color: string;
}

export type OrgDirectoryDiscoveryResult =
  | { status: "available"; agents: DiscoveredAgent[] }
  | {
      status: "unavailable";
      reason: "remote-manifests" | "workspace-metadata";
    };

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

const HIDDEN_FIRST_PARTY_AGENT_IDS = new Set([
  ...TEMPLATES.filter(
    (template) => template.hidden && !template.defaultAgent && template.prodUrl,
  ).map((template) => template.name),
  // Stale resources for removed first-party apps should not reappear as
  // custom remote agents just because the template metadata entry is gone.
  "calls",
  "code",
  "issues",
  "meeting-notes",
  "migration",
  "recruiting",
  "scheduling",
  "voice",
  "workbench",
]);

export function normalizeAgentId(id: string): string {
  const normalized = id.trim().toLowerCase();
  if (
    normalized === "image" ||
    normalized === "images" ||
    normalized === "asset"
  ) {
    return "assets";
  }
  if (normalized === "videos") return "clips";
  return normalized;
}

const WORKSPACE_APPS_ENV_KEY = "AGENT_NATIVE_WORKSPACE_APPS_JSON";
const WORKSPACE_APPS_MANIFEST_FILE = "workspace-apps.json";
export const WORKSPACE_APP_METADATA_SETTINGS_KEY = "workspace-app-metadata";

export interface WorkspaceAppManifestEntry {
  id: string;
  name: string;
  description: string;
  path: string;
  url?: string | null;
  /** Local-only child port used to authorize loopback A2A calls. */
  port?: number;
  isDispatch?: boolean;
  audience?: WorkspaceAppAudience;
  publicPaths?: string[];
  protectedPaths?: string[];
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
  strict = false,
): WorkspaceAppMetadataSettings {
  if (
    strict &&
    raw !== null &&
    raw !== undefined &&
    (typeof raw !== "object" || Array.isArray(raw))
  ) {
    throw new Error("Invalid workspace app metadata settings");
  }
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  if (
    strict &&
    record.apps !== undefined &&
    (record.apps === null ||
      typeof record.apps !== "object" ||
      Array.isArray(record.apps))
  ) {
    throw new Error("Invalid workspace app metadata apps map");
  }
  const rawApps =
    record.apps &&
    typeof record.apps === "object" &&
    !Array.isArray(record.apps)
      ? (record.apps as Record<string, unknown>)
      : {};
  const apps: Record<string, WorkspaceAppMetadataOverride> = {};
  const canonicalIds = new Set<string>();

  for (const [rawId, value] of Object.entries(rawApps)) {
    const id = rawId.trim();
    const normalizedId = id ? normalizeAgentId(id) : "";
    if (
      !normalizedId ||
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      if (strict) throw new Error("Invalid workspace app metadata entry");
      continue;
    }
    const item = value as Record<string, unknown>;
    if (
      strict &&
      ((item.name !== undefined && typeof item.name !== "string") ||
        (item.description !== undefined &&
          typeof item.description !== "string") ||
        (item.generated !== undefined && typeof item.generated !== "boolean") ||
        (item.sourcePrompt !== undefined &&
          typeof item.sourcePrompt !== "string") ||
        (item.updatedAt !== undefined && typeof item.updatedAt !== "string") ||
        (item.updatedBy !== undefined && typeof item.updatedBy !== "string"))
    ) {
      throw new Error("Invalid workspace app metadata fields");
    }
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

    if (Object.keys(override).length > 0) {
      const isCanonical = id.toLowerCase() === normalizedId;
      if (isCanonical || !canonicalIds.has(normalizedId)) {
        apps[normalizedId] = override;
      }
      if (isCanonical) canonicalIds.add(normalizedId);
    }
  }

  return { apps };
}

export async function readWorkspaceAppMetadataSettings(): Promise<WorkspaceAppMetadataSettings> {
  return readWorkspaceAppMetadataSettingsInternal(false);
}

async function readWorkspaceAppMetadataSettingsInternal(
  strict: boolean,
): Promise<WorkspaceAppMetadataSettings> {
  const key = workspaceAppMetadataSettingsKey();
  if (!key) return { apps: {} };

  try {
    const { getSetting } = await import("../settings/index.js");
    return parseWorkspaceAppMetadataSettings(await getSetting(key), strict);
  } catch (error) {
    if (strict) throw error;
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

  const appId = normalizeAgentId(input.appId);
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
  const override =
    settings.apps[normalizeAgentId(app.id)] ?? settings.apps[app.id];
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
export function loadWorkspaceAppsManifest(
  strict = false,
): WorkspaceAppManifestEntry[] | null {
  return (
    readWorkspaceAppsFromEnv(strict) ??
    readWorkspaceAppsFromManifestFile(strict) ??
    readWorkspaceAppsFromFilesystem(strict)
  );
}

export function shouldIncludeRemoteAgentManifest(
  manifest: { id?: string | null },
  selfAppId?: string,
): boolean {
  const id = manifest.id?.trim();
  if (!id) return false;
  const normalizedId = normalizeAgentId(id);
  const normalizedSelfAppId = selfAppId ? normalizeAgentId(selfAppId) : "";
  if (normalizedSelfAppId && normalizedId === normalizedSelfAppId) {
    return false;
  }
  return !HIDDEN_FIRST_PARTY_AGENT_IDS.has(normalizedId);
}

/**
 * Get built-in agents (static, no DB). Used as fallback and for seeding.
 */
export function getBuiltinAgents(
  selfAppId?: string,
  options?: { preferLocalUrls?: boolean },
): DiscoveredAgent[] {
  const normalizedSelfAppId = selfAppId ? normalizeAgentId(selfAppId) : "";
  return BUILTIN_AGENTS.filter(
    (app) => app.id !== normalizedSelfAppId && app.url,
  ).map((app) => ({
    id: app.id,
    name: app.name,
    description: app.description,
    url: resolveAgentUrl(app, options?.preferLocalUrls),
    color: app.color,
  }));
}

/**
 * Discover all agents: built-in + custom agents stored as resources.
 * Custom agents override built-in agents with the same ID.
 */
export async function discoverAgents(
  selfAppId?: string,
  options?: { preferLocalUrls?: boolean },
): Promise<DiscoveredAgent[]> {
  const builtins = getBuiltinAgents(selfAppId, options);
  const agentsById = new Map<string, DiscoveredAgent>();

  // Start with built-ins
  for (const agent of builtins) {
    agentsById.set(agent.id, agent);
  }

  // Overlay custom agents from resources
  try {
    const { resourceList, resourceGet, SHARED_OWNER, sharedResourceOwner } =
      await import("../resources/store.js");

    const { parseRemoteAgentManifest, REMOTE_AGENT_RESOURCE_PREFIXES } =
      await import("../resources/metadata.js");

    const activeOwner = sharedResourceOwner(getRequestOrgId());
    const owners = [...new Set([SHARED_OWNER, activeOwner])];
    const resources: Array<{ id: string; path: string }> = [];
    const seenResources = new Set<string>();
    for (const owner of owners) {
      for (const prefix of [...REMOTE_AGENT_RESOURCE_PREFIXES].reverse()) {
        for (const resource of await resourceList(owner, prefix)) {
          const resourceKey = `${owner}\0${resource.id}`;
          if (seenResources.has(resourceKey)) continue;
          seenResources.add(resourceKey);
          resources.push(resource);
        }
      }
    }

    for (const r of resources) {
      if (!r.path.endsWith(".json")) continue;
      try {
        const full = await resourceGet(r.id);
        if (!full) continue;
        const manifest = parseRemoteAgentManifest(full.content, r.path);
        if (!manifest || !shouldIncludeRemoteAgentManifest(manifest, selfAppId))
          continue;
        const manifestId = normalizeAgentId(manifest.id);

        // If the resource override carries a localhost URL but we're running
        // in a hosted runtime (e.g. a stale dev-time seed got promoted to the prod
        // DB), fall back to the matching built-in's prod URL instead of
        // letting the override win — otherwise outbound `call-agent` fetches
        // from a serverless function would target localhost and fail with
        // "fetch failed" instantly. The override still wins for non-localhost
        // URLs (the supported case for self-hosted custom agents).
        let url = manifest.url;
        const isHosted = isHostedRuntime();
        if (isHosted && typeof url === "string" && isLoopbackUrl(url)) {
          const builtin = agentsById.get(manifestId);
          if (builtin?.url) url = builtin.url;
          else continue;
        }

        const builtin = agentsById.get(manifestId);
        if (options?.preferLocalUrls && builtin) {
          const isBuiltinAgent = BUILTIN_AGENTS.some(
            (candidate) => candidate.id === manifestId,
          );
          if (isBuiltinAgent) url = builtin.url;
        }
        const isLegacyAssetsManifest =
          manifest.id.trim().toLowerCase() !== manifestId;
        if (isLegacyAssetsManifest && builtin?.url) {
          try {
            if (new URL(url).hostname === "images.agent-native.com") {
              url = builtin.url;
            }
          } catch {
            url = builtin.url;
          }
        }

        agentsById.set(manifestId, {
          id: manifestId,
          name:
            isLegacyAssetsManifest && builtin?.name
              ? builtin.name
              : manifest.name,
          description: manifest.description || "",
          url,
          color: manifest.color || builtin?.color || "#6B7280",
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
  for (const agent of await discoverWorkspaceAgents(selfAppId, options)) {
    agentsById.set(agent.id, agent);
  }

  return Array.from(agentsById.values());
}

/**
 * Complete-or-fail discovery for the authenticated organization directory.
 * Generic agent discovery intentionally remains best-effort; this sibling
 * avoids its N+1 manifest reads and never reports a failed authoritative
 * layer as a successful partial directory.
 */
export async function discoverOrgDirectoryAgents(
  selfAppId?: string,
  options?: { preferLocalUrls?: boolean },
): Promise<OrgDirectoryDiscoveryResult> {
  const agentsById = new Map<string, DiscoveredAgent>();
  for (const agent of getBuiltinAgents(selfAppId, options)) {
    agentsById.set(agent.id, agent);
  }

  const [remoteResources, workspaceAgents] = await Promise.all([
    readDirectorySource("remote-manifests", readStrictRemoteAgentResources),
    readDirectorySource("workspace-metadata", () =>
      discoverWorkspaceAgents(selfAppId, options, true),
    ),
  ]);
  if (remoteResources.status === "unavailable") {
    return remoteResources;
  }
  if (workspaceAgents.status === "unavailable") {
    return workspaceAgents;
  }
  const remoteOverlay = await readDirectorySource("remote-manifests", () =>
    overlayRemoteAgentResources(
      agentsById,
      remoteResources.value,
      selfAppId,
      options,
    ),
  );
  if (remoteOverlay.status === "unavailable") return remoteOverlay;
  for (const agent of workspaceAgents.value) agentsById.set(agent.id, agent);
  return { status: "available", agents: Array.from(agentsById.values()) };
}

async function readDirectorySource<T>(
  reason: "remote-manifests" | "workspace-metadata",
  read: () => Promise<T>,
): Promise<
  | { status: "available"; value: T }
  | { status: "unavailable"; reason: typeof reason }
> {
  try {
    return { status: "available", value: await read() };
  } catch {
    return { status: "unavailable", reason };
  }
}

async function readStrictRemoteAgentResources(): Promise<
  Array<{ id: string; path: string; owner: string; content: string }>
> {
  const {
    resourceListContentByOwnersAndPrefixes,
    SHARED_OWNER,
    sharedResourceOwner,
  } = await import("../resources/store.js");
  const { REMOTE_AGENT_RESOURCE_PREFIXES } =
    await import("../resources/metadata.js");
  const activeOwner = sharedResourceOwner(getRequestOrgId());
  const owners = [...new Set([SHARED_OWNER, activeOwner])];
  const prefixes = [...REMOTE_AGENT_RESOURCE_PREFIXES].reverse();
  const ownerRank = new Map(owners.map((owner, index) => [owner, index]));
  const prefixRank = (pathValue: string) =>
    prefixes.findIndex((prefix) => pathValue.startsWith(prefix));
  const resources = await resourceListContentByOwnersAndPrefixes(
    owners,
    prefixes,
  );
  resources.sort((a, b) => {
    const ownerDelta =
      (ownerRank.get(a.owner) ?? -1) - (ownerRank.get(b.owner) ?? -1);
    if (ownerDelta !== 0) return ownerDelta;
    const prefixDelta = prefixRank(a.path) - prefixRank(b.path);
    if (prefixDelta !== 0) return prefixDelta;
    return a.path.localeCompare(b.path);
  });
  return resources;
}

async function overlayRemoteAgentResources(
  agentsById: Map<string, DiscoveredAgent>,
  resources: Array<{ id: string; path: string; content: string }>,
  selfAppId?: string,
  options?: { preferLocalUrls?: boolean },
): Promise<void> {
  const { isRemoteAgentPath, parseRemoteAgentManifest } =
    await import("../resources/metadata.js");
  for (const resource of resources) {
    if (!isRemoteAgentPath(resource.path)) continue;
    const manifest = parseRemoteAgentManifest(resource.content, resource.path);
    if (!manifest) {
      throw new Error(`Invalid remote agent manifest: ${resource.path}`);
    }
    if (
      typeof manifest.id !== "string" ||
      !manifest.id.trim() ||
      typeof manifest.name !== "string" ||
      !manifest.name.trim() ||
      typeof manifest.url !== "string" ||
      !isAbsoluteHttpUrl(manifest.url)
    ) {
      throw new Error(`Invalid remote agent manifest: ${resource.path}`);
    }
    if (!shouldIncludeRemoteAgentManifest(manifest, selfAppId)) continue;
    const manifestId = normalizeAgentId(manifest.id);
    let url = manifest.url;
    const builtin = agentsById.get(manifestId);
    if (isHostedRuntime() && isLoopbackUrl(url)) {
      if (builtin?.url) url = builtin.url;
      else continue;
    }
    if (
      options?.preferLocalUrls &&
      builtin &&
      BUILTIN_AGENTS.some((candidate) => candidate.id === manifestId)
    ) {
      url = builtin.url;
    }
    const isLegacyAssetsManifest =
      manifest.id.trim().toLowerCase() !== manifestId;
    if (isLegacyAssetsManifest && builtin?.url) {
      try {
        if (new URL(url).hostname === "images.agent-native.com") {
          url = builtin.url;
        }
      } catch {
        url = builtin.url;
      }
    }
    agentsById.set(manifestId, {
      id: manifestId,
      name:
        isLegacyAssetsManifest && builtin?.name ? builtin.name : manifest.name,
      description: manifest.description || "",
      url,
      // guard:allow-raw-color — agent manifests require a portable color value, not a UI theme token.
      color: manifest.color || builtin?.color || "#6B7280",
    });
  }
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    // coercion-ok: malformed URLs and non-HTTP URLs are the same invalid-manifest outcome.
    return false;
  }
}

/**
 * Look up a single agent by ID or name (case-insensitive).
 */
export async function findAgent(
  idOrName: string,
  selfAppId?: string,
): Promise<DiscoveredAgent | undefined> {
  const lower = normalizeAgentId(idOrName);
  const agents = await discoverAgents(selfAppId);
  return agents.find((a) => a.id === lower || a.name.toLowerCase() === lower);
}

function hostnameFromUrlLike(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    try {
      return new URL(`http://${value}`).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
}

function isLoopbackUrl(value: string | undefined): boolean {
  const hostname = hostnameFromUrlLike(value);
  if (!hostname) return false;
  const normalized = hostname.replace(/^\[|\]$/g, "");
  if (
    normalized === "localhost" ||
    normalized.startsWith("127.") ||
    normalized === "0.0.0.0" ||
    normalized === "::1"
  ) {
    return true;
  }

  const mapped = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!mapped) return false;
  return Number.parseInt(mapped[1], 16) >>> 8 === 0x7f;
}

function hasPublicRuntimeUrl(): boolean {
  // Intentionally omit generic `URL` / `DEPLOY_URL` here. Platforms that set
  // those also expose a stronger hosted signal (for example `NETLIFY`), while
  // local shells and unrelated tools can use generic URL vars for other work.
  const keys = [
    "WORKSPACE_GATEWAY_URL",
    "VITE_WORKSPACE_GATEWAY_URL",
    "APP_URL",
    "WORKSPACE_OAUTH_ORIGIN",
    "VITE_WORKSPACE_OAUTH_ORIGIN",
    "BETTER_AUTH_URL",
    "VITE_BETTER_AUTH_URL",
    "VERCEL_URL",
    "VERCEL_PROJECT_PRODUCTION_URL",
  ];

  return keys.some((key) => {
    const value = process.env[key];
    return !!value && !isLoopbackUrl(value);
  });
}

function isHostedRuntime(): boolean {
  if (process.env.NETLIFY_LOCAL === "true") return false;
  return (
    process.env.NODE_ENV === "production" ||
    !!process.env.NETLIFY ||
    !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
    !!process.env.VERCEL ||
    "__cf_env" in globalThis ||
    "__env__" in globalThis ||
    hasPublicRuntimeUrl()
  );
}

function shouldUseLocalAgentUrls(): boolean {
  return !isHostedRuntime();
}

function resolveAgentUrl(app: AgentEntry, preferLocalUrls = false): string {
  if (preferLocalUrls || shouldUseLocalAgentUrls()) {
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
  strict = false,
): WorkspaceAppManifestEntry[] | null {
  const rawApps = Array.isArray(parsed?.apps)
    ? parsed.apps
    : Array.isArray(parsed)
      ? parsed
      : null;
  if (!rawApps) {
    if (strict) throw new Error("Invalid workspace apps manifest");
    return null;
  }

  const parsedApps = (rawApps as unknown[]).map(
    (entry): WorkspaceAppManifestEntry | null => {
      if (!entry || typeof entry !== "object") return null;
      const e = entry as Record<string, unknown>;
      const rawId = typeof e.id === "string" ? e.id.trim() : "";
      const id = rawId ? normalizeAgentId(rawId) : "";
      const pathValue = typeof e.path === "string" ? e.path.trim() : "";
      if (!id || !pathValue.startsWith("/")) return null;
      return {
        id,
        name:
          typeof e.name === "string" && e.name.trim()
            ? e.name.trim()
            : titleCase(id),
        description: typeof e.description === "string" ? e.description : "",
        path: pathValue,
        url: typeof e.url === "string" && e.url.trim() ? e.url.trim() : null,
        isDispatch:
          typeof e.isDispatch === "boolean" ? e.isDispatch : id === "dispatch",
        audience:
          e.audience === undefined
            ? DEFAULT_WORKSPACE_APP_AUDIENCE
            : normalizeWorkspaceAppAudience(e.audience),
        publicPaths: normalizeWorkspaceAppPathList(e.publicPaths),
        protectedPaths: normalizeWorkspaceAppPathList(e.protectedPaths),
      };
    },
  );
  if (strict && parsedApps.some((app) => app === null)) {
    throw new Error("Invalid workspace app manifest entry");
  }
  const apps = parsedApps
    .filter((app): app is WorkspaceAppManifestEntry => app !== null)
    .sort((a, b) => {
      if (a.id === "dispatch") return -1;
      if (b.id === "dispatch") return 1;
      return a.name.localeCompare(b.name);
    });

  return apps.length ? apps : null;
}

function readWorkspaceAppsFromEnv(
  strict = false,
): WorkspaceAppManifestEntry[] | null {
  const raw = process.env[WORKSPACE_APPS_ENV_KEY];
  if (!raw) return null;
  try {
    return parseWorkspaceAppsManifest(JSON.parse(raw), strict);
  } catch {
    if (strict) throw new Error("Invalid workspace apps environment manifest");
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

function readWorkspaceAppsFromManifestFile(
  strict = false,
): WorkspaceAppManifestEntry[] | null {
  for (const file of workspaceAppsManifestCandidates()) {
    if (!fs.existsSync(file)) continue;
    const apps = parseWorkspaceAppsManifest(readJson(file), strict);
    if (apps) return apps;
  }
  return null;
}

function readWorkspaceAppsFromFilesystem(
  strict = false,
): WorkspaceAppManifestEntry[] | null {
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
      if (!pkg) {
        if (strict) throw new Error(`Invalid workspace package: ${entry.name}`);
        return null;
      }
      const routeAccess = workspaceAppRouteAccessFromPackageJson(pkg);
      return {
        id: normalizeAgentId(entry.name),
        name: pkg.displayName || titleCase(entry.name),
        description: pkg.description || "",
        path: `/${entry.name}`,
        isDispatch: normalizeAgentId(entry.name) === "dispatch",
        audience:
          workspaceAppAudienceFromPackageJson(pkg) ??
          DEFAULT_WORKSPACE_APP_AUDIENCE,
        publicPaths: routeAccess.publicPaths ?? [],
        protectedPaths: routeAccess.protectedPaths ?? [],
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
  const config = getAppConfig();
  // `URL` / `DEPLOY_URL` stay raw: they are platform facts, not app config.
  return (
    config.workspace.gatewayUrl ??
    config.app.url ??
    process.env.URL ??
    process.env.DEPLOY_URL ??
    null
  );
}

function workspaceAppUrl(
  app: WorkspaceAppManifestEntry,
  hostedLoopbackFallbackUrl?: string,
): string | null {
  if (app.url) {
    if (!isHostedRuntime() || !isLoopbackUrl(app.url)) return app.url;
    if (hostedLoopbackFallbackUrl) return hostedLoopbackFallbackUrl;
  }
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
  options?: { preferLocalUrls?: boolean },
  strictMetadata = false,
): Promise<DiscoveredAgent[]> {
  const workspaceApps = loadWorkspaceAppsManifest(strictMetadata);
  if (!workspaceApps) return [];

  const metadataSettings =
    await readWorkspaceAppMetadataSettingsInternal(strictMetadata);

  const normalizedSelfAppId = selfAppId ? normalizeAgentId(selfAppId) : "";

  return workspaceApps
    .filter((app) => normalizeAgentId(app.id) !== normalizedSelfAppId)
    .map((app) => {
      const withOverride = applyWorkspaceAppMetadataOverride(
        app,
        metadataSettings,
      );
      const builtin = BUILTIN_AGENTS.find(
        (agent) => agent.id === withOverride.id,
      );
      const url =
        options?.preferLocalUrls && builtin
          ? resolveAgentUrl(builtin, true)
          : workspaceAppUrl(withOverride, builtin?.url);
      if (strictMetadata && (!url || !isAbsoluteHttpUrl(url))) {
        throw new Error(`Invalid workspace app URL: ${withOverride.id}`);
      }
      if (!url) return null;
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

/** Resolve only the Dispatch app designated by the receiver's own manifest. */
export function findWorkspaceDispatchAgent(): DiscoveredAgent | undefined {
  const app = loadWorkspaceAppsManifest()?.find(
    (candidate) => candidate.isDispatch === true,
  );
  if (!app) return undefined;

  const builtin = BUILTIN_AGENTS.find((agent) => agent.id === "dispatch");
  const url = workspaceAppUrl(app, builtin?.url);
  if (!url) return undefined;
  return {
    id: app.id,
    name: app.name,
    description:
      app.description ||
      builtin?.description ||
      `Workspace app mounted at ${app.path}`,
    url,
    color: builtin?.color || "#6B7280",
  };
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
