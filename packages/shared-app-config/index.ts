import {
  coreTemplates,
  getTemplate,
  TEMPLATES,
  type TemplateMeta,
} from "./templates.js";
export {
  TEMPLATES,
  visibleTemplates,
  coreTemplates,
  getTemplate,
  allTemplateNames,
} from "./templates.js";
export type { TemplateMeta } from "./templates.js";

export interface AppDefinition {
  id: string;
  name: string;
  /** Icon alias key resolved by app shells */
  icon: string;
  description: string;
  /** Dev server port (used in development mode) */
  devPort: number;
  /** Legacy accent color — kept on built-in templates for the docs site; unused in electron/mobile UI. */
  color?: string;
  colorRgb?: string;
  /** Whether this app is a placeholder (no real server yet) */
  placeholder?: boolean;
}

/** User-configured app entry (persisted on-device) */
export interface AppConfig {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** The production URL this app is deployed at */
  url: string;
  /** Dev server port (for local development) */
  devPort: number;
  /** Optional dev server URL override */
  devUrl?: string;
  /** Optional shell command to start the dev server */
  devCommand?: string;
  /** Optional local folder used to configure this dev app */
  localPath?: string;
  /** Legacy accent color — kept on built-in templates for the docs site; unused in electron/mobile UI. */
  color?: string;
  colorRgb?: string;
  /** Whether this is a built-in default app */
  isBuiltIn: boolean;
  /** Whether the app is enabled/visible */
  enabled: boolean;
  /** Whether to load the dev or production URL. Default: "prod" */
  mode?: "dev" | "prod";
  /** Explicitly opt a custom production app into Desktop workspace SSO. */
  workspaceSso?: boolean;
}

/** Stable server-side key for the native workspace app inventory rollout. */
export const WORKSPACE_APP_LIST_FLAG_KEY = "dispatch.workspace-app-list";

const WORKSPACE_APP_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

