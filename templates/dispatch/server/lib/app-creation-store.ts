import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSetting, putSetting } from "@agent-native/core/settings";
import {
  getBuilderBranchProjectId,
  resolveBuilderCredentials,
  runBuilderAgent,
} from "@agent-native/core/server";
import { assertValidWorkspaceAppId } from "@agent-native/core/shared";
import {
  currentOrgId,
  currentOwnerEmail,
  recordAudit,
} from "./dispatch-store.js";
import { grantSecretsToApp, listSecrets } from "./vault-store.js";

const SETTINGS_KEY = "dispatch-app-creation-settings";
const WORKSPACE_APPS_ENV_KEY = "AGENT_NATIVE_WORKSPACE_APPS_JSON";
const WORKSPACE_APPS_MANIFEST_FILE = "workspace-apps.json";
const MAX_PENDING_APPS = 50;

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

export async function listWorkspaceApps(): Promise<WorkspaceAppSummary[]> {
  const manifestApps =
    readWorkspaceAppsFromEnv() ?? readWorkspaceAppsFromManifestFile();
  if (manifestApps) return appendPendingWorkspaceApps(manifestApps);

  const workspaceRoot = findWorkspaceRoot();
  if (!workspaceRoot) {
    return appendPendingWorkspaceApps([
      {
        id: "dispatch",
        name: "Dispatch",
        description: "Workspace control plane",
        path: "/dispatch",
        url: workspaceAppUrl("/dispatch"),
        isDispatch: true,
        status: "ready",
      },
    ]);
  }

  const appsDir = path.join(workspaceRoot, "apps");
  if (!fs.existsSync(appsDir)) return appendPendingWorkspaceApps([]);

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
  return appendPendingWorkspaceApps(apps);
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
        ? `Grant the selected Dispatch vault keys to appId "${appId}" and sync them once the app server is available.`
        : "Do not grant any Dispatch vault keys unless the user asks later.",
      `When it is ready, start or update the workspace dev server and navigate the user to /${appId}.`,
    ].join("\n"),
  };
}

export async function startWorkspaceAppCreation(input: {
  prompt: string;
  appId?: string | null;
  template?: string | null;
  secretIds?: string[];
  preparedPrompt?: string | null;
}) {
  const initial = buildWorkspaceAppPrompt({
    prompt: input.prompt,
    appId: input.appId,
    template: input.template,
  });
  assertValidWorkspaceAppId(initial.appId);
  const settings = await getAppCreationSettings();
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
  const prompt = input.preparedPrompt || built.prompt;
  const isLocal = isLocalAppCreationRuntime();

  if (isLocal) {
    if (input.secretIds?.length) {
      await grantSecretsToApp(input.secretIds, initial.appId);
    }
    return {
      mode: "local-agent",
      appId: built.appId,
      prompt,
      message:
        "Use the local code agent to create this app in the workspace, then open it from /dispatch/apps.",
    };
  }

  if (!settings.builderProjectId) {
    return {
      mode: "coming-soon",
      appId: built.appId,
      message:
        "Builder app creation is coming soon here. Set a default Builder project in Dispatch or provide BUILDER_BRANCH_PROJECT_ID to enable branch creation.",
    };
  }

  let result;
  try {
    const builderCreds = await resolveBuilderCredentials().catch(() => null);
    const builderUserId = builderCreds?.userId || undefined;
    result = await runBuilderAgent({
      prompt,
      projectId: settings.builderProjectId,
      ...(builderUserId
        ? { userId: builderUserId }
        : { userEmail: currentOwnerEmail() }),
    });
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

  if (input.secretIds?.length) {
    await grantSecretsToApp(input.secretIds, built.appId);
  }

  await recordPendingWorkspaceApp({
    appId: built.appId,
    projectId: settings.builderProjectId,
    branchName: result.branchName,
    builderUrl: result.url,
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
