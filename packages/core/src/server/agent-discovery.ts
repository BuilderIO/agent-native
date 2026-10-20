import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TEMPLATES } from "../cli/templates-meta.js";
import type {
  RemoteAgentAuth,
  RemoteAgentKind,
} from "../resources/metadata.js";
import {
  parseAgentProfileMetadataFields,
  parseAgentProfileMetadata,
  type AgentProfileMetadata,
} from "../shared/agent-profile.js";
import {
  HIDDEN_FIRST_PARTY_AGENT_IDS,
  isBuiltinAgentCatalogId,
  normalizeAgentId,
} from "../shared/first-party-agents.js";
import {
  DEFAULT_WORKSPACE_APP_AUDIENCE,
  normalizeWorkspaceAppAudience,
  normalizeWorkspaceAppHomePath,
  normalizeWorkspaceAppPathList,
  workspaceAppAudienceFromPackageJson,
  workspaceAppRouteAccessFromPackageJson,
  type WorkspaceAppAudience,
} from "../shared/workspace-app-audience.js";
import {
  inferWorkspaceAppRootHomePath,
  readConfiguredWorkspaceAppHomePath,
} from "../workspace-app-config.js";
import { resolveAppRuntimeUrl } from "./app-url.js";
import {
  readBuiltinAgentsConfig,
  type BuiltinAgentsConfig,
} from "./builtin-agents.js";
import {
  getRequestContext,
  getRequestOrgId,
  getRequestUserEmail,
} from "./request-context.js";
import { findWorkspaceRoot, readJson } from "./workspace-root.js";

export { isBuiltinAgentCatalogId, normalizeAgentId };
export {
  readBuiltinAgentsConfig,
  type BuiltinAgentsConfig,
  type BuiltinAgentsMode,
} from "./builtin-agents.js";

export interface DiscoveredAgent {
  id: string;
  name: string;
  description: string;
  url: string;
  color: string;
  source?: "workspace" | "org-directory" | "remote-agent" | "builtin";
  whenToUse?: string[];
  aliases?: string[];
  cardUrl?: string;
  auth?: RemoteAgentAuth;
  kind?: RemoteAgentKind;
}

export interface DiscoverAgentsOptions {
  preferLocalUrls?: boolean;
  requireReadableAgentSources?: boolean;
  includePersonalAgents?: boolean;
}

export interface DiscoverOrgDirectoryAgentsOptions {
  preferLocalUrls?: boolean;
  /** Filter workspace rows before they can shadow another discoverable source. */
  allowedWorkspaceAppIds?: ReadonlySet<string>;
}

export type OrgDirectoryDiscoveryResult =
  | { status: "available"; agents: DiscoveredAgent[] }
  | {
      status: "unavailable";
      reason: "remote-manifests" | "workspace-metadata";
    };

export type OrgDirectoryStatus =
  | { status: "available" }
  | { status: "unavailable"; reason: string }
  | { status: "forbidden" }
  | { status: "setup-required"; reason: string };

export interface DiscoveredAgentsWithDirectoryStatus {
  agents: DiscoveredAgent[];
  directory: OrgDirectoryStatus;
}

export interface WorkspaceAppMetadataOverride {
  name?: string;
  description?: string;
  whenToUse?: string[];
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

const BUILTIN_AGENT_CATALOG: AgentEntry[] = TEMPLATES.filter(
  (template) => !!template.prodUrl,
).map((template) => ({
  id: template.name,
  name: template.label,
  description: template.description ?? template.hint,
  url: template.prodUrl!,
  devUrl: `http://localhost:${template.devPort}`,
  devPort: template.devPort,
  color: template.color,
}));

const WORKSPACE_APPS_ENV_KEY = "AGENT_NATIVE_WORKSPACE_APPS_JSON";
const WORKSPACE_APPS_MANIFEST_FILE = "workspace-apps.json";
export const WORKSPACE_APP_METADATA_SETTINGS_KEY = "workspace-app-metadata";

export interface WorkspaceAppManifestEntry {
  id: string;
  name: string;
  description: string;
  whenToUse?: string[];
  aliases?: string[];
  path: string;
  homePath: string;
  url?: string | null;
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
  const orgId = input ? (input.orgId ?? null) : (getRequestOrgId() ?? null);
  if (orgId) return `${WORKSPACE_APP_METADATA_SETTINGS_KEY}:org:${orgId}`;