function workspaceAppUrl(
  value: unknown,
  pathValue: unknown,
  baseUrl?: string,
): string | null {
  const raw =
    typeof value === "string" && value.trim()
      ? value.trim()
      : typeof pathValue === "string" && pathValue.trim()
        ? pathValue.trim()
        : "";
  if (!raw) return null;

  try {
    const parsed = new URL(raw, baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch (error) {
    void error;
    return null;
  }
}

/**
 * Convert the Dispatch workspace registry response into safe app entries for
 * native shells. Pending, archived, invalid, and agent-card-only records do
 * not become launchable apps, and no registry metadata or credentials cross
 * the shell boundary.
 */
export function normalizeWorkspaceAppConfigs(
  payload: unknown,
  options: { baseUrl?: string; excludeDispatch?: boolean } = {},
): AppConfig[] {
  const rawApps = Array.isArray((payload as { apps?: unknown[] })?.apps)
    ? (payload as { apps: unknown[] }).apps
    : Array.isArray(payload)
      ? payload
      : [];
  const candidates: AppConfig[] = [];

  for (const entry of rawApps) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (
      !id ||
      !WORKSPACE_APP_ID_PATTERN.test(id) ||
      record.archived === true ||
      (record.status !== undefined && record.status !== "ready") ||
      (options.excludeDispatch !== false &&
        (record.isDispatch === true || id === "dispatch"))
    ) {
      continue;
    }

    const url = workspaceAppUrl(
      record.url ?? record.builderUrl,
      record.path,
      options.baseUrl,
    );
    if (!url) continue;
    const name =
      typeof record.name === "string" && record.name.trim()
        ? record.name.trim()
        : id;
    const description =
      typeof record.description === "string" ? record.description.trim() : "";
    const icon =
      typeof record.icon === "string" && record.icon.trim()
        ? record.icon.trim()
        : "LayoutBoard";
    const color =
      typeof record.color === "string" && /^#[0-9a-f]{6}$/i.test(record.color)
        ? record.color
        : undefined;

    candidates.push({
      id,
      name,
      icon,
      description,
      url,
      devPort: 0,
      isBuiltIn: false,
      enabled: true,
      mode: "prod",
      ...(color ? { color } : {}),
    });
  }

  const deduped = new Map<string, AppConfig>();
  for (const app of candidates.sort(
    (a, b) =>
      a.id.localeCompare(b.id) ||
      a.name.localeCompare(b.name) ||
      a.url.localeCompare(b.url),
  )) {
    if (!deduped.has(app.id)) deduped.set(app.id, app);
  }

  return [...deduped.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
}

/** Frame UI port */
export const FRAME_PORT = 3334;

/** The first five apps shown in the chat-first rail on every client. */
export const CHAT_FIRST_DEFAULT_APP_IDS = [
  "content",
  "design",
  "mail",
  "calendar",
  "clips",
] as const;

export function templateToAppConfig(
  template: TemplateMeta,
  opts: { isBuiltIn?: boolean; enabled?: boolean } = {},
): AppConfig {
  return {
    id: template.name,
    name: template.label,
    icon: template.icon,
    description: template.description ?? template.hint,
    url: template.prodUrl ?? "",
    devPort: template.devPort,
    devUrl: `http://localhost:${template.devPort}`,
    color: template.color,
    colorRgb: template.colorRgb,
    isBuiltIn: opts.isBuiltIn ?? Boolean(template.core),
    enabled: opts.enabled ?? true,
    mode: template.defaultMode ?? "prod",
  };
}

export const TEMPLATE_APPS: AppConfig[] = TEMPLATES.map((template) =>
  templateToAppConfig(template),
);

/**
 * Default apps derived from the template registry. Only core templates are
 * included — non-core apps can still be added manually via "Add app".
 */
export const DEFAULT_APPS: AppConfig[] = coreTemplates().map((template) =>
  templateToAppConfig(template, { isBuiltIn: true, enabled: true }),
);

/**
 * Convert an AppConfig to AppDefinition (for backward compatibility
 * with desktop app code that expects the old shape).
 */
export function toAppDefinition(config: AppConfig): AppDefinition {
  return {
    id: config.id,
    name: config.name,
    icon: config.icon,
    description: config.description,
    devPort: config.devPort,
    color: config.color,
    colorRgb: config.colorRgb,
  };
}

/** Generate a unique ID for user-added apps */
export function generateAppId(): string {
  return `custom-${Date.now().toString(36)}`;
}

/** Returns the frame URL for the given app (terminal + iframe) */
export function getAppUrl(app: AppDefinition | AppConfig): string {
  return `http://localhost:${FRAME_PORT}?app=${app.id}`;
}

function runtimeEnvValue(name: string): string | undefined {
  const viteEnv = (
    typeof import.meta !== "undefined"
      ? (
          import.meta as unknown as {
            env?: Record<string, string | undefined>;
          }
        ).env
      : undefined
  )?.[name];
  if (viteEnv) return viteEnv;
  const globalProcess = (
    globalThis as unknown as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process;
  return globalProcess?.env?.[name];
}

export function getTemplateGatewayUrl(): string | null {
  const value =
    runtimeEnvValue("VITE_AGENT_NATIVE_TEMPLATE_GATEWAY_URL") ||
    runtimeEnvValue("AGENT_NATIVE_TEMPLATE_GATEWAY_URL") ||
    runtimeEnvValue("VITE_WORKSPACE_GATEWAY_URL") ||
    runtimeEnvValue("WORKSPACE_GATEWAY_URL");
  if (!value) return null;
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function getTemplateGatewayAppUrl(appId: string): string | null {
  const gatewayUrl = getTemplateGatewayUrl();
  if (!gatewayUrl || !getTemplate(appId)) return null;
  try {
    return new URL(`/${appId}`, `${gatewayUrl}/`).toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function getAppById(
  id: string,
  apps: (AppDefinition | AppConfig)[] = DEFAULT_APPS,
): AppDefinition | AppConfig | undefined {
  return apps.find((a) => a.id === id);
}

/**
 * The original APP_REGISTRY for backward compatibility.
 * Desktop app code that imports APP_REGISTRY will still work.
 */
export const APP_REGISTRY: AppDefinition[] = DEFAULT_APPS.map(toAppDefinition);
