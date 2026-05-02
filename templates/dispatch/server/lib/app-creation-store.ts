import fs from "node:fs";
import path from "node:path";
import { getSetting, putSetting } from "@agent-native/core/settings";
import {
  getBuilderBranchProjectId,
  runBuilderAgent,
} from "@agent-native/core/server";
import {
  currentOrgId,
  currentOwnerEmail,
  recordAudit,
} from "./dispatch-store.js";
import { grantSecretsToApp, listSecrets } from "./vault-store.js";

const SETTINGS_KEY = "dispatch-app-creation-settings";

export interface WorkspaceAppSummary {
  id: string;
  name: string;
  description: string;
  path: string;
  isDispatch: boolean;
}

export interface AppCreationSettings {
  builderProjectId: string | null;
  builderProjectIdSource: "env" | "dispatch" | "default" | "unset";
  envBuilderProjectId: string | null;
  savedBuilderProjectId: string | null;
  builderBranchingEnabled: boolean;
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

export function getEnvBuilderProjectId(): string | null {
  return (
    process.env.DISPATCH_BUILDER_PROJECT_ID ||
    process.env.BUILDER_BRANCH_PROJECT_ID ||
    process.env.BUILDER_PROJECT_ID ||
    null
  );
}

export async function listWorkspaceApps(): Promise<WorkspaceAppSummary[]> {
  const workspaceRoot = findWorkspaceRoot();
  if (!workspaceRoot) {
    return [
      {
        id: "dispatch",
        name: "Dispatch",
        description: "Workspace control plane",
        path: "/dispatch",
        isDispatch: true,
      },
    ];
  }

  const appsDir = path.join(workspaceRoot, "apps");
  if (!fs.existsSync(appsDir)) return [];

  return fs
    .readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const appDir = path.join(appsDir, entry.name);
      const pkg = readJson(path.join(appDir, "package.json"));
      if (!pkg) return null;
      return {
        id: entry.name,
        name: pkg.displayName || titleCase(entry.name),
        description: pkg.description || "",
        path: `/${entry.name}`,
        isDispatch: entry.name === "dispatch",
      } satisfies WorkspaceAppSummary;
    })
    .filter((app): app is WorkspaceAppSummary => !!app)
    .sort((a, b) => {
      if (a.id === "dispatch") return -1;
      if (b.id === "dispatch") return 1;
      return a.name.localeCompare(b.name);
    });
}

export async function getAppCreationSettings(): Promise<AppCreationSettings> {
  const envBuilderProjectId = getEnvBuilderProjectId();
  const raw = await getSetting(scopedSettingsKey()).catch(() => null);
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
  await putSetting(scopedSettingsKey(), { builderProjectId });
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
  const settings = await getAppCreationSettings();
  const initial = buildWorkspaceAppPrompt({
    prompt: input.prompt,
    appId: input.appId,
    template: input.template,
  });
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
    result = await runBuilderAgent({
      prompt,
      projectId: settings.builderProjectId,
      userEmail: currentOwnerEmail(),
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

  return {
    mode: "builder",
    appId: built.appId,
    projectId: settings.builderProjectId,
    branchName: result.branchName,
    url: result.url,
    status: result.status,
  };
}
