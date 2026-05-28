import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSetting, putSetting } from "@agent-native/core/settings";
import { assertValidWorkspaceAppId } from "@agent-native/core/shared";
import {
  getBuilderBranchProjectId,
  getRequestContext,
  isIntegrationCallerRequest,
  resolveBuilderBranchProjectId,
  resolveBuilderCredentials,
  runBuilderAgent,
} from "@agent-native/core/server";
import { getDbExec } from "@agent-native/core/db";
import {
  currentOrgId,
  currentOwnerEmail,
  recordAudit,
  resolveLinkedOwner,
} from "./dispatch-store.js";
import { identityKeyForIncoming } from "./dispatch-integrations.js";
import { createRequest, listSecrets } from "./vault-store.js";
import {
  grantWorkspaceResourcesToApp,
  listWorkspaceResourceOptions,
  type WorkspaceResourceOption,
} from "./workspace-resources-store.js";

const SETTINGS_KEY = "dispatch-app-creation-settings";
const WORKSPACE_APP_METADATA_SETTINGS_KEY = "workspace-app-metadata";
const WORKSPACE_APPS_ENV_KEY = "AGENT_NATIVE_WORKSPACE_APPS_JSON";
const WORKSPACE_APPS_MANIFEST_FILE = "workspace-apps.json";
const WORKSPACE_APPS_GATEWAY_PATH = "/_workspace/apps";
const WORKSPACE_APPS_GATEWAY_TIMEOUT_MS = 1_000;
const MAX_PENDING_APPS = 50;
const PENDING_WORKSPACE_APP_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const AGENT_CARD_PATH = "/.well-known/agent-card.json";
const AGENT_CARD_FETCH_TIMEOUT_MS = 1_500;
const DEFAULT_WORKSPACE_APP_AUDIENCE = "internal";

type WorkspaceAppAudience = "internal" | "public";

export interface WorkspaceAppSummary {
  id: string;
  name: string;
  description: string;
  path: string;
  url: string | null;
  isDispatch: boolean;
  audience: WorkspaceAppAudience;
  publicPaths: string[];
  protectedPaths: string[];
  status?: "ready" | "pending";
  statusLabel?: string;
  builderUrl?: string | null;
  branchName?: string | null;
  createdAt?: string | null;
  agentCardUrl?: string | null;
  agentCardReachable?: boolean;
  a2aEndpointUrl?: string | null;
  agentName?: string | null;
  agentSkillsCount?: number | null;
  archived?: boolean;
}

export interface ListWorkspaceAppsOptions {
  includeAgentCards?: boolean;
  /**
   * Include apps the current viewer has hidden (archived). Defaults to false
   * so polling/UI callers see only the visible set; the apps page passes true
   * when rendering the "Hidden apps" expander.
   */
  includeArchived?: boolean;
  audience?: WorkspaceAppAudience | "all";
}

export interface AvailableWorkspaceTemplate {
  name: string;
  label: string;
  hint: string;
  icon: string;
  color: string;
  colorRgb: string;
  core: boolean;
}

export interface AppCreationSettings {
  builderProjectId: string | null;
  builderProjectIdSource: "env" | "dispatch" | "default" | "unset";
  envBuilderProjectId: string | null;
  savedBuilderProjectId: string | null;
  builderBranchingEnabled: boolean;
}

export interface WorkspaceInfo {
  /** Slug from the workspace root package.json `name` (e.g. "on-call-todo-manager"). */
  name: string | null;
  /** Title-cased version for display (e.g. "On Call Todo Manager"). */
  displayName: string | null;
  /** Absolute path to the workspace root, if detected. */
  rootPath: string | null;
  /** Number of apps currently scaffolded under apps/. */
  appCount: number;
}

interface PendingWorkspaceApp {
  id: string;
  name: string;
  description: string;
  path: string;
  builderUrl: string | null;
  branchName: string | null;
  projectId: string | null;
  contextId: string | null;
  contextLabel: string | null;
  audience?: WorkspaceAppAudience;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
}