  const userEmail = input
    ? (input.userEmail ?? null)
    : (getRequestUserEmail() ?? null);
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
        (item.generated !== undefined && typeof item.generated !== "boolean") ||
        (item.sourcePrompt !== undefined &&
          typeof item.sourcePrompt !== "string") ||
        (item.updatedAt !== undefined && typeof item.updatedAt !== "string") ||
        (item.updatedBy !== undefined && typeof item.updatedBy !== "string"))
    ) {
      throw new Error("Invalid workspace app metadata fields");
    }
    const profile = parseAgentProfileMetadataFields({
      ...(item.description !== undefined
        ? { description: item.description }
        : {}),
      ...(item.whenToUse !== undefined ? { whenToUse: item.whenToUse } : {}),
    });
    if (strict && profile.invalidFields.length > 0)
      throw new Error("Invalid workspace app profile metadata");
    reportInvalidWorkspaceProfileFields(normalizedId, profile.invalidFields);
    const override: WorkspaceAppMetadataOverride = {};
    const name = cleanOptionalText(item.name);
    const sourcePrompt = cleanOptionalText(item.sourcePrompt);
    const updatedAt = cleanOptionalText(item.updatedAt);
    const updatedBy = cleanOptionalText(item.updatedBy);

    if (name) override.name = name;
    if (profile.metadata.description)
      override.description = profile.metadata.description;
    if (profile.metadata.whenToUse)
      override.whenToUse = profile.metadata.whenToUse;
    else if (
      Array.isArray(item.whenToUse) &&
      item.whenToUse.length === 0 &&
      !profile.invalidFields.includes("whenToUse")
    ) {
      override.whenToUse = [];
    }
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
  identity?: { userEmail?: string | null; orgId?: string | null },
): Promise<WorkspaceAppMetadataSettings> {
  const key = workspaceAppMetadataSettingsKey(identity);
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
  whenToUse?: string[] | null;
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
  const profile = parseAgentProfileMetadata({
    ...(input.description != null ? { description: input.description } : {}),
    ...(input.whenToUse != null ? { whenToUse: input.whenToUse } : {}),
  });
  if (!profile) throw new Error("Invalid workspace app profile metadata");
  const sourcePrompt = cleanOptionalText(input.sourcePrompt);
  const updatedBy = cleanOptionalText(input.updatedBy);

  if (name) next.name = name;
  else delete next.name;
  if (profile.description) next.description = profile.description;
  else delete next.description;
  if (profile.whenToUse) next.whenToUse = profile.whenToUse;
  else delete next.whenToUse;
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
    whenToUse?: string[] | null;
  },
>(app: T, settings: WorkspaceAppMetadataSettings): T {
  const override =
    settings.apps[normalizeAgentId(app.id)] ?? settings.apps[app.id];
  if (!override) return app;

  const name = cleanOptionalText(override.name);
  const parsedProfile = parseAgentProfileMetadataFields({
    ...(override.description !== undefined
      ? { description: override.description }
      : {}),
    ...(override.whenToUse !== undefined
      ? { whenToUse: override.whenToUse }
      : {}),
  });
  if (parsedProfile.invalidFields.length > 0) {
    reportInvalidWorkspaceProfileFields(
      normalizeAgentId(app.id),
      parsedProfile.invalidFields,
    );
  }
  const profile = parsedProfile.metadata;
  const generated = override.generated === true;
  const shouldApplyName = !!name && !generated;
  const shouldApplyDescription =
    !!profile.description &&
    (!generated || !cleanOptionalText(app.description));
  const shouldClearWhenToUse =
    Array.isArray(override.whenToUse) && override.whenToUse.length === 0;
  const shouldApplyWhenToUse =
    shouldClearWhenToUse ||
    (!!profile.whenToUse?.length && (!generated || !app.whenToUse?.length));
  if (!shouldApplyName && !shouldApplyDescription && !shouldApplyWhenToUse) {
    return app;
  }

  return {
    ...app,
    ...(shouldApplyName ? { name } : {}),
    ...(shouldApplyDescription ? { description: profile.description } : {}),
    ...(shouldApplyWhenToUse
      ? { whenToUse: shouldClearWhenToUse ? [] : profile.whenToUse }
      : {}),
  };
}

export async function getWorkspaceAppProfile(
  appId: string,
  identity?: { userEmail?: string | null; orgId?: string | null },
): Promise<AgentProfileMetadata> {
  const normalizedId = normalizeAgentId(appId);
  if (!normalizedId) return {};

  const manifest = await loadWorkspaceAppsManifest();
  const app = manifest?.find(
    (candidate) => normalizeAgentId(candidate.id) === normalizedId,
  );
  const baseProfile = parseAgentProfileMetadata({
    ...(app?.description !== undefined ? { description: app.description } : {}),
    ...(app?.whenToUse !== undefined ? { whenToUse: app.whenToUse } : {}),
    ...(app?.aliases !== undefined ? { aliases: app.aliases } : {}),
  });
  const profile = baseProfile ?? {};
  if (!identity || (!identity.userEmail && !identity.orgId)) return profile;

  const settings = await readWorkspaceAppMetadataSettingsInternal(
    false,
    identity,
  );
  const applied = applyWorkspaceAppMetadataOverride(
    { id: normalizedId, name: "", ...profile },
    settings,
  );
  return {
    ...(applied.description ? { description: applied.description } : {}),
    ...(applied.whenToUse !== undefined
      ? { whenToUse: [...applied.whenToUse] }
      : {}),
    ...(applied.aliases?.length ? { aliases: [...applied.aliases] } : {}),
  };
}

