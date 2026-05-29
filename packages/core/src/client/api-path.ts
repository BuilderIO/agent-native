import { ensureEmbedAuthFetchInterceptor } from "./embed-auth.js";

const FRAMEWORK_ROUTE_PREFIX = "/_agent-native";

function normalizeBasePath(value: string | undefined): string {
  if (!value || value === "/") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "";
  return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function configuredBasePath(): string {
  const env = clientEnv();
  const value = env?.VITE_APP_BASE_PATH ?? env?.APP_BASE_PATH ?? env?.BASE_URL;
  return typeof value === "string" ? normalizeBasePath(value) : "";
}

function clientEnv(): Record<string, string | boolean | undefined> | undefined {
  const importMetaEnv = (
    import.meta as unknown as {
      env?: Record<string, string | boolean | undefined>;
    }
  ).env;
  const processEnv = (
    globalThis as typeof globalThis & {
      process?: { env?: Record<string, string | boolean | undefined> };
    }
  ).process?.env;

  if (importMetaEnv && processEnv) return { ...processEnv, ...importMetaEnv };
  return importMetaEnv ?? processEnv;
}

function pathDerivedBasePath(): string {
  if (typeof window === "undefined") return "";
  const pathname = window.location.pathname;
  const markerIndex = pathname.indexOf(FRAMEWORK_ROUTE_PREFIX);
  if (markerIndex <= 0) return "";
  return normalizeBasePath(pathname.slice(0, markerIndex));
}

function pathMatchesBasePath(pathname: string, basePath: string): boolean {
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

function isWorkspaceRuntime(): boolean {
  const env = clientEnv();
  return (
    env?.VITE_AGENT_NATIVE_WORKSPACE === "1" ||
    env?.AGENT_NATIVE_WORKSPACE === "1" ||
    typeof env?.VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON === "string"
  );
}

function workspacePathBasePath(): string {
  if (typeof window === "undefined" || !isWorkspaceRuntime()) return "";
  const segment = window.location.pathname.split("/").find(Boolean);
  if (!segment || segment === "_agent-native" || segment === "api") return "";
  return normalizeBasePath(segment);
}

export function appBasePath(): string {
  ensureEmbedAuthFetchInterceptor();
  const configured = configuredBasePath();
  const derived = pathDerivedBasePath();
  if (!configured) return derived;
  if (typeof window === "undefined") return configured;

  const pathname = window.location.pathname;
  if (pathMatchesBasePath(pathname, configured)) return configured;

  // In a multi-app workspace, a globally configured base can bleed from one
  // app build into another. Prefer the live mount path when they disagree.
  return derived || workspacePathBasePath() || configured;
}

export function appPath(path: string): string {
  if (!path.startsWith("/")) return path;
  const basePath = appBasePath();
  if (!basePath) return path;
  if (path === basePath || path.startsWith(`${basePath}/`)) return path;
  return `${basePath}${path}`;
}

export function appApiPath(path: string): string {
  const normalized =
    path === "/api" || path.startsWith("/api/")
      ? path
      : `/api/${path.replace(/^\/+/, "")}`;
  return appPath(normalized);
}

export function agentNativePath(path: string): string {
  if (!path.startsWith(FRAMEWORK_ROUTE_PREFIX)) return path;
  return appPath(path);
}