interface WorkspaceAppMetadataOverride {
  name?: string;
  description?: string;
  generated?: boolean;
  sourcePrompt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

interface WorkspaceAppMetadataSettings {
  apps: Record<string, WorkspaceAppMetadataOverride>;
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

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function ensureSentence(value: string): string {
  if (!value) return value;
  const capitalized = value.charAt(0).toUpperCase() + value.slice(1);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

function clipSentence(value: string, max = 180): string {
  if (value.length <= max) return value;
  const clipped = value
    .slice(0, max - 1)
    .replace(/\s+\S*$/, "")
    .trim();
  return `${clipped || value.slice(0, max - 1).trim()}…`;
}

export function generateWorkspaceAppDescription(
  prompt: string,
  appId: string,
): string {
  const cleaned = normalizeWhitespace(prompt)
    .replace(
      /^(please\s+)?(build|create|make|generate|scaffold)\s+(me\s+|us\s+)?/i,
      "",
    )
    .replace(
      /^(an?\s+)?(workspace\s+)?(agent-native\s+)?(app|tool)\s+(that|to|for)\s+/i,
      "",
    )
    .replace(/^(an?\s+)?(dashboard|workspace|agent)\s+(that|to|for)\s+/i, "");

  if (!cleaned) return `Workspace app for ${titleCase(appId)}.`;
  return clipSentence(ensureSentence(cleaned));
}

function scopedSettingsKey(): string {
  const orgId = currentOrgId();
  if (orgId) return `${SETTINGS_KEY}:org:${orgId}`;
  return `${SETTINGS_KEY}:user:${currentOwnerEmail()}`;
}

function workspaceAppMetadataSettingsKey(): string {
  const orgId = currentOrgId();
  if (orgId) return `${WORKSPACE_APP_METADATA_SETTINGS_KEY}:org:${orgId}`;
  return `${WORKSPACE_APP_METADATA_SETTINGS_KEY}:user:${currentOwnerEmail()}`;
}

function cleanOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeContextPart(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function pendingWorkspaceAppContext(): { id: string; label: string } | null {
  const branch =
    cleanOptionalString(process.env.BRANCH) ??
    cleanOptionalString(process.env.HEAD) ??
    cleanOptionalString(process.env.VERCEL_GIT_COMMIT_REF) ??
    cleanOptionalString(process.env.CF_PAGES_BRANCH) ??
    cleanOptionalString(process.env.RENDER_GIT_BRANCH) ??
    cleanOptionalString(process.env.FLY_BRANCH);
  if (branch) {
    const normalized = normalizeContextPart(branch);
    return { id: `branch:${normalized}`, label: `Branch: ${normalized}` };
  }

  const origin =
    cleanOptionalString(process.env.DEPLOY_PRIME_URL) ??
    cleanOptionalString(process.env.DEPLOY_URL) ??
    cleanOptionalString(process.env.URL) ??
    cleanOptionalString(process.env.APP_URL) ??
    cleanOptionalString(process.env.BETTER_AUTH_URL) ??
    cleanOptionalString(process.env.WORKSPACE_GATEWAY_URL);
  if (!origin) return null;

  try {
    const parsed = new URL(origin);
    return {
      id: `origin:${parsed.origin}`,
      label: parsed.hostname,
    };
  } catch {
    const normalized = normalizeContextPart(origin);
    return { id: `origin:${normalized}`, label: normalized };
  }
}

async function readSettingsRecord(): Promise<Record<string, any>> {
  const raw = await getSetting(scopedSettingsKey()).catch(() => null);
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, any>)
    : {};
}

function cleanOptionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseWorkspaceAppMetadataSettings(
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

async function readWorkspaceAppMetadataSettings(): Promise<WorkspaceAppMetadataSettings> {
  const raw = await getSetting(workspaceAppMetadataSettingsKey()).catch(
    () => null,
  );
  return parseWorkspaceAppMetadataSettings(raw);
}

async function writeWorkspaceAppMetadataOverride(input: {
  appId: string;
  name?: string | null;
  description?: string | null;
  generated?: boolean;
  sourcePrompt?: string | null;
  updatedBy?: string | null;
}): Promise<WorkspaceAppMetadataSettings> {
  const key = workspaceAppMetadataSettingsKey();
  const current = parseWorkspaceAppMetadataSettings(
    await getSetting(key).catch(() => null),
  );
  const appId = input.appId.trim();
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
  await putSetting(key, { apps: current.apps });
  return current;
}

function applyWorkspaceAppMetadataOverride(
  app: WorkspaceAppSummary,
  settings: WorkspaceAppMetadataSettings,
): WorkspaceAppSummary {
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

function workspaceAppUrl(appPath: string): string | null {
  const base =
    process.env.WORKSPACE_GATEWAY_URL ||
    process.env.APP_URL ||
    process.env.URL ||
    process.env.DEPLOY_URL ||
    process.env.BETTER_AUTH_URL ||
    null;
  if (!base) return null;
  try {
    return new URL(appPath, `${base.replace(/\/$/, "")}/`).toString();
  } catch {
    return null;
  }
}

function workspaceAppLink(
  appPath: string,
  explicitUrl?: unknown,
): string | null {
  const urlValue = typeof explicitUrl === "string" ? explicitUrl.trim() : "";
  if (!urlValue) return workspaceAppUrl(appPath);
  if (urlValue.startsWith("/")) return workspaceAppUrl(urlValue) ?? urlValue;
  try {
    return new URL(urlValue).toString();
  } catch {
    return urlValue;
  }
}

function normalizeWorkspaceAppAudience(value: unknown): WorkspaceAppAudience {
  return value === "public" ? "public" : DEFAULT_WORKSPACE_APP_AUDIENCE;
}

function normalizeWorkspaceAppPathList(value: unknown): string[] {
  let rawPaths: unknown[] = [];
  if (Array.isArray(value)) {
    rawPaths = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      rawPaths = Array.isArray(parsed) ? parsed : [trimmed];
    } catch {
      rawPaths = trimmed.split(",");
    }
  }

  const paths = rawPaths
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.startsWith("/"))
    .map((entry) =>
      entry.length > 1 && entry.endsWith("/") ? entry.slice(0, -1) : entry,
    );
  return Array.from(new Set(paths));
}

function workspaceAppAudienceFromPackageJson(
  pkg: unknown,
): WorkspaceAppAudience | undefined {
  if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) return undefined;
  const record = pkg as Record<string, any>;
  const config = record["agent-native"] ?? record.agentNative;
  const nested =
    config && typeof config === "object" && !Array.isArray(config)
      ? (config as Record<string, any>)
      : {};
  const raw =
    nested.workspaceApp?.audience ??
    nested.workspace?.audience ??
    nested.audience ??
    record.workspaceAppAudience;
  if (raw === undefined) return undefined;
  return normalizeWorkspaceAppAudience(raw);
}

function workspaceAppRouteAccessFromPackageJson(pkg: unknown): {
  publicPaths: string[];
  protectedPaths: string[];
} {
  if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) {
    return { publicPaths: [], protectedPaths: [] };
  }
  const record = pkg as Record<string, any>;
  const config = record["agent-native"] ?? record.agentNative;
  const nested =
    config && typeof config === "object" && !Array.isArray(config)
      ? (config as Record<string, any>)
      : {};
  return {
    publicPaths: normalizeWorkspaceAppPathList(
      nested.workspaceApp?.publicPaths ??
        nested.workspaceApp?.publicPagePaths ??
        nested.workspace?.publicPaths ??
        nested.publicPaths ??
        record.workspaceAppPublicPaths,
    ),
    protectedPaths: normalizeWorkspaceAppPathList(
      nested.workspaceApp?.protectedPaths ??
        nested.workspaceApp?.privatePaths ??
        nested.workspaceApp?.authRequiredPaths ??
        nested.workspace?.protectedPaths ??
        nested.protectedPaths ??
        record.workspaceAppProtectedPaths,
    ),
  };
}

function parseWorkspaceAppsManifest(parsed: any): WorkspaceAppSummary[] | null {
  const rawApps = Array.isArray(parsed?.apps)
    ? parsed.apps
    : Array.isArray(parsed)
      ? parsed
      : null;
  if (!rawApps) return null;

  const apps = rawApps
    .map((entry): WorkspaceAppSummary | null => {
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
        url: workspaceAppLink(pathValue, entry.url),
        isDispatch:
          typeof entry.isDispatch === "boolean"
            ? entry.isDispatch
            : id === "dispatch",
        audience:
          entry.audience === undefined
            ? DEFAULT_WORKSPACE_APP_AUDIENCE
            : normalizeWorkspaceAppAudience(entry.audience),
        publicPaths: normalizeWorkspaceAppPathList(entry.publicPaths),
        protectedPaths: normalizeWorkspaceAppPathList(entry.protectedPaths),
        status: "ready",
      } satisfies WorkspaceAppSummary;
    })
    .filter((app): app is WorkspaceAppSummary => !!app)
    .sort(sortWorkspaceApps);

  return apps.length ? apps : null;
}

function parseDateMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function pendingWorkspaceAppExpiresAt(createdAt: string): string {
  const createdMs = parseDateMs(createdAt) ?? Date.now();
  return new Date(createdMs + PENDING_WORKSPACE_APP_TTL_MS).toISOString();
}

function isPendingWorkspaceAppExpired(
  app: Pick<PendingWorkspaceApp, "createdAt" | "expiresAt">,
): boolean {
  const expiresMs =
    parseDateMs(app.expiresAt) ??
    (parseDateMs(app.createdAt) ?? Date.now()) + PENDING_WORKSPACE_APP_TTL_MS;
  return expiresMs <= Date.now();
}

function pendingWorkspaceAppMatchesCurrentContext(
  app: Pick<PendingWorkspaceApp, "contextId" | "createdAt" | "expiresAt">,
): boolean {
  if (isPendingWorkspaceAppExpired(app)) return false;
  const currentContext = pendingWorkspaceAppContext();
  if (!app.contextId) return true;
  return app.contextId === currentContext?.id;
}

function pendingWorkspaceAppContextRank(
  app: Pick<PendingWorkspaceApp, "contextId">,
): number {
  const currentContext = pendingWorkspaceAppContext();
  if (app.contextId && app.contextId === currentContext?.id) return 2;
  if (!app.contextId) return 1;
  return 0;
}