export async function loadWorkspaceAppsManifest(
  strict = false,
): Promise<WorkspaceAppManifestEntry[] | null> {
  return (
    readWorkspaceAppsFromEnv(strict) ??
    readWorkspaceAppsFromManifestFile(strict) ??
    (await readWorkspaceAppsFromFilesystem(strict))
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

function builtinAgentsFor(
  config: BuiltinAgentsConfig,
  selfAppId?: string,
  options?: { preferLocalUrls?: boolean },
): DiscoveredAgent[] {
  const normalizedSelfAppId = selfAppId ? normalizeAgentId(selfAppId) : "";
  const useLocalUrls =
    options?.preferLocalUrls === true || shouldUseLocalAgentUrls();
  return BUILTIN_AGENT_CATALOG.filter(
    (app) =>
      config.include.includes(app.id) &&
      app.id !== normalizedSelfAppId &&
      app.url,
  ).map((app) => ({
    id: app.id,
    name: app.name,
    description: app.description,
    url:
      !useLocalUrls && config.urls?.[app.id]
        ? config.urls[app.id]
        : resolveAgentUrl(app, options?.preferLocalUrls),
    color: app.color,
    source: "builtin" as const,
  }));
}

/** Built-ins the workspace builder offers (`agent-native.builtinAgents`). */
export function getBuiltinAgents(
  selfAppId?: string,
  options?: { preferLocalUrls?: boolean },
): DiscoveredAgent[] {
  return builtinAgentsFor(readBuiltinAgentsConfig(), selfAppId, options);
}

function isUnofferedBuiltinManifest(
  manifestId: string,
  offeredBuiltinIds: ReadonlySet<string>,
): boolean {
  return (
    isBuiltinAgentCatalogId(manifestId) && !offeredBuiltinIds.has(manifestId)
  );
}

function resolveRemoteAgentManifestUrl(
  manifestId: string,
  rawManifestId: string,
  manifestUrl: string,
  builtin: DiscoveredAgent | undefined,
  options?: { preferLocalUrls?: boolean },
): { url: string; isLegacyAliasManifest: boolean } | undefined {
  const catalogBuiltin = BUILTIN_AGENT_CATALOG.find(
    (candidate) => candidate.id === manifestId,
  );
  const hosted = isHostedRuntime();
  let url = manifestUrl;

  if (hosted && isLoopbackUrl(url)) {
    if (builtin?.url) url = builtin.url;
    else return undefined;
  }

  if (catalogBuiltin && builtin && manifestUrl === catalogBuiltin.url) {
    url = builtin.url;
  }

  if (options?.preferLocalUrls && builtin && catalogBuiltin) {
    url = builtin.url;
  }

  const isLegacyAliasManifest =
    rawManifestId.trim().toLowerCase() !== manifestId;
  if (isLegacyAliasManifest && builtin?.url) {
    try {
      const hostname = new URL(url).hostname;
      const legacyHost =
        rawManifestId.trim().toLowerCase() === "videos" &&
        manifestId === "clips"
          ? "videos.agent-native.com"
          : "images.agent-native.com";
      if (hostname === legacyHost) {
        url = builtin.url;
      }
    } catch {
      url = builtin.url;
    }
  }

  return { url, isLegacyAliasManifest };
}

export async function discoverAgents(
  selfAppId?: string,
  options?: DiscoverAgentsOptions,
): Promise<DiscoveredAgent[]> {
  return (await discoverAgentsWithDirectoryStatus(selfAppId, options)).agents;
}

export async function discoverAgentsWithDirectoryStatus(
  selfAppId?: string,
  options?: DiscoverAgentsOptions,
): Promise<DiscoveredAgentsWithDirectoryStatus> {
  const builtins = getBuiltinAgents(selfAppId, options);
  const offeredBuiltinIds = new Set(builtins.map((agent) => agent.id));
  const agentsById = new Map<string, DiscoveredAgent>();

  for (const agent of builtins) {
    mergeDiscoveredAgent(agentsById, agent);
  }

  try {
    const { resourceList, resourceGet, SHARED_OWNER, sharedResourceOwner } =
      await import("../resources/store.js");

    const { parseRemoteAgentManifest, REMOTE_AGENT_RESOURCE_PREFIXES } =
      await import("../resources/metadata.js");

    const activeOwner = sharedResourceOwner(getRequestOrgId());
    const userEmail = options?.includePersonalAgents
      ? getRequestContext()?.userEmail
      : undefined;
    const owners = [
      ...new Set([
        ...(options?.includePersonalAgents && userEmail ? [userEmail] : []),
        SHARED_OWNER,
        activeOwner,
      ]),
    ];
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
      let full: Awaited<ReturnType<typeof resourceGet>>;
      try {
        full = await resourceGet(r.id);
      } catch (error) {
        if (options?.requireReadableAgentSources) throw error;
        continue;
      }
      if (!full) {
        if (options?.requireReadableAgentSources) {
          throw new Error(`Connected agent resource disappeared: ${r.path}`);
        }
        continue;
      }
      try {
        const manifest = parseRemoteAgentManifest(full.content, r.path);
        if (!manifest) {
          console.warn(
            "[agent-discovery] skipped invalid remote agent manifest",
            {
              path: r.path.slice(0, 160),
            },
          );
          continue;
        }
        if (!shouldIncludeRemoteAgentManifest(manifest, selfAppId)) continue;
        const manifestId = normalizeAgentId(manifest.id);
        if (isUnofferedBuiltinManifest(manifestId, offeredBuiltinIds)) continue;

        const builtin = agentsById.get(manifestId);
        const resolved = resolveRemoteAgentManifestUrl(
          manifestId,
          manifest.id,
          manifest.url,
          builtin,
          options,
        );
        if (!resolved) continue;
        const { url, isLegacyAliasManifest } = resolved;

        mergeDiscoveredAgent(agentsById, {
          id: manifestId,
          name:
            isLegacyAliasManifest && builtin?.name
              ? builtin.name
              : manifest.name,
          description: manifest.description || "",
          url,
          color: manifest.color || builtin?.color || "#6B7280",
          source: "remote-agent",
          ...(manifest.whenToUse?.length
            ? { whenToUse: [...manifest.whenToUse] }
            : {}),
          ...(manifest.aliases?.length
            ? { aliases: [...manifest.aliases] }
            : {}),
          ...(manifest.cardUrl ? { cardUrl: manifest.cardUrl } : {}),
          ...(manifest.auth ? { auth: manifest.auth } : {}),
          ...(manifest.kind ? { kind: manifest.kind } : {}),
        });
      } catch (error) {
        if (options?.requireReadableAgentSources) throw error;
        // Skip unreadable resources
      }
    }
  } catch (error) {
    if (options?.requireReadableAgentSources) {
      throw new Error("Unable to read connected agent resources", {
        cause: error,
      });
    }
    // Resources not available — use built-ins only
  }

  const orgDirectory = await discoverOrgDirectoryApps(selfAppId);
  if (orgDirectory.status === "available") {
    for (const app of orgDirectory.apps) {
      const id = normalizeAgentId(app.id);
      const appDescription =
        (typeof app.description === "string" && app.description.trim()) ||
        (typeof app.capabilities?.[0] === "string" &&
          app.capabilities[0].trim()) ||
        undefined;
      const profile = parseAgentProfileMetadataFields({
        ...(appDescription ? { description: appDescription } : {}),
        ...(app.whenToUse !== undefined ? { whenToUse: app.whenToUse } : {}),
        ...(app.aliases !== undefined ? { aliases: app.aliases } : {}),
      });
      reportInvalidWorkspaceProfileFields(id, profile.invalidFields);
      mergeDiscoveredAgent(agentsById, {
        id,
        name: app.name,
        description: profile.metadata.description ?? "",
        url: app.url,
        // guard:allow-raw-color — discovered agents require a portable color value, not a UI theme token.
        color: agentsById.get(id)?.color ?? "#6B7280",
        source: "org-directory",
        ...(profile.metadata.whenToUse?.length
          ? { whenToUse: [...profile.metadata.whenToUse] }
          : {}),
        ...(profile.metadata.aliases?.length
          ? { aliases: [...profile.metadata.aliases] }
          : {}),
      });
    }
  }

  for (const agent of await discoverWorkspaceAgents(
    selfAppId,
    options,
    options?.requireReadableAgentSources === true,
  )) {
    mergeDiscoveredAgent(agentsById, agent);
  }

  return {
    agents: Array.from(agentsById.values()),
    directory:
      orgDirectory.status === "available"
        ? { status: "available" }
        : orgDirectory,
  };
}

export async function discoverOrgDirectoryAgents(
  selfAppId?: string,
  options?: DiscoverOrgDirectoryAgentsOptions,
): Promise<OrgDirectoryDiscoveryResult> {
  const agentsById = new Map<string, DiscoveredAgent>();
  for (const agent of getBuiltinAgents(selfAppId, options)) {
    agentsById.set(agent.id, agent);
  }
  const offeredBuiltinIds = new Set(agentsById.keys());

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
      offeredBuiltinIds,
      remoteResources.value,
      selfAppId,
      options,
    ),
  );
  if (remoteOverlay.status === "unavailable") return remoteOverlay;
  const allowedWorkspaceAppIds = options?.allowedWorkspaceAppIds
    ? new Set([...options.allowedWorkspaceAppIds].map(normalizeAgentId))
    : undefined;
  for (const agent of workspaceAgents.value) {
    if (
      allowedWorkspaceAppIds &&
      !allowedWorkspaceAppIds.has(normalizeAgentId(agent.id))
    ) {
      continue;
    }
    mergeDiscoveredAgent(agentsById, agent);
  }
  return { status: "available", agents: Array.from(agentsById.values()) };
}

