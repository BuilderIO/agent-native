import {
  FRAMEWORK_INTERNAL_ROUTE_PREFIX,
  matchesPathPrefix,
  normalizeFrameworkRoutePrefix,
  toPublicFrameworkPath,
} from "../shared/framework-route-prefix.js";
import { isTruthyRuntimeValue } from "../shared/runtime-config.js";
import { injectedAgentNativeConfig } from "./app-config.js";
import { initializeAgentNativeClient } from "./client-bootstrap.js";

export function frameworkRoutePrefix(): string {
  const configured = injectedAgentNativeConfig().runtime?.frameworkRoutePrefix;
  if (configured !== undefined) {
    return normalizeFrameworkRoutePrefix(configured);
  }
  const projected =
    typeof window === "undefined"
      ? undefined
      : (
          window as Window & {
            __AGENT_NATIVE_CONFIG__?: { frameworkRoutePrefix?: unknown };
          }
        ).__AGENT_NATIVE_CONFIG__?.frameworkRoutePrefix;
  return normalizeFrameworkRoutePrefix(
    projected,
    "window.__AGENT_NATIVE_CONFIG__.frameworkRoutePrefix",
  );
}

export function isFrameworkRoutePath(pathname: string): boolean {
  return (
    matchesPathPrefix(pathname, FRAMEWORK_INTERNAL_ROUTE_PREFIX) ||
    matchesPathPrefix(pathname, frameworkRoutePrefix())
  );
}

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

function frameworkMarkerIndex(pathname: string): number {
  for (const marker of [
    frameworkRoutePrefix(),
    FRAMEWORK_INTERNAL_ROUTE_PREFIX,
  ]) {
    for (
      let index = pathname.indexOf(marker);
      index > 0;
      index = pathname.indexOf(marker, index + 1)
    ) {
      const end = index + marker.length;
      if (end === pathname.length || pathname[end] === "/") return index;
    }
  }
  return -1;
}

function isFrameworkSegment(segment: string): boolean {
  return (
    `/${segment}` === FRAMEWORK_INTERNAL_ROUTE_PREFIX ||
    `/${segment}` === frameworkRoutePrefix()
  );
}

function pathDerivedBasePath(): string {
  if (
    typeof window === "undefined" ||
    typeof window.location?.pathname !== "string"
  ) {
    return "";
  }
  const pathname = window.location.pathname;
  const markerIndex = frameworkMarkerIndex(pathname);
  if (markerIndex <= 0) return "";
  return normalizeBasePath(pathname.slice(0, markerIndex));
}

function pathMatchesBasePath(pathname: string, basePath: string): boolean {
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

function isWorkspaceRuntime(): boolean {
  const env = clientEnv();
  const projected =
    typeof window !== "undefined" &&
    (
      window as Window & {
        __AGENT_NATIVE_CONFIG__?: { workspaceRuntime?: unknown };
      }
    ).__AGENT_NATIVE_CONFIG__?.workspaceRuntime === true;
  return (
    projected ||
    isTruthyRuntimeValue(env?.VITE_AGENT_NATIVE_WORKSPACE) ||
    isTruthyRuntimeValue(env?.AGENT_NATIVE_WORKSPACE) ||
    typeof env?.VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON === "string"
  );
}

function workspacePathBasePath(): string {
  if (typeof window === "undefined" || !isWorkspaceRuntime()) return "";
  const pathname = window.location?.pathname;
  if (typeof pathname !== "string") return "";
  const segment = pathname.split("/").find(Boolean);
  if (!segment || isFrameworkSegment(segment) || segment === "api") return "";
  const basePath = normalizeBasePath(segment);
  const mounts = workspaceAppMountPaths();
  if (mounts && !mounts.has(basePath)) return "";
  return basePath;
}

function externalEmbedTargetBasePath(): string {
  if (typeof window === "undefined") return "";
  const target = (
    window as Window & {
      __AGENT_NATIVE_EXTERNAL_EMBED?: { target?: unknown };
    }
  ).__AGENT_NATIVE_EXTERNAL_EMBED?.target;
  if (typeof target !== "string" || !target.startsWith("/")) return "";
  try {
    const url = new URL(target, "http://agent-native.invalid");
    const markerIndex = frameworkMarkerIndex(url.pathname);
    if (markerIndex > 0) {
      return normalizeBasePath(url.pathname.slice(0, markerIndex));
    }
    if (isWorkspaceRuntime()) {
      const segment = url.pathname.split("/").find(Boolean);
      if (segment && !isFrameworkSegment(segment) && segment !== "api") {
        return normalizeBasePath(segment);
      }
    }
  } catch {
    return "";
  }
  return "";
}

export function appBasePath(): string {
  initializeAgentNativeClient();
  const externalEmbed = externalEmbedTargetBasePath();
  if (externalEmbed) return externalEmbed;
  const configured = configuredBasePath();
  const derived = pathDerivedBasePath();
  if (!configured) return derived || workspacePathBasePath();
  if (typeof window === "undefined") return configured;

  const pathname = window.location.pathname;
  if (pathMatchesBasePath(pathname, configured)) return configured;

  return derived || workspacePathBasePath() || configured;
}

function workspaceAppMountPaths(): Set<string> | null {
  const raw = clientEnv()?.VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON;
  if (typeof raw !== "string" || !raw.trim()) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    const entries = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && "apps" in parsed
        ? (parsed as { apps?: unknown }).apps
        : null;
    if (!Array.isArray(entries)) return null;

    const paths = entries
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const record = entry as Record<string, unknown>;
        const rawPath =
          typeof record.path === "string"
            ? record.path
            : typeof record.id === "string"
              ? `/${record.id}`
              : null;
        return rawPath?.startsWith("/") ? normalizeBasePath(rawPath) : null;
      })
      .filter((path): path is string => Boolean(path));

    return paths.length ? new Set(paths) : null;
  } catch {
    // coercion-ok: malformed manifests cannot authorize cross-app navigation
    return null;
  }
}