function dedupePendingWorkspaceAppsForCurrentContext(
  apps: PendingWorkspaceApp[],
): PendingWorkspaceApp[] {
  const byId = new Map<string, PendingWorkspaceApp>();
  for (const app of apps) {
    const existing = byId.get(app.id);
    if (
      !existing ||
      pendingWorkspaceAppContextRank(app) >
        pendingWorkspaceAppContextRank(existing)
    ) {
      byId.set(app.id, app);
    }
  }
  return Array.from(byId.values());
}

function sortWorkspaceApps(a: WorkspaceAppSummary, b: WorkspaceAppSummary) {
  if (a.id === "dispatch") return -1;
  if (b.id === "dispatch") return 1;
  if (a.status === "pending" && b.status !== "pending") return 1;
  if (a.status !== "pending" && b.status === "pending") return -1;
  return a.name.localeCompare(b.name);
}

function parsePendingWorkspaceApps(value: unknown): PendingWorkspaceApp[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry): PendingWorkspaceApp | null => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id.trim() : "";
      const pathValue =
        typeof record.path === "string" ? record.path.trim() : "";
      if (!id || !pathValue.startsWith("/")) return null;
      const now = new Date().toISOString();
      const createdAt = cleanOptionalString(record.createdAt) ?? now;
      return {
        id,
        name:
          typeof record.name === "string" && record.name.trim()
            ? record.name.trim()
            : titleCase(id),
        description:
          typeof record.description === "string"
            ? record.description
            : "Builder is creating this app. The workspace path becomes live after the branch is merged and deployed.",
        path: pathValue,
        builderUrl:
          typeof record.builderUrl === "string" && record.builderUrl.trim()
            ? record.builderUrl.trim()
            : null,
        branchName:
          typeof record.branchName === "string" && record.branchName.trim()
            ? record.branchName.trim()
            : null,
        projectId:
          typeof record.projectId === "string" && record.projectId.trim()
            ? record.projectId.trim()
            : null,
        contextId: cleanOptionalString(record.contextId),
        contextLabel: cleanOptionalString(record.contextLabel),
        ...(record.audience === undefined
          ? {}
          : { audience: normalizeWorkspaceAppAudience(record.audience) }),
        createdAt,
        updatedAt:
          typeof record.updatedAt === "string" && record.updatedAt.trim()
            ? record.updatedAt.trim()
            : now,
        expiresAt:
          cleanOptionalString(record.expiresAt) ??
          pendingWorkspaceAppExpiresAt(createdAt),
      } satisfies PendingWorkspaceApp;
    })
    .filter((app): app is PendingWorkspaceApp => !!app)
    .slice(0, MAX_PENDING_APPS);
}

async function listPendingWorkspaceApps(): Promise<PendingWorkspaceApp[]> {
  const raw = await readSettingsRecord();
  return parsePendingWorkspaceApps(raw.pendingApps);
}

function parseArchivedAppIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  return Array.from(new Set(ids));
}

async function listArchivedAppIds(): Promise<string[]> {
  const raw = await readSettingsRecord();
  return parseArchivedAppIds(raw.archivedAppIds);
}

export async function archiveWorkspaceApp(input: {
  appId: string;
}): Promise<{ archivedAppIds: string[] }> {
  const appId = input.appId.trim();
  if (!appId) throw new Error("appId is required");
  const raw = await readSettingsRecord();
  const current = parseArchivedAppIds(raw.archivedAppIds);
  if (!current.includes(appId)) current.push(appId);
  await putSetting(scopedSettingsKey(), { ...raw, archivedAppIds: current });
  await recordAudit({
    action: "workspace-app.archived",
    targetType: "workspace-app",
    targetId: appId,
    summary: "Hid workspace app from the Apps list",
  });
  return { archivedAppIds: current };
}

export async function unarchiveWorkspaceApp(input: {
  appId: string;
}): Promise<{ archivedAppIds: string[] }> {
  const appId = input.appId.trim();
  if (!appId) throw new Error("appId is required");
  const raw = await readSettingsRecord();
  const current = parseArchivedAppIds(raw.archivedAppIds).filter(
    (id) => id !== appId,
  );
  await putSetting(scopedSettingsKey(), { ...raw, archivedAppIds: current });
  await recordAudit({
    action: "workspace-app.unarchived",
    targetType: "workspace-app",
    targetId: appId,
    summary: "Restored workspace app to the Apps list",
  });
  return { archivedAppIds: current };
}

export async function removePendingWorkspaceApp(input: {
  appId: string;
}): Promise<{ removed: boolean }> {
  const appId = input.appId.trim();
  if (!appId) throw new Error("appId is required");
  const raw = await readSettingsRecord();
  const pending = parsePendingWorkspaceApps(raw.pendingApps);
  const next = pending.filter(
    (app) => app.id !== appId || !pendingWorkspaceAppMatchesCurrentContext(app),
  );
  const removed = next.length !== pending.length;
  if (!removed) return { removed: false };
  await putSetting(scopedSettingsKey(), { ...raw, pendingApps: next });
  await recordAudit({
    action: "workspace-app.pending-removed",
    targetType: "workspace-app",
    targetId: appId,
    summary: "Removed pending Builder app from the Apps list",
  });
  return { removed: true };
}

function pendingAppToSummary(app: PendingWorkspaceApp): WorkspaceAppSummary {
  return {
    id: app.id,
    name: app.name,
    description: app.description,
    path: app.path,
    url: app.builderUrl,
    isDispatch: false,
    audience: app.audience ?? DEFAULT_WORKSPACE_APP_AUDIENCE,
    publicPaths: [],
    protectedPaths: [],
    status: "pending",
    statusLabel: "Pending Builder branch",
    builderUrl: app.builderUrl,
    branchName: app.branchName,
    createdAt: app.createdAt,
  };
}

async function appendPendingWorkspaceApps(
  apps: WorkspaceAppSummary[],
): Promise<WorkspaceAppSummary[]> {
  const readyIds = new Set(apps.map((app) => app.id));
  const pendingApps = dedupePendingWorkspaceAppsForCurrentContext(
    (await listPendingWorkspaceApps())
      .filter(pendingWorkspaceAppMatchesCurrentContext)
      .filter((app) => !readyIds.has(app.id)),
  ).map(pendingAppToSummary);
  return [...apps, ...pendingApps].sort(sortWorkspaceApps);
}

function agentCardUrlForApp(appUrl: string | null): string | null {
  if (!appUrl) return null;
  const trimmed = appUrl.replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    return new URL(`${trimmed}${AGENT_CARD_PATH}`).toString();
  } catch {
    return `${trimmed}${AGENT_CARD_PATH}`;
  }
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOfSkills(card: Record<string, unknown>): number | null {
  return Array.isArray(card.skills) ? card.skills.length : null;
}

async function fetchAgentCardMetadata(
  app: WorkspaceAppSummary,
): Promise<
  Pick<
    WorkspaceAppSummary,
    | "agentCardUrl"
    | "agentCardReachable"
    | "a2aEndpointUrl"
    | "agentName"
    | "agentSkillsCount"
  >