const AGENT_SOURCE_PRIORITY: Record<
  NonNullable<DiscoveredAgent["source"]>,
  number
> = {
  workspace: 0,
  "org-directory": 1,
  "remote-agent": 2,
  builtin: 3,
};

function agentSourcePriority(agent: DiscoveredAgent): number {
  return AGENT_SOURCE_PRIORITY[agent.source ?? "builtin"];
}

function canonicalAgentTargetUrl(value: string): string | null {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    let pathname = url.pathname.replace(/\/+$/, "");
    if (pathname.endsWith("/_agent-native/a2a")) {
      pathname = pathname.slice(0, -"/_agent-native/a2a".length);
    } else if (pathname.endsWith("/a2a")) {
      pathname = pathname.slice(0, -"/a2a".length);
    }
    url.pathname = pathname || "/";
    return url.toString().replace(/\/$/, "");
  } catch {
    // coercion-ok: Invalid targets cannot be treated as the same A2A identity.
    return null;
  }
}

function qualifiedCollisionAlias(
  agent: DiscoveredAgent,
): DiscoveredAgent | undefined {
  try {
    const authority = new URL(agent.url).host.toLowerCase();
    if (!authority) return undefined;
    return {
      ...agent,
      id: `${authority}/${normalizeAgentId(agent.id)}`,
      name: `${agent.name} (${authority})`,
    };
  } catch {
    // coercion-ok: Invalid target URLs cannot be used to qualify a collision alias.
    return undefined;
  }
}

