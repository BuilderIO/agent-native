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
  icon: string;
  description: string;
  devPort: number;
  color?: string;
  colorRgb?: string;
  placeholder?: boolean;
}

export interface AppConfig {
  id: string;
  name: string;
  icon: string;
  description: string;
  url: string;
  devPort: number;
  devUrl?: string;
  devCommand?: string;
  localPath?: string;
  color?: string;
  colorRgb?: string;
  isBuiltIn: boolean;
  enabled: boolean;
  mode?: "dev" | "prod";
  workspaceSso?: boolean;
}

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
      ...(typeof record.workspaceSso === "boolean"
        ? { workspaceSso: record.workspaceSso }
        : {}),
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

export const FRAME_PORT = 3334;

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

export const DEFAULT_APPS: AppConfig[] = coreTemplates().map((template) =>
  templateToAppConfig(template, { isBuiltIn: true, enabled: true }),
);

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

export function generateAppId(): string {
  return `custom-${Date.now().toString(36)}`;
}

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

export const APP_REGISTRY: AppDefinition[] = DEFAULT_APPS.map(toAppDefinition);