> {
  const agentCardUrl = agentCardUrlForApp(app.url);
  if (!agentCardUrl) {
    return {
      agentCardUrl: null,
      agentCardReachable: false,
      a2aEndpointUrl: null,
      agentName: null,
      agentSkillsCount: null,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    AGENT_CARD_FETCH_TIMEOUT_MS,
  );

  try {
    const response = await fetch(agentCardUrl, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        agentCardUrl,
        agentCardReachable: false,
        a2aEndpointUrl: null,
        agentName: null,
        agentSkillsCount: null,
      };
    }

    const parsed = await response.json().catch(() => null);
    const card =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    if (!card) {
      return {
        agentCardUrl,
        agentCardReachable: false,
        a2aEndpointUrl: null,
        agentName: null,
        agentSkillsCount: null,
      };
    }

    return {
      agentCardUrl,
      agentCardReachable: true,
      a2aEndpointUrl:
        stringField(card, "url") ?? stringField(card, "endpointUrl"),
      agentName: stringField(card, "name"),
      agentSkillsCount: numberOfSkills(card),
    };
  } catch {
    return {
      agentCardUrl,
      agentCardReachable: false,
      a2aEndpointUrl: null,
      agentName: null,
      agentSkillsCount: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function maybeIncludeAgentCards(
  apps: WorkspaceAppSummary[],
  options: ListWorkspaceAppsOptions,
): Promise<WorkspaceAppSummary[]> {
  if (!options.includeAgentCards) return apps;
  return Promise.all(
    apps.map(async (app) => {
      if (app.status === "pending") return app;
      const metadata = await fetchAgentCardMetadata(app);
      return { ...app, ...metadata };
    }),
  );
}

async function recordPendingWorkspaceApp(input: {
  appId: string;
  projectId: string | null;
  description: string;
  sourcePrompt: string;
  branchName?: string | null;
  builderUrl?: string | null;
}) {
  const now = new Date().toISOString();
  const context = pendingWorkspaceAppContext();
  const raw = await readSettingsRecord();
  const pendingApps = parsePendingWorkspaceApps(raw.pendingApps);
  const contextId = context?.id ?? null;
  const samePendingEntry = (app: PendingWorkspaceApp) =>
    app.id === input.appId &&
    (app.contextId === contextId || (!!contextId && !app.contextId));
  const existing = pendingApps
    .filter((app) => !isPendingWorkspaceAppExpired(app))
    .find(samePendingEntry);
  const next: PendingWorkspaceApp = {
    id: input.appId,
    name: titleCase(input.appId),
    description:
      input.description ||
      "Builder is creating this app. The workspace path becomes live after the branch is merged and deployed.",
    path: `/${input.appId}`,
    builderUrl: input.builderUrl?.trim() || null,
    branchName: input.branchName?.trim() || null,
    projectId: input.projectId,
    contextId: context?.id ?? null,
    contextLabel: context?.label ?? null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    expiresAt: pendingWorkspaceAppExpiresAt(existing?.createdAt || now),
  };

  await putSetting(scopedSettingsKey(), {
    ...raw,
    pendingApps: [
      next,
      ...pendingApps.filter((app) => !samePendingEntry(app)),
    ].slice(0, MAX_PENDING_APPS),
  });

  await writeWorkspaceAppMetadataOverride({
    appId: input.appId,
    description: input.description,
    generated: true,
    sourcePrompt: input.sourcePrompt,
    updatedBy: currentOwnerEmail(),
  });

  await recordAudit({
    action: "workspace-app.pending",
    targetType: "workspace-app",
    targetId: input.appId,
    summary: "Started Builder branch for workspace app creation",
    metadata: {
      builderBranchUrlConfigured: !!next.builderUrl,
      branchName: next.branchName,
      projectIdConfigured: !!next.projectId,
      contextLabel: next.contextLabel,
    },
  });
}

function readWorkspaceAppsFromEnv(): WorkspaceAppSummary[] | null {
  const raw = process.env[WORKSPACE_APPS_ENV_KEY];
  if (!raw) return null;
  try {
    return parseWorkspaceAppsManifest(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function readWorkspaceAppsFromGateway(): Promise<
  WorkspaceAppSummary[] | null
> {
  const base = process.env.WORKSPACE_GATEWAY_URL;
  if (!base) return null;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    WORKSPACE_APPS_GATEWAY_TIMEOUT_MS,
  );

  try {
    const response = await fetch(
      new URL(WORKSPACE_APPS_GATEWAY_PATH, `${base.replace(/\/$/, "")}/`),
      {
        headers: { accept: "application/json" },
        signal: controller.signal,
      },
    );
    if (!response.ok) return null;
    return parseWorkspaceAppsManifest(await response.json().catch(() => null));
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
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

function readWorkspaceAppsFromManifestFile(): WorkspaceAppSummary[] | null {
  for (const file of workspaceAppsManifestCandidates()) {
    if (!fs.existsSync(file)) continue;
    const apps = parseWorkspaceAppsManifest(readJson(file));
    if (apps) return apps;
  }
  return null;
}

function readWorkspaceAppsFromFilesystem(
  workspaceRoot: string,
): WorkspaceAppSummary[] | null {
  const appsDir = path.join(workspaceRoot, "apps");
  if (!fs.existsSync(appsDir)) return null;

  const apps = fs
    .readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry): WorkspaceAppSummary | null => {
      const appDir = path.join(appsDir, entry.name);
      const pkg = readJson(path.join(appDir, "package.json"));
      if (!pkg) return null;
      const routeAccess = workspaceAppRouteAccessFromPackageJson(pkg);
      return {
        id: entry.name,
        name: pkg.displayName || titleCase(entry.name),
        description: pkg.description || "",
        path: `/${entry.name}`,
        url: workspaceAppUrl(`/${entry.name}`),
        isDispatch: entry.name === "dispatch",
        audience:
          workspaceAppAudienceFromPackageJson(pkg) ??
          DEFAULT_WORKSPACE_APP_AUDIENCE,
        publicPaths: routeAccess.publicPaths,
        protectedPaths: routeAccess.protectedPaths,
        status: "ready",
      } satisfies WorkspaceAppSummary;
    })
    .filter((app): app is WorkspaceAppSummary => !!app)
    .sort(sortWorkspaceApps);

  return apps.length ? apps : null;
}

export function getEnvBuilderProjectId(): string | null {
  return (
    process.env.DISPATCH_BUILDER_PROJECT_ID ||
    process.env.BUILDER_BRANCH_PROJECT_ID ||
    process.env.BUILDER_PROJECT_ID ||
    null
  );
}

/**
 * Read the workspace's identity from the workspace root's package.json. Used to
 * surface "Workspace: <name>" in the Dispatch UI so first-time users can see
 * the container their apps live inside (rather than only seeing app names like
 * "starter" / "dispatch" with no parent context).
 */
export function getWorkspaceInfo(): WorkspaceInfo {
  const rootPath = findWorkspaceRoot();
  if (!rootPath) {
    return { name: null, displayName: null, rootPath: null, appCount: 0 };
  }
  const pkg = readJson(path.join(rootPath, "package.json"));
  const rawName = typeof pkg?.name === "string" ? pkg.name.trim() : "";
  // Strip a leading "@scope/" if the workspace root happens to be scoped.
  const name = rawName.replace(/^@[^/]+\//, "") || null;
  // Honor an explicit `displayName` in the workspace package.json before
  // falling back to a title-cased version of the slug. Users naming a
  // workspace "On-Call Todo Manager" via `displayName` should see that
  // exact label rather than `On Call Todo Manager`.
  const rawDisplay =
    typeof pkg?.displayName === "string" ? pkg.displayName.trim() : "";
  const displayName = rawDisplay || (name ? titleCase(name) : null);
  let appCount = 0;
  const appsDir = path.join(rootPath, "apps");
  if (fs.existsSync(appsDir)) {
    try {
      appCount = fs
        .readdirSync(appsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory()).length;
    } catch {
      appCount = 0;
    }
  }
  return {
    name,
    displayName,
    rootPath,
    appCount,
  };
}

async function applyArchivedAndPending(
  apps: WorkspaceAppSummary[],
  options: ListWorkspaceAppsOptions,
): Promise<WorkspaceAppSummary[]> {
  const [withPending, archivedIds, metadataSettings] = await Promise.all([
    appendPendingWorkspaceApps(apps),
    listArchivedAppIds(),
    readWorkspaceAppMetadataSettings(),
  ]);
  const archivedSet = new Set(archivedIds);
  const annotated = withPending.map((app) => {
    const withMetadata = applyWorkspaceAppMetadataOverride(
      app,
      metadataSettings,
    );
    return archivedSet.has(app.id)
      ? { ...withMetadata, archived: true }
      : withMetadata;
  });
  return options.includeArchived
    ? filterAppsByAudience(annotated, options.audience)
    : filterAppsByAudience(
        annotated.filter((app) => !app.archived),
        options.audience,
      );
}

function filterAppsByAudience(
  apps: WorkspaceAppSummary[],
  audience: ListWorkspaceAppsOptions["audience"],
): WorkspaceAppSummary[] {
  if (!audience || audience === "all") return apps;
  return apps.filter(
    (app) =>
      (app.audience ?? DEFAULT_WORKSPACE_APP_AUDIENCE) ===
      normalizeWorkspaceAppAudience(audience),
  );
}

export async function updateWorkspaceAppMetadata(input: {
  appId: string;
  name?: string | null;
  description?: string | null;
}): Promise<WorkspaceAppSummary> {
  await assertCanManageAppCreationSettings();
  const appId = input.appId.trim();
  assertValidWorkspaceAppId(appId);

  const apps = await listWorkspaceApps({
    includeAgentCards: false,
    includeArchived: true,
  });
  const app = apps.find((candidate) => candidate.id === appId);
  if (!app) throw new Error(`Workspace app "${appId}" was not found.`);

  // Treat undefined/null as "field omitted, leave existing value alone"; an
  // explicit empty string clears the override (the app reverts to its
  // built-in name / no description). Without this, a partial update that
  // only touches one field silently wipes the other.
  const name = input.name == null ? app.name : input.name.trim();
  const description =
    input.description == null
      ? (app.description ?? undefined)
      : input.description.trim();
  await writeWorkspaceAppMetadataOverride({
    appId,
    name,
    description,
    generated: false,
    updatedBy: currentOwnerEmail(),
  });

  await recordAudit({
    action: "workspace-app.metadata-updated",
    targetType: "workspace-app",
    targetId: appId,
    summary: `Updated workspace app details for ${name}`,
    metadata: {
      name,
      descriptionConfigured: !!description,
    },
  });

  const updated = (
    await listWorkspaceApps({
      includeAgentCards: false,
      includeArchived: true,
    })
  ).find((candidate) => candidate.id === appId);
  return updated ?? { ...app, name, description };
}

export async function listWorkspaceApps(
  options: ListWorkspaceAppsOptions = {},
): Promise<WorkspaceAppSummary[]> {
  const gatewayApps = await readWorkspaceAppsFromGateway();
  if (gatewayApps) {
    return maybeIncludeAgentCards(
      await applyArchivedAndPending(gatewayApps, options),
      options,
    );
  }

  const workspaceRoot = findWorkspaceRoot();
  const localFilesystemApps =
    workspaceRoot && isLocalAppCreationRuntime()
      ? readWorkspaceAppsFromFilesystem(workspaceRoot)
      : null;
  if (localFilesystemApps) {
    return maybeIncludeAgentCards(
      await applyArchivedAndPending(localFilesystemApps, options),
      options,
    );
  }

  const manifestApps =
    readWorkspaceAppsFromEnv() ?? readWorkspaceAppsFromManifestFile();
  if (manifestApps) {
    return maybeIncludeAgentCards(
      await applyArchivedAndPending(manifestApps, options),
      options,
    );
  }

  if (!workspaceRoot) {
    return maybeIncludeAgentCards(
      await applyArchivedAndPending(
        [
          {
            id: "dispatch",
            name: "Dispatch",
            description: "Workspace control plane",
            path: "/dispatch",
            url: workspaceAppUrl("/dispatch"),
            isDispatch: true,
            audience: DEFAULT_WORKSPACE_APP_AUDIENCE,
            publicPaths: [],
            protectedPaths: [],
            status: "ready",
          },
        ],
        options,
      ),
      options,
    );
  }

  const apps = readWorkspaceAppsFromFilesystem(workspaceRoot) ?? [];
  return maybeIncludeAgentCards(
    await applyArchivedAndPending(apps, options),
    options,
  );
}

/**
 * First-party templates the user can scaffold into this workspace via the
 * Apps page tiles. Inlined here (rather than importing from
 * `@agent-native/shared-app-config`) because the published `@agent-native/dispatch`
 * package has no `workspace:*` runtime dependencies. Keep in sync with
 * `packages/core/src/cli/templates-meta.ts`.
 */
const ADDABLE_TEMPLATES: AvailableWorkspaceTemplate[] = [
  {
    name: "mail",
    label: "Mail",
    hint: "Email client with keyboard shortcuts and AI triage",
    icon: "Mail",
    color: "#3B82F6",
    colorRgb: "59 130 246",
    core: true,
  },
  {
    name: "calendar",
    label: "Calendar",
    hint: "Manage events, sync, and public booking",
    icon: "CalendarMonth",
    color: "#8B5CF6",
    colorRgb: "139 92 246",
    core: true,
  },
  {
    name: "content",
    label: "Content",
    hint: "Write and organize with agent assistance",
    icon: "FileText",
    color: "#10B981",
    colorRgb: "16 185 129",
    core: true,
  },
  {
    name: "slides",
    label: "Slides",
    hint: "Generate and edit React presentations",
    icon: "Presentation",
    color: "#EC4899",
    colorRgb: "236 72 153",
    core: true,
  },
  {
    name: "clips",
    label: "Clips",
    hint: "Screen recording, meeting notes, and voice dictation",
    icon: "ScreenShare",
    color: "#625DF5",
    colorRgb: "98 93 245",
    core: true,
  },
  {
    name: "brain",
    label: "Brain",
    hint: "Cited company knowledge from Slack, meetings, transcripts, and decisions",
    icon: "Brain",
    color: "#8B5CF6",
    colorRgb: "139 92 246",
    core: true,
  },
  {
    name: "assets",
    label: "Assets",
    hint: "Upload, organize, search, and generate on-brand images and videos",
    icon: "Photo",
    color: "#0F766E",
    colorRgb: "15 118 110",
    core: true,
  },
  {
    name: "analytics",
    label: "Analytics",
    hint: "Connect data sources, prompt for charts",
    icon: "ChartBar",
    color: "#F59E0B",
    colorRgb: "245 158 11",
    core: true,
  },
  {
    name: "forms",
    label: "Forms",
    hint: "Create, edit, and manage forms",
    icon: "ClipboardList",
    color: "#06B6D4",
    colorRgb: "6 182 212",
    core: true,
  },
  {
    name: "design",
    label: "Design",
    hint: "Create and edit visual designs with agent assistance",
    icon: "Brush",
    color: "#F472B6",
    colorRgb: "244 114 182",
    core: true,
  },
  {
    name: "videos",
    label: "Video",
    hint: "Video editing with Remotion",
    icon: "Video",
    color: "#EF4444",
    colorRgb: "239 68 68",
    core: false,
  },
];

export async function listAvailableWorkspaceTemplates(): Promise<
  AvailableWorkspaceTemplate[]
> {
  const installed = new Set(
    (await listWorkspaceApps({ includeArchived: true })).map((app) => app.id),
  );
  return ADDABLE_TEMPLATES.filter((tpl) => !installed.has(tpl.name));
}

const SCAFFOLD_TIMEOUT_MS = 90_000;

export async function scaffoldWorkspaceAppFromTemplate(input: {
  template: string;
  appId?: string | null;
}): Promise<{ appId: string; template: string; output: string }> {
  if (!isLocalAppCreationRuntime()) {
    throw new Error(
      "Scaffolding from Dispatch is only available in local development. " +
        "Use the Builder branch flow on a deployed workspace.",
    );
  }
  const template = input.template.trim();
  if (!template) throw new Error("template is required");
  if (!ADDABLE_TEMPLATES.some((tpl) => tpl.name === template)) {
    throw new Error(`Unknown template "${template}".`);
  }

  const appId = (input.appId?.trim() || template).toLowerCase();
  assertValidWorkspaceAppId(appId);

  const workspaceRoot = findWorkspaceRoot();
  if (!workspaceRoot) {
    throw new Error("No agent-native workspace detected for scaffolding.");
  }
  const appDir = path.join(workspaceRoot, "apps", appId);
  if (fs.existsSync(appDir)) {
    throw new Error(`apps/${appId} already exists.`);
  }

  const output = await runScaffoldCli({
    cwd: workspaceRoot,
    args: ["add-app", appId, "--template", template],
  });

  await recordAudit({
    action: "workspace-app.scaffolded",
    targetType: "workspace-app",
    targetId: appId,
    summary: `Scaffolded apps/${appId} from ${template}`,
    metadata: { template },
  });

  return { appId, template, output };
}

function runScaffoldCli(input: {
  cwd: string;
  args: string[];
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "agent-native", ...input.args], {
      cwd: input.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new Error(
          `Scaffold timed out after ${Math.round(SCAFFOLD_TIMEOUT_MS / 1000)}s`,
        ),
      );
    }, SCAFFOLD_TIMEOUT_MS);
    timer.unref();
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve([stdout, stderr].filter(Boolean).join("\n").trim());
        return;
      }
      const detail = (stderr || stdout || "").trim() || `exit code ${code}`;
      reject(new Error(`Scaffold failed: ${detail}`));
    });
  });
}