function mergeDiscoveredAgent(
  agentsById: Map<string, DiscoveredAgent>,
  candidate: DiscoveredAgent,
): void {
  const id = normalizeAgentId(candidate.id);
  const normalizedCandidate =
    candidate.id === id ? candidate : { ...candidate, id };
  const existing = agentsById.get(id);
  if (!existing) {
    agentsById.set(id, normalizedCandidate);
    return;
  }

  const existingTarget = canonicalAgentTargetUrl(existing.url);
  const candidateTarget = canonicalAgentTargetUrl(normalizedCandidate.url);
  if (existingTarget && existingTarget === candidateTarget) {
    if (
      agentSourcePriority(normalizedCandidate) < agentSourcePriority(existing)
    ) {
      agentsById.set(id, normalizedCandidate);
    }
    return;
  }

  const candidateWins =
    agentSourcePriority(normalizedCandidate) <= agentSourcePriority(existing);
  const winner = candidateWins ? normalizedCandidate : existing;
  const loser = candidateWins ? existing : normalizedCandidate;
  agentsById.set(id, winner);

  const alias = qualifiedCollisionAlias(loser);
  if (alias && alias.id !== id && !agentsById.has(alias.id)) {
    agentsById.set(alias.id, alias);
  }
}

async function discoverOrgDirectoryApps(selfAppId?: string): Promise<
  | {
      status: "available";
      apps: Array<{
        id: string;
        name: string;
        url: string;
        capabilities?: string[];
        description?: string;
        whenToUse?: string[];
        aliases?: string[];
      }>;
    }
  | { status: "unavailable"; reason: string }
  | { status: "forbidden" }
  | { status: "setup-required"; reason: string }
