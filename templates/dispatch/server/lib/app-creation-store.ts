import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSetting, putSetting } from "@agent-native/core/settings";
import {
  getBuilderBranchProjectId,
  getRequestContext,
  isIntegrationCallerRequest,
  resolveBuilderCredentials,
  runBuilderAgent,
} from "@agent-native/core/server";
import { getDbExec } from "@agent-native/core/db";
import { assertValidWorkspaceAppId } from "@agent-native/core/shared";
import {
  currentOrgId,
  currentOwnerEmail,
  recordAudit,
  resolveLinkedOwner,
} from "./dispatch-store.js";
import { identityKeyForIncoming } from "./dispatch-integrations.js";
import { createRequest, listSecrets } from "./vault-store.js";

const SETTINGS_KEY = "dispatch-app-creation-settings";
const WORKSPACE_APPS_ENV_KEY = "AGENT_NATIVE_WORKSPACE_APPS_JSON";
const WORKSPACE_APPS_MANIFEST_FILE = "workspace-apps.json";
const MAX_PENDING_APPS = 50;
const AGENT_CARD_PATH = "/.well-known/agent-card.json";
const AGENT_CARD_FETCH_TIMEOUT_MS = 1_500;

export interface WorkspaceAppSummary {
  id: string;
  name: string;
  description: string;
  path: string;
  url: string | null;
  isDispatch: boolean;
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
}

export interface ListWorkspaceAppsOptions {
  includeAgentCards?: boolean;
}

export interface AppCreationSettings {
  builderProjectId: string | null;
  builderProjectIdSource: "env" | "dispatch" | "default" | "unset";
  envBuilderProjectId: string | null;
  savedBuilderProjectId: string | null;
  builderBranchingEnabled: boolean;
}

interface PendingWorkspaceApp {
  id: string;
  name: string;
  description: string;
  path: string;
  builderUrl: string | null;
  branchName: string | null;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
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

function scopedSettingsKey(): string {
  const orgId = currentOrgId();
  if (orgId) return `${SETTINGS_KEY}:org:${orgId}`;
  return `${SETTINGS_KEY}:user:${currentOwnerEmail()}`;
}

async function readSettingsRecord(): Promise<Record<string, any>> {
  const raw = await getSetting(scopedSettingsKey()).catch(() => null);
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, any>)
    : {};
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
        status: "ready",
      } satisfies WorkspaceAppSummary;
    })
    .filter((app): app is WorkspaceAppSummary => !!app)
    .sort(sortWorkspaceApps);

  return apps.length ? apps : null;
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
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id.trim() : "";
      const pathValue =
        typeof record.path === "string" ? record.path.trim() : "";
      if (!id || !pathValue.startsWith("/")) return null;
      const now = new Date().toISOString();
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
        createdAt:
          typeof record.createdAt === "string" && record.createdAt.trim()
            ? record.createdAt.trim()
            : now,
        updatedAt:
          typeof record.updatedAt === "string" && record.updatedAt.trim()
            ? record.updatedAt.trim()
            : now,
      } satisfies PendingWorkspaceApp;
    })
    .filter((app): app is PendingWorkspaceApp => !!app)
    .slice(0, MAX_PENDING_APPS);
}

async function listPendingWorkspaceApps(): Promise<PendingWorkspaceApp[]> {
  const raw = await readSettingsRecord();
  return parsePendingWorkspaceApps(raw.pendingApps);
}

function pendingAppToSummary(app: PendingWorkspaceApp): WorkspaceAppSummary {
  return {
    id: app.id,
    name: app.name,
    description: app.description,
    path: app.path,
    url: app.builderUrl,
    isDispatch: false,
    status: "pending",
    statusLabel: "Building in Builder",
    builderUrl: app.builderUrl,
    branchName: app.branchName,
    createdAt: app.createdAt,
  };
}