export async function getAppCreationSettings(): Promise<AppCreationSettings> {
  const envBuilderProjectId = getEnvBuilderProjectId();
  const resolvedBuilderProjectId = await resolveBuilderBranchProjectId();
  const raw = await readSettingsRecord();
  const savedBuilderProjectId =
    typeof raw?.builderProjectId === "string" && raw.builderProjectId.trim()
      ? raw.builderProjectId.trim()
      : null;
  const builderProjectId = envBuilderProjectId || savedBuilderProjectId;
  const enableBuilder =
    process.env.ENABLE_BUILDER === "true" || process.env.ENABLE_BUILDER === "1";
  const effectiveBuilderProjectId =
    builderProjectId ||
    resolvedBuilderProjectId ||
    (enableBuilder ? getBuilderBranchProjectId() : null);

  return {
    builderProjectId: effectiveBuilderProjectId,
    builderProjectIdSource: envBuilderProjectId
      ? "env"
      : savedBuilderProjectId
        ? "dispatch"
        : effectiveBuilderProjectId
          ? "default"
          : "unset",
    envBuilderProjectId,
    savedBuilderProjectId,
    builderBranchingEnabled: !!effectiveBuilderProjectId,
  };
}

export async function setAppCreationSettings(input: {
  builderProjectId?: string | null;
}): Promise<AppCreationSettings> {
  await assertCanManageAppCreationSettings();
  const builderProjectId = input.builderProjectId?.trim() || null;
  const raw = await readSettingsRecord();
  await putSetting(scopedSettingsKey(), { ...raw, builderProjectId });
  await recordAudit({
    action: "settings.updated",
    targetType: "dispatch-app-creation-settings",
    targetId: SETTINGS_KEY,
    summary: builderProjectId
      ? "Updated default Builder project for app creation"
      : "Cleared default Builder project for app creation",
    metadata: { builderProjectIdConfigured: !!builderProjectId },
  });
  return getAppCreationSettings();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 64);
}