export function isWorkspaceAppPath(path: string): boolean {
  if (typeof window === "undefined" || !path.startsWith("/")) return false;
  if (!isWorkspaceRuntime()) return false;

  const targetPath = path.split(/[?#]/, 1)[0] || "/";
  const basePath = appBasePath();
  if (!basePath) return false;
  if (targetPath === basePath || targetPath.startsWith(`${basePath}/`)) {
    return false;
  }

  const mounts = workspaceAppMountPaths();
  if (!mounts) return false;
  return [...mounts].some(
    (mount) => targetPath === mount || targetPath.startsWith(`${mount}/`),
  );
}

export function appMountPath(appLocalRoute: string): string {
  const basePath = appBasePath();
  if (typeof window === "undefined") return basePath;

  const pathname = window.location.pathname;
  if (basePath && pathMatchesBasePath(pathname, basePath)) return basePath;

  const marker = normalizeBasePath(appLocalRoute);
  if (!marker) {
    return isWorkspaceRuntime() && pathname !== "/"
      ? normalizeBasePath(pathname)
      : basePath;
  }
  const markerSegment = marker.slice(1);

  const mounts = workspaceAppMountPaths();
  const candidates: string[] = [];
  for (
    let index = pathname.indexOf(markerSegment);
    index >= 0;
    index = pathname.indexOf(markerSegment, index + 1)
  ) {
    const boundary = index + markerSegment.length;
    if (
      (index === 0 || pathname[index - 1] === "/") &&
      (boundary === pathname.length || pathname[boundary] === "/")
    ) {
      candidates.push(normalizeBasePath(pathname.slice(0, index)));
    }
  }

  const knownCandidates = mounts
    ? candidates.filter((candidate) => mounts.has(candidate))
    : candidates;
  if (mounts && knownCandidates.length) {
    return knownCandidates.sort((a, b) => b.length - a.length)[0];
  }
  return candidates[0] ?? basePath;
}

export function appMountedPath(path: string, appLocalRoute: string): string {
  if (!path.startsWith("/")) return path;
  const mountPath = appMountPath(appLocalRoute);
  if (!mountPath) return path;

  const mounted = `${mountPath}${normalizeBasePath(appLocalRoute)}`;
  if (path === mounted || path.startsWith(`${mounted}/`)) return path;
  return `${mountPath}${path}`;
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
  const queryOrFragment = path.search(/[?#]/);
  const pathname =
    queryOrFragment === -1 ? path : path.slice(0, queryOrFragment);
  if (!matchesPathPrefix(pathname, FRAMEWORK_INTERNAL_ROUTE_PREFIX))
    return path;
  return appPath(
    toPublicFrameworkPath(path, { publicPrefix: frameworkRoutePrefix() }),
  );
}

export function agentChatStreamingUrl(): string | undefined {
  const value = clientEnv()?.VITE_AGENT_NATIVE_AGENT_CHAT_STREAM_URL;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const candidate = value.trim();
  const base =
    typeof window === "undefined"
      ? "http://agent-native.invalid"
      : window.location.href;
  if (!URL.canParse(candidate, base)) {
    return undefined;
  }
  const url = new URL(candidate, base);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return undefined;
  }
  return candidate;
}