async function appendPendingWorkspaceApps(
  apps: WorkspaceAppSummary[],
): Promise<WorkspaceAppSummary[]> {
  const readyIds = new Set(apps.map((app) => app.id));
  const pendingApps = (await listPendingWorkspaceApps())
    .filter((app) => !readyIds.has(app.id))
    .map(pendingAppToSummary);
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
  branchName?: string | null;
  builderUrl?: string | null;
}) {
  const now = new Date().toISOString();
  const raw = await readSettingsRecord();
  const pendingApps = parsePendingWorkspaceApps(raw.pendingApps);
  const existing = pendingApps.find((app) => app.id === input.appId);
  const next: PendingWorkspaceApp = {
    id: input.appId,
    name: titleCase(input.appId),
    description:
      "Builder is creating this app. The workspace path becomes live after the branch is merged and deployed.",
    path: `/${input.appId}`,
    builderUrl: input.builderUrl?.trim() || null,
    branchName: input.branchName?.trim() || null,
    projectId: input.projectId,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  await putSetting(scopedSettingsKey(), {
    ...raw,
    pendingApps: [
      next,
      ...pendingApps.filter((app) => app.id !== input.appId),
    ].slice(0, MAX_PENDING_APPS),
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

export function getEnvBuilderProjectId(): string | null {
  return (
    process.env.DISPATCH_BUILDER_PROJECT_ID ||
    process.env.BUILDER_BRANCH_PROJECT_ID ||
    process.env.BUILDER_PROJECT_ID ||
    null
  );
}

export async function listWorkspaceApps(
  options: ListWorkspaceAppsOptions = {},
): Promise<WorkspaceAppSummary[]> {
  const manifestApps =
    readWorkspaceAppsFromEnv() ?? readWorkspaceAppsFromManifestFile();
  if (manifestApps) {
    return maybeIncludeAgentCards(
      await appendPendingWorkspaceApps(manifestApps),
      options,
    );
  }

  const workspaceRoot = findWorkspaceRoot();
  if (!workspaceRoot) {
    return maybeIncludeAgentCards(
      await appendPendingWorkspaceApps([
        {
          id: "dispatch",
          name: "Dispatch",
          description: "Workspace control plane",
          path: "/dispatch",
          url: workspaceAppUrl("/dispatch"),
          isDispatch: true,
          status: "ready",
        },
      ]),
      options,
    );
  }

  const appsDir = path.join(workspaceRoot, "apps");
  if (!fs.existsSync(appsDir)) {
    return maybeIncludeAgentCards(
      await appendPendingWorkspaceApps([]),
      options,
    );
  }

  const apps = fs
    .readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry): WorkspaceAppSummary | null => {
      const appDir = path.join(appsDir, entry.name);
      const pkg = readJson(path.join(appDir, "package.json"));
      if (!pkg) return null;
      return {
        id: entry.name,
        name: pkg.displayName || titleCase(entry.name),
        description: pkg.description || "",
        path: `/${entry.name}`,
        url: workspaceAppUrl(`/${entry.name}`),
        isDispatch: entry.name === "dispatch",
        status: "ready",
      } satisfies WorkspaceAppSummary;
    })
    .filter((app): app is WorkspaceAppSummary => !!app)
    .sort(sortWorkspaceApps);
  return maybeIncludeAgentCards(
    await appendPendingWorkspaceApps(apps),
    options,
  );
}

export async function getAppCreationSettings(): Promise<AppCreationSettings> {
  const envBuilderProjectId = getEnvBuilderProjectId();
  const raw = await readSettingsRecord();
  const savedBuilderProjectId =
    typeof raw?.builderProjectId === "string" && raw.builderProjectId.trim()
      ? raw.builderProjectId.trim()
      : null;
  const builderProjectId = envBuilderProjectId || savedBuilderProjectId;
  const enableBuilder =
    process.env.ENABLE_BUILDER === "true" || process.env.ENABLE_BUILDER === "1";
  const effectiveBuilderProjectId =
    builderProjectId || (enableBuilder ? getBuilderBranchProjectId() : null);

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
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
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
  template?: string | null;
  selectedKeys?: string[];
}): { appId: string; prompt: string } {
  const appId =
    slugify(input.appId || "") ||
    slugify(
      input.prompt.replace(/\b(build|create|make|an?|the|app|tool)\b/gi, " "),
    ) ||
    "new-app";
  const selectedKeys = input.selectedKeys || [];
  return {
    appId,
    prompt: [
      "Create a new agent-native app in this workspace.",
      "",
      `App name: ${appId}`,
      `Template to start from: ${input.template || "starter"}`,
      `User prompt: ${input.prompt.trim()}`,
      selectedKeys.length
        ? `Dispatch vault keys selected for this app: ${selectedKeys.join(", ")}`
        : "Dispatch vault keys selected for this app: none",
      "",
      `Use the workspace app layout: create it under apps/${appId}, mount it at /${appId}, keep it on the shared workspace database/hosting model, and avoid table-name collisions by namespacing any new domain tables to the app.`,
      selectedKeys.length
        ? `Dispatch will create pending vault requests for the selected keys for appId "${appId}" after this app creation request is accepted. Do not grant or sync vault keys directly from the app-creation branch.`
        : "Do not grant or request any Dispatch vault keys unless the user asks later.",
      "",
      "Branch readiness requirements before handing off:",
      `- Create apps/${appId} with package.json displayName/description/scripts/dependencies matching the workspace conventions.`,
      "- Do not add or update workspace-apps.json or .agent-native/workspace-apps.json unless the app needs an explicit external URL override; the root deploy generates the workspace app registry from apps/* and deploy metadata.",
      "- Update pnpm-lock.yaml when adding or changing dependencies so Netlify can install the branch reliably.",
      "- Update the app manifest/package/deploy metadata needed by the existing workspace deployment model; do not leave the branch relying only on uncommitted local state.",
      "- Verify the app's agent card/A2A metadata is ready so Dispatch can discover and delegate to the app after deployment.",
      "- Include a final verification note covering the registry entry, manifest/deploy metadata, and agent-card readiness.",
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

export async function startWorkspaceAppCreation(input: {
  prompt: string;
  appId?: string | null;
  template?: string | null;
  secretIds?: string[];
}) {
  const initial = buildWorkspaceAppPrompt({
    prompt: input.prompt,
    appId: input.appId,
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
  const built = buildWorkspaceAppPrompt({
    prompt: input.prompt,
    appId: input.appId,
    template: input.template,
    selectedKeys,
  });
  const prompt = built.prompt;

  if (isLocal) {
    await requestSelectedVaultKeys({
      appId: built.appId,
      selectedKeys,
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
    branchName: result.branchName,
    builderUrl: result.url,
  });

  await requestSelectedVaultKeys({
    appId: built.appId,
    selectedKeys,
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