function isLocalAppCreationRuntime(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (
    process.env.NETLIFY ||
    process.env.VERCEL ||
    process.env.CF_PAGES ||
    process.env.DEPLOY_URL ||
    process.env.URL ||
    process.env.RENDER ||
    process.env.FLY_APP_NAME
  ) {
    return false;
  }
  return true;
}

function isSyntheticIntegrationOwner(ownerEmail: string): boolean {
  return (
    ownerEmail.startsWith("integration@") ||
    ownerEmail.endsWith("@integration.local")
  );
}

async function requestOwnerRole(): Promise<string | null> {
  const orgId = currentOrgId();
  const ownerEmail = currentOwnerEmail();
  if (!orgId) return null;
  try {
    const { rows } = await getDbExec().execute({
      sql: `SELECT role FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
      args: [orgId, ownerEmail.toLowerCase()],
    });
    const role = (rows[0] as any)?.role;
    return typeof role === "string" ? role : null;
  } catch {
    return null;
  }
}

async function assertCanManageAppCreationSettings(): Promise<void> {
  const orgId = currentOrgId();
  if (!orgId) return;
  const role = await requestOwnerRole();
  if (role !== "owner" && role !== "admin") {
    throw new Error(
      "Only organization owners and admins can update app creation settings.",
    );
  }
}

async function isCurrentIntegrationExplicitlyLinked(): Promise<boolean> {
  const incoming = getRequestContext()?.integration?.incoming;
  if (!incoming) return true;
  const externalUserId = identityKeyForIncoming(incoming);
  const linkedOwner = await resolveLinkedOwner(
    incoming.platform,
    externalUserId,
    {
      allowAnyOrgFallback: true,
    },
  ).catch(() => null);
  return linkedOwner === currentOwnerEmail();
}

async function defaultOwnerAppCreationAllowed(): Promise<boolean> {
  const defaultOwner = process.env.DISPATCH_DEFAULT_OWNER_EMAIL?.trim();
  if (!defaultOwner || defaultOwner !== currentOwnerEmail()) return false;
  if (await isCurrentIntegrationExplicitlyLinked()) return true;
  return (
    process.env.DISPATCH_ALLOW_DEFAULT_OWNER_APP_CREATION === "true" ||
    process.env.DISPATCH_ALLOW_DEFAULT_OWNER_APP_CREATION === "1" ||
    process.env.ENABLE_BUILDER === "true" ||
    process.env.ENABLE_BUILDER === "1"
  );
}

function normalizeBuilderRunString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Builder app creation returned a blank ${fieldName}`);
  }
  const trimmed = value.trim();
  if (/[ -]/.test(trimmed)) {
    throw new Error(`Builder app creation returned a malformed ${fieldName}`);
  }
  return trimmed;
}

function normalizeBuilderRunUrl(value: unknown): string {
  const urlString = normalizeBuilderRunString(value, "url");
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error("Builder app creation returned a malformed url");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Builder app creation returned a malformed url");
  }
  if (
    parsed.hostname !== "builder.io" &&
    !parsed.hostname.endsWith(".builder.io")
  ) {
    throw new Error("Builder app creation returned a non-Builder url");
  }
  return parsed.toString();
}