> {
  const selfId = selfAppId ? normalizeAgentId(selfAppId) : undefined;
  try {
    const { fetchOrgAppsResult, resolveOrgDirectoryOrigin } =
      await import("../mcp/org-directory.js");
    const configuredBaseUrl = resolveOrgDirectoryOrigin();
    let result = await fetchOrgAppsResult({ selfId });
    let baseUrl = configuredBaseUrl;

    if (result.status === "unavailable" && result.reason === "not-configured") {
      const orgId = getRequestOrgId();
      if (!orgId) {
        return {
          status: "setup-required",
          reason: "organization-not-selected",
        };
      }
      const { getOrgWorkspaceUrl } = await import("../org/context.js");
      const workspaceUrl = await getOrgWorkspaceUrl(orgId);
      if (!workspaceUrl) {
        return { status: "setup-required", reason: "workspace-url-not-set" };
      }
      let workspaceOrigin: string;
      try {
        const parsed = new URL(workspaceUrl);
        if (
          (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
          parsed.username ||
          parsed.password ||
          parsed.search ||
          parsed.hash ||
          (parsed.pathname !== "/" && parsed.pathname !== "")
        ) {
          return { status: "setup-required", reason: "invalid-workspace-url" };
        }
        workspaceOrigin = parsed.origin;
      } catch {
        return { status: "setup-required", reason: "invalid-workspace-url" };
      }
      baseUrl = `${workspaceOrigin}/dispatch`;
      result = await fetchOrgAppsResult({ directoryBaseUrl: baseUrl, selfId });
    }

    if (
      result.status === "unavailable" &&
      result.reason === "missing-route" &&
      baseUrl
    ) {
      const rootUrl = new URL(baseUrl).origin;
      if (rootUrl !== baseUrl.replace(/\/+$/, "")) {
        result = await fetchOrgAppsResult({
          directoryBaseUrl: rootUrl,
          selfId,
        });
      }
    }

    if (result.status === "available") return result;
    if (result.reason === "authorization") return { status: "forbidden" };
    if (
      result.reason === "not-configured" ||
      result.reason === "invalid-origin"
    ) {
      return { status: "setup-required", reason: result.reason };
    }
    return { status: "unavailable", reason: result.reason };
  } catch (error) {
    return {
      status: "unavailable",
      reason: error instanceof Error ? error.name : "discovery-error",
    };
  }
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
  const orgId = getRequestOrgId() ?? null;
  const activeOwner = sharedResourceOwner(orgId);
  const owners = [...new Set([SHARED_OWNER, activeOwner])];
  const prefixes = [...REMOTE_AGENT_RESOURCE_PREFIXES].reverse();
  const ownerRank = new Map(owners.map((owner, index) => [owner, index]));
  const prefixRank = (pathValue: string) =>
    prefixes.findIndex((prefix) => pathValue.startsWith(prefix));
  const resources = await resourceListContentByOwnersAndPrefixes(
    owners,
    prefixes,
    { orgId },
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
  offeredBuiltinIds: ReadonlySet<string>,
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
      console.warn("[agent-discovery] skipped invalid remote agent manifest", {
        path: resource.path.slice(0, 160),
      });
      continue;
    }
    if (
      typeof manifest.id !== "string" ||
      !manifest.id.trim() ||
      typeof manifest.name !== "string" ||
      !manifest.name.trim() ||
      typeof manifest.url !== "string" ||
      !isAbsoluteHttpUrl(manifest.url)
    ) {
      console.warn("[agent-discovery] skipped invalid remote agent manifest", {
        path: resource.path.slice(0, 160),
      });
      continue;
    }
    if (!shouldIncludeRemoteAgentManifest(manifest, selfAppId)) continue;
    const manifestId = normalizeAgentId(manifest.id);
    if (isUnofferedBuiltinManifest(manifestId, offeredBuiltinIds)) continue;
    const builtin = agentsById.get(manifestId);
    const resolved = resolveRemoteAgentManifestUrl(
      manifestId,
      manifest.id,
      manifest.url,
      builtin,
      options,
    );
    if (!resolved) continue;
    const { url, isLegacyAliasManifest } = resolved;
    mergeDiscoveredAgent(agentsById, {
      id: manifestId,
      name:
        isLegacyAliasManifest && builtin?.name ? builtin.name : manifest.name,
      description: manifest.description || "",
      url,
      // guard:allow-raw-color — agent manifests require a portable color value, not a UI theme token.
      color: manifest.color || builtin?.color || "#6B7280",
      source: "remote-agent",
      ...(manifest.whenToUse?.length
        ? { whenToUse: [...manifest.whenToUse] }
        : {}),
      ...(manifest.aliases?.length ? { aliases: [...manifest.aliases] } : {}),
      ...(manifest.cardUrl ? { cardUrl: manifest.cardUrl } : {}),
      ...(manifest.auth ? { auth: manifest.auth } : {}),
      ...(manifest.kind ? { kind: manifest.kind } : {}),
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

export async function findAgent(
  idOrName: string,
  selfAppId?: string,
  options?: DiscoverAgentsOptions,
): Promise<DiscoveredAgent | undefined> {
  let agents: DiscoveredAgent[];
  try {
    agents = await discoverAgents(selfAppId, options);
  } catch (error) {
    if (!options?.requireReadableAgentSources) throw error;

    const workspaceAgents = await discoverWorkspaceAgents(
      selfAppId,
      options,
      true,
    );
    const workspaceAgent = findAgentInList(idOrName, workspaceAgents);
    if (workspaceAgent) return workspaceAgent;
    throw error;
  }

  return findAgentInList(idOrName, agents);
}

function findAgentInList(
  idOrName: string,
  agents: DiscoveredAgent[],
): DiscoveredAgent | undefined {
  const handle = normalizeAgentHandle(idOrName);
  if (!handle) return undefined;
  const matches = new Map<string, DiscoveredAgent>();
  for (const agent of agents) {
    const handles = [agent.id, agent.name, ...(agent.aliases ?? [])];
    if (
      handles.some((candidate) => normalizeAgentHandle(candidate) === handle)
    ) {
      matches.set(agent.id, agent);
    }
  }
  return matches.size === 1 ? matches.values().next().value : undefined;
}

function normalizeAgentHandle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
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
  const keys = [
    "WORKSPACE_GATEWAY_URL",
    "VITE_WORKSPACE_GATEWAY_URL",
    "APP_URL",
    "WORKSPACE_OAUTH_ORIGIN",
    "VITE_WORKSPACE_OAUTH_ORIGIN",
    "BETTER_AUTH_URL",
    "VITE_BETTER_AUTH_URL",
    "VERCEL_URL",
    "VERCEL_BRANCH_URL",
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

let frameworkMonorepoCache: { cwd: string; value: boolean } | undefined;

// Only the framework checkout runs every first-party template on its dev
// port; any other local workspace must reach built-ins at their prod URLs.
function isFrameworkMonorepo(): boolean {
  let cwd: string;
  try {
    cwd = process.cwd();
  } catch {
    // coercion-ok: runtimes without a cwd are never the framework checkout.
    return false;
  }
  if (frameworkMonorepoCache?.cwd === cwd) return frameworkMonorepoCache.value;
  let value = false;
  let dir = path.resolve(cwd);
  for (let i = 0; i < 20; i++) {
    if (
      fs.existsSync(
        path.join(dir, "packages/core/src/server/agent-discovery.ts"),
      ) &&
      fs.existsSync(path.join(dir, "templates"))
    ) {
      value = true;
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  frameworkMonorepoCache = { cwd, value };
  return value;
}

function shouldUseLocalAgentUrls(): boolean {
  return !isHostedRuntime() && isFrameworkMonorepo();
}

function resolveAgentUrl(app: AgentEntry, preferLocalUrls = false): string {
  if (preferLocalUrls || shouldUseLocalAgentUrls()) {
    return app.devUrl || `http://localhost:${app.devPort}`;
  }
  return app.url;
}

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function reportInvalidWorkspaceProfileFields(
  appId: string,
  fields: readonly string[],
): void {
  if (fields.length === 0) return;
  console.warn(
    "[agent-discovery] ignored invalid workspace app profile fields",
    {
      appId: appId.slice(0, 120),
      fields,
    },
  );
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
      const rawAgentNative = e["agent-native"];
      const invalidProfileContainer =
        rawAgentNative !== undefined &&
        (!rawAgentNative ||
          typeof rawAgentNative !== "object" ||
          Array.isArray(rawAgentNative));
      const agentNative =
        rawAgentNative &&
        typeof rawAgentNative === "object" &&
        !Array.isArray(rawAgentNative)
          ? (rawAgentNative as Record<string, unknown>)
          : undefined;
      const rawWhenToUse =
        agentNative && "whenToUse" in agentNative
          ? agentNative.whenToUse
          : e.whenToUse;
      const rawAliases =
        agentNative && "aliases" in agentNative
          ? agentNative.aliases
          : e.aliases;
      const parsedProfile = parseAgentProfileMetadataFields({
        ...(e.description !== undefined ? { description: e.description } : {}),
        ...(rawWhenToUse !== undefined ? { whenToUse: rawWhenToUse } : {}),
        ...(rawAliases !== undefined ? { aliases: rawAliases } : {}),
      });
      reportInvalidWorkspaceProfileFields(id, [
        ...(invalidProfileContainer ? ["agent-native"] : []),
        ...parsedProfile.invalidFields,
      ]);
      const profile = parsedProfile.metadata;
      return {
        id,
        name:
          typeof e.name === "string" && e.name.trim()
            ? e.name.trim()
            : titleCase(id),
        description: profile.description ?? "",
        ...(profile.whenToUse?.length
          ? { whenToUse: [...profile.whenToUse] }
          : {}),
        ...(profile.aliases?.length ? { aliases: [...profile.aliases] } : {}),
        path: pathValue,
        homePath: normalizeWorkspaceAppHomePath(e.homePath),
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
    let parsed: unknown;
    if (strict) {
      try {
        parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch (error) {
        throw new Error(`Invalid workspace apps manifest file: ${file}`, {
          cause: error,
        });
      }
    } else {
      parsed = readJson(file);
    }
    const apps = parseWorkspaceAppsManifest(parsed, strict);
    if (apps) return apps;
  }
  return null;
}

async function readWorkspaceAppsFromFilesystem(
  strict = false,
): Promise<WorkspaceAppManifestEntry[] | null> {
  const workspaceRoot = findWorkspaceRoot();
  if (!workspaceRoot) return null;
  const appsDir = path.join(workspaceRoot, "apps");
  if (!fs.existsSync(appsDir)) return null;

  const apps: WorkspaceAppManifestEntry[] = [];
  for (const entry of fs
    .readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())) {
    const appDir = path.join(appsDir, entry.name);
    const pkg = readJson(path.join(appDir, "package.json"));
    if (!pkg) {
      if (strict) throw new Error(`Invalid workspace package: ${entry.name}`);
      continue;
    }
    const rawAgentNative = pkg["agent-native"];
    const invalidProfileContainer =
      rawAgentNative !== undefined &&
      (!rawAgentNative ||
        typeof rawAgentNative !== "object" ||
        Array.isArray(rawAgentNative));
    const agentNative =
      rawAgentNative &&
      typeof rawAgentNative === "object" &&
      !Array.isArray(rawAgentNative)
        ? (rawAgentNative as Record<string, unknown>)
        : undefined;
    const parsedProfile = parseAgentProfileMetadataFields({
      ...(pkg.description !== undefined
        ? { description: pkg.description }
        : {}),
      ...(agentNative && "whenToUse" in agentNative
        ? { whenToUse: agentNative.whenToUse }
        : {}),
      ...(agentNative && "aliases" in agentNative
        ? { aliases: agentNative.aliases }
        : {}),
    });
    reportInvalidWorkspaceProfileFields(entry.name, [
      ...(invalidProfileContainer ? ["agent-native"] : []),
      ...parsedProfile.invalidFields,
    ]);
    const profile = parsedProfile.metadata;
    const routeAccess = workspaceAppRouteAccessFromPackageJson(pkg);
    let configuredHomePath: string | undefined;
    let inferredHomePath: "/" | undefined;
    try {
      configuredHomePath = await readConfiguredWorkspaceAppHomePath(appDir);
      if (configuredHomePath === undefined) {
        inferredHomePath = inferWorkspaceAppRootHomePath(appDir);
      }
    } catch (error) {
      if (strict) throw error;
      console.warn(
        `[agent-discovery] Could not discover workspace app ${entry.name}; skipping app`,
        error,
      );
      continue;
    }
    apps.push({
      id: normalizeAgentId(entry.name),
      name: pkg.displayName || titleCase(entry.name),
      description: profile.description ?? "",
      ...(profile.whenToUse?.length
        ? { whenToUse: [...profile.whenToUse] }
        : {}),
      ...(profile.aliases?.length ? { aliases: [...profile.aliases] } : {}),
      path: `/${entry.name}`,
      homePath: normalizeWorkspaceAppHomePath(
        configuredHomePath ?? inferredHomePath,
      ),
      isDispatch: normalizeAgentId(entry.name) === "dispatch",
      audience:
        workspaceAppAudienceFromPackageJson(pkg) ??
        DEFAULT_WORKSPACE_APP_AUDIENCE,
      publicPaths: routeAccess.publicPaths ?? [],
      protectedPaths: routeAccess.protectedPaths ?? [],
    });
  }
  apps.sort((a, b) => {
    if (a.id === "dispatch") return -1;
    if (b.id === "dispatch") return 1;
    return a.name.localeCompare(b.name);
  });

  return apps.length ? apps : null;
}

function workspaceBaseUrl(): string | null {
  return resolveAppRuntimeUrl() ?? null;
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
  strict = false,
): Promise<DiscoveredAgent[]> {
  const workspaceApps = await loadWorkspaceAppsManifest(strict);
  if (!workspaceApps) return [];

  const metadataSettings =
    await readWorkspaceAppMetadataSettingsInternal(strict);

  const normalizedSelfAppId = selfAppId ? normalizeAgentId(selfAppId) : "";

  return workspaceApps
    .filter((app) => normalizeAgentId(app.id) !== normalizedSelfAppId)
    .map((app): DiscoveredAgent | null => {
      const withOverride = applyWorkspaceAppMetadataOverride(
        app,
        metadataSettings,
      );
      const builtin = BUILTIN_AGENT_CATALOG.find(
        (agent) => agent.id === withOverride.id,
      );
      const url =
        options?.preferLocalUrls && builtin
          ? resolveAgentUrl(builtin, true)
          : workspaceAppUrl(withOverride, builtin?.url);
      if (strict && (!url || !isAbsoluteHttpUrl(url))) {
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
        ...(withOverride.whenToUse?.length
          ? { whenToUse: [...withOverride.whenToUse] }
          : {}),
        ...(withOverride.aliases?.length
          ? { aliases: [...withOverride.aliases] }
          : {}),
        url,
        color: builtin?.color || "#6B7280",
        source: "workspace",
      } satisfies DiscoveredAgent;
    })
    .filter((agent): agent is DiscoveredAgent => !!agent);
}

export async function findWorkspaceDispatchAgent(): Promise<
  DiscoveredAgent | undefined
> {
  const app = (await loadWorkspaceAppsManifest())?.find(
    (candidate) => candidate.isDispatch === true,
  );
  if (!app) return undefined;

  const builtin = BUILTIN_AGENT_CATALOG.find(
    (agent) => agent.id === "dispatch",
  );
  const url = workspaceAppUrl(app, builtin?.url);
  if (!url) return undefined;
  return {
    id: app.id,
    name: app.name,
    description:
      app.description ||
      builtin?.description ||
      `Workspace app mounted at ${app.path}`,
    ...(app.whenToUse?.length ? { whenToUse: [...app.whenToUse] } : {}),
    url,
    color: builtin?.color || "#6B7280",
    source: "workspace",
  };
}

export function getBuiltinAgentsForSeeding(): DiscoveredAgent[] {
  const { include } = readBuiltinAgentsConfig();
  return BUILTIN_AGENT_CATALOG.filter(
    (app) => app.url && include.includes(app.id),
  ).map((app) => ({
    id: app.id,
    name: app.name,
    description: app.description,
    url: app.url, // ALWAYS prod
    color: app.color,
    source: "builtin" as const,
  }));
}