function normalizeBuilderRunResult(result: unknown): {
  branchName: string;
  url: string;
  status: string;
} {
  const record =
    result && typeof result === "object" && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : {};
  return {
    branchName: normalizeBuilderRunString(record.branchName, "branchName"),
    url: normalizeBuilderRunUrl(record.url),
    status:
      typeof record.status === "string" && record.status.trim()
        ? record.status.trim()
        : "processing",
  };
}

async function remoteAppCreationAuthorization(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  const ownerEmail = currentOwnerEmail();
  const isIntegrationCaller = isIntegrationCallerRequest();
  const defaultOwner = process.env.DISPATCH_DEFAULT_OWNER_EMAIL?.trim();
  if (isIntegrationCaller && defaultOwner && defaultOwner === ownerEmail) {
    if (await defaultOwnerAppCreationAllowed()) return { ok: true };
    return {
      ok: false,
      message:
        "Messaging-triggered app creation is using the deployment default Dispatch owner. " +
        "Link the messaging identity to a Dispatch user with /link, start the app from Dispatch while signed in, or explicitly set ENABLE_BUILDER=true for this deployment.",
    };
  }
  if (!isSyntheticIntegrationOwner(ownerEmail)) return { ok: true };

  const source = isIntegrationCaller
    ? "Messaging-triggered"
    : "Synthetic integration";
  return {
    ok: false,
    message:
      `${source} app creation needs a trusted Dispatch owner before Builder can start a branch. ` +
      "Link the messaging identity to a Dispatch user with /link, start the app from Dispatch while signed in, or explicitly set ENABLE_BUILDER=true for this deployment.",
  };
}

function buildWorkspaceAppPrompt(input: {
  prompt: string;
  appId?: string | null;
  description?: string | null;
  template?: string | null;
  selectedKeys?: string[];
  selectedResources?: WorkspaceResourceOption[];
}): { appId: string; prompt: string } {
  const appId =
    slugify(input.appId || "") ||
    slugify(
      input.prompt.replace(/\b(build|create|make|an?|the|app|tool)\b/gi, " "),
    ) ||
    "new-app";
  const appDescription =
    input.description?.trim() ||
    generateWorkspaceAppDescription(input.prompt, appId);
  const selectedKeys = input.selectedKeys || [];
  const selectedResources = input.selectedResources || [];
  const resourceList = selectedResources.length
    ? selectedResources
        .map(
          (resource) =>
            `- ${resource.name} (${resource.kind}, ${resource.path})`,
        )
        .join("\n")
    : "none";
  return {
    appId,
    prompt: [
      "Create a new agent-native app in this workspace.",
      "",
      `App name: ${appId}`,
      `App description: ${appDescription}`,
      `Template to start from: ${input.template || "starter"}`,
      `User prompt: ${input.prompt.trim()}`,
      "If the user mentions a product or company such as Granola, Loom, Superhuman, Linear, or Notion, treat it as product inspiration unless they explicitly ask to connect to that service. Do not invent or require third-party API keys like GRANOLA_API_KEY just because a product is named.",
      selectedKeys.length
        ? `Dispatch vault keys selected for this app: ${selectedKeys.join(", ")}`
        : "Dispatch vault keys selected for this app: none",
      `Dispatch workspace resources selected for this app:\n${resourceList}`,
      `Dispatch workspace resources with scope=all are global. After the app exists, sync workspace resources to appId "${appId}" so global skills, guardrail instructions, and reference resources reach the new app even when no per-app resources were selected.`,
      "",
      `Use the workspace app layout: create it under apps/${appId}, mount it at /${appId}, keep it on the shared workspace database/hosting model, and avoid table-name collisions by namespacing any new domain tables to the app.`,
      `Important routing rule: from outside the app, link to /${appId}; inside apps/${appId}, React Router routes are app-local. Use <Link to="/review"> and navigate("/review"), not "/${appId}/review"; APP_BASE_PATH supplies the mounted prefix, and hardcoding it causes doubled URLs like /${appId}/${appId}/review.`,
      "Existing first-party apps are neighbors, not implementation details for this app. If the user prompt mentions Mail, Calendar, Analytics, Dispatch, or other templates, treat them as existing hosted/connected apps that this app can link to or call through A2A/default connected agents. For example, Mail, Calendar, and Analytics already exist at https://mail.agent-native.com, https://calendar.agent-native.com, and https://analytics.agent-native.com.",
      `Do not clone first-party templates, create wrapper apps, or scaffold child apps/routes for Mail, Calendar, Analytics, etc. inside apps/${appId} just so this app can access them. If the request is a cross-app dashboard or overview, build only the new dashboard/overview app and delegate to the existing apps for domain work.`,
      "Only create another first-party app copy when the user explicitly asks for a customized fork/copy of that app; otherwise keep using the hosted/shared app so improvements to the base template keep flowing to users.",
      selectedKeys.length
        ? `Dispatch will create pending vault requests for the selected keys for appId "${appId}" after this app creation request is accepted. Do not grant or sync vault keys directly from the app-creation branch.`
        : "Do not grant or request any Dispatch vault keys unless the user asks later.",
      selectedResources.length
        ? `Dispatch will create workspace resource grants for the selected resources for appId "${appId}". After the app exists, sync workspace resources so the app receives both global and selected shared resources.`
        : "Do not grant any selected-only Dispatch workspace resources unless the user asks later.",
      "",
      "Agent-native rules (these are the framework's contract — not optional):",
      `- Persist ALL data in SQL via Drizzle. Add tables to apps/${appId}/server/db/schema.ts and migrations to apps/${appId}/server/plugins/db.ts. NEVER use localStorage, sessionStorage, IndexedDB, or in-memory state for anything the user expects to persist — agent and UI must read the same source of truth.`,
      `- Define every create/read/update/delete as an action in apps/${appId}/actions/ using defineAction. The agent calls these as tools and the frontend calls them via useActionQuery / useActionMutation. If you must raw-fetch framework action endpoints, use agentNativePath("/_agent-native/actions/<name>") so mounted apps call the right URL. Don't add /api/* routes for CRUD.`,
      "- Build the UI from shadcn/ui components in app/components/ui/ (Button, Input, Dialog, Popover, Card, etc.) and Tailwind utilities. Don't author bespoke CSS classes in global.css unless you genuinely need a primitive that shadcn doesn't ship.",
      "- Use Tabler Icons (@tabler/icons-react) for every icon. Never use emojis as icons.",
      `- Expose what the user is looking at via application_state (navigation.view, selection, etc.) so the agent has live context. Mirror the patterns in templates/mail or templates/slides.`,
      "- Optimistic UI for every mutation: update the React Query cache immediately, navigate immediately, run the mutation in the background, roll back on error. Don't await a server round-trip before re-rendering.",
      "",
      "Branch readiness requirements before handing off:",
      "- The CLI auto-fills package.json name and displayName from the app id; only edit the description / scripts / dependencies if the app actually needs more than the template provides.",
      `- Save a concise, human-readable app description in apps/${appId}/package.json "description" so Dispatch, A2A discovery, and connected agents can describe what this app does. Use the description above or improve it based on the prompt.`,
      "- Do not add or update workspace-apps.json or .agent-native/workspace-apps.json unless the app needs an explicit external URL override; the root deploy generates the workspace app registry from apps/* and deploy metadata.",
      "- Update pnpm-lock.yaml when adding or changing dependencies so Netlify can install the branch reliably.",
      "- Update the app manifest/package/deploy metadata needed by the existing workspace deployment model; do not leave the branch relying only on uncommitted local state.",
      "- Verify the app's agent card/A2A metadata is ready so Dispatch can discover and delegate to the app after deployment. Every sibling workspace app should be usable over A2A by default through call-agent.",
      "- Give the app agent context that sibling workspace apps are available over A2A with names and descriptions from the workspace app registry; do not hardcode a stale app list.",
      "- Include a final verification note covering the registry entry, manifest/deploy metadata, relative same-origin routing, and agent-card readiness.",
      `When it is ready, start or update the workspace dev server and navigate the user to /${appId}.`,
    ].join("\n"),
  };
}

async function requestSelectedVaultKeys(input: {
  appId: string;
  selectedKeys: string[];
}) {
  if (input.selectedKeys.length === 0) return;
  await Promise.allSettled(
    input.selectedKeys.map((credentialKey) =>
      Promise.resolve().then(() =>
        createRequest({
          appId: input.appId,
          credentialKey,
          reason: `Requested during workspace app creation for ${input.appId}.`,
        }),
      ),
    ),
  );
}

async function selectedWorkspaceResourcesForIds(
  resourceIds: string[] | undefined,
): Promise<WorkspaceResourceOption[]> {
  if (!resourceIds?.length) return [];
  const requested = new Set(resourceIds);
  const resources = await listWorkspaceResourceOptions();
  return resources.filter((resource) => requested.has(resource.id));
}

async function grantSelectedWorkspaceResources(input: {
  appId: string;
  resourceIds: string[];
}) {
  if (input.resourceIds.length === 0) return;
  await grantWorkspaceResourcesToApp(input);
}

export async function startWorkspaceAppCreation(input: {
  prompt: string;
  appId?: string | null;
  description?: string | null;
  template?: string | null;
  secretIds?: string[];
  resourceIds?: string[];
}) {
  const initial = buildWorkspaceAppPrompt({
    prompt: input.prompt,
    appId: input.appId,
    description: input.description,
    template: input.template,
  });
  assertValidWorkspaceAppId(initial.appId);
  const isLocal = isLocalAppCreationRuntime();

  if (!isLocal) {
    const authorization = await remoteAppCreationAuthorization();
    if (authorization.ok === false) {
      return {
        mode: "builder-unavailable",
        appId: initial.appId,
        message: authorization.message,
      };
    }
  }

  const selectedKeys = input.secretIds?.length
    ? (await listSecrets())
        .filter((secret) => input.secretIds?.includes(secret.id))
        .map((secret) => secret.credentialKey)
    : [];
  const selectedResources = await selectedWorkspaceResourcesForIds(
    input.resourceIds,
  );
  const built = buildWorkspaceAppPrompt({
    prompt: input.prompt,
    appId: input.appId,
    description: input.description,
    template: input.template,
    selectedKeys,
    selectedResources,
  });
  const prompt = built.prompt;
  const appDescription =
    input.description?.trim() ||
    generateWorkspaceAppDescription(input.prompt, built.appId);

  if (isLocal) {
    await requestSelectedVaultKeys({
      appId: built.appId,
      selectedKeys,
    });
    await grantSelectedWorkspaceResources({
      appId: built.appId,
      resourceIds: selectedResources.map((resource) => resource.id),
    });
    return {
      mode: "local-agent",
      appId: built.appId,
      prompt,
      message:
        "Use the local code agent to create this app in the workspace, then open it from /dispatch/apps.",
    };
  }

  const settings = await getAppCreationSettings();

  if (!settings.builderProjectId) {
    return {
      mode: "coming-soon",
      appId: built.appId,
      message:
        "Builder app creation is coming soon here. Set a default Builder project in Dispatch or provide BUILDER_BRANCH_PROJECT_ID to enable branch creation.",
    };
  }

  let result: {
    branchName: string;
    url: string;
    status: string;
  };
  try {
    const builderCreds = await resolveBuilderCredentials().catch(() => null);
    const builderUserId = builderCreds?.userId || undefined;
    result = normalizeBuilderRunResult(
      await runBuilderAgent({
        prompt,
        projectId: settings.builderProjectId,
        ...(builderUserId
          ? { userId: builderUserId }
          : { userEmail: currentOwnerEmail() }),
      }),
    );
  } catch (err) {
    const detail =
      err instanceof Error && err.message
        ? err.message
        : "Builder could not start the app branch";
    return {
      mode: "builder-unavailable",
      appId: built.appId,
      projectId: settings.builderProjectId,
      message:
        `Builder app creation is configured for project ${settings.builderProjectId}, ` +
        `but it could not start yet: ${detail}. Connect Builder for this user, ` +
        `link the messaging identity to that user, or configure deployment-managed Builder credentials for this workspace.`,
    };
  }

  await recordPendingWorkspaceApp({
    appId: built.appId,
    projectId: settings.builderProjectId,
    description: appDescription,
    sourcePrompt: input.prompt,
    branchName: result.branchName,
    builderUrl: result.url,
  });

  await requestSelectedVaultKeys({
    appId: built.appId,
    selectedKeys,
  });
  await grantSelectedWorkspaceResources({
    appId: built.appId,
    resourceIds: selectedResources.map((resource) => resource.id),
  });

  return {
    mode: "builder",
    appId: built.appId,
    path: `/${built.appId}`,
    projectId: settings.builderProjectId,
    branchName: result.branchName,
    url: result.url,
    workspaceUrl: workspaceAppUrl(`/${built.appId}`),
    status: result.status,
    message:
      `Builder started a branch for /${built.appId}. Use the Builder branch URL to track creation now. ` +
      `The workspace path will be live after that branch is merged and the workspace deploy finishes, so it may 404 until then.`,
  };
}
