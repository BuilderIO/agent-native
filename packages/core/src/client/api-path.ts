import { isTruthyRuntimeValue } from "../shared/runtime-config.js";
import { initializeAgentNativeClient } from "./client-bootstrap.js";

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
  const segment = window.location.pathname.split("/").find(Boolean);
  if (!segment || segment === "_agent-native" || segment === "api") return "";
  const basePath = normalizeBasePath(segment);
  // Guard against treating an app-local route (e.g. a client-rendered
  // "/settings" page reached via stale client-side navigation) as if it
  // were a sibling app's workspace mount — that built URLs like
  // "/settings/_agent-native/builder/connect", which the workspace gateway
  // 404s (no app is mounted at "/settings") into its app-picker page instead
  // of the real target route. Only trust the segment when it matches a
  // known mount from the deployed app manifest; when the manifest can't be
  // read, fall back to the prior blind-trust behavior (e.g. the same build
  // reused across sibling app ids without a manifest).
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
    const markerIndex = url.pathname.indexOf(FRAMEWORK_ROUTE_PREFIX);
    if (markerIndex > 0) {
      return normalizeBasePath(url.pathname.slice(0, markerIndex));
    }
    if (isWorkspaceRuntime()) {
      const segment = url.pathname.split("/").find(Boolean);
      if (segment && segment !== "_agent-native" && segment !== "api") {
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

  // In a multi-app workspace, a globally configured base can bleed from one
  // app build into another. Prefer the live mount path when they disagree.
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

/**
 * Returns true for a same-origin path mounted at a sibling workspace app.
 * React Router treats root paths as local to its basename, so these targets
 * must use the browser location instead of the app-local router.
 */
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

/**
 * Resolves the mount prefix for a surface that is currently rendering at
 * `appLocalRoute`, anchoring on the live pathname instead of only the
 * env/manifest-derived base path.
 *
 * `appBasePath()` fails closed to `""` whenever the workspace runtime flag or
 * the app manifest cannot confirm the mount, and `""` is indistinguishable
 * from "mounted at the origin root". Anything that writes a browser URL from
 * that value silently escapes the app mount (`/dispatch/settings` ->
 * `/settings`). The pathname the browser is already serving this surface from
 * is the authority, so prefer the prefix that sits in front of the surface's
 * own app-local route.
 *
 * Only a prefix that precedes `appLocalRoute` in the current pathname is
 * accepted, so this never promotes an arbitrary leading segment into a mount
 * the way a bare first-segment guess would.
 *
 * The route can legitimately repeat the marker in a later segment, because
 * trailing segments carry user-named values: a secret key called
 * `settings/token` produces `/settings/integrations/secrets/settings/token`.
 * Matching the first occurrence keeps the mount at the shortest prefix, so
 * content inside the route can never masquerade as part of the mount. An app
 * genuinely mounted at `/settings` is resolved by the configured base path
 * above, which a workspace deploy always bakes in.
 */
export function appMountPath(appLocalRoute: string): string {
  const basePath = appBasePath();
  if (typeof window === "undefined") return basePath;

  const pathname = window.location.pathname;
  if (basePath && pathMatchesBasePath(pathname, basePath)) return basePath;

  const marker = normalizeBasePath(appLocalRoute);
  if (!marker) return basePath;

  const index = pathname.indexOf(marker);
  if (index < 0) return basePath;

  const boundary = index + marker.length;
  if (boundary !== pathname.length && pathname[boundary] !== "/") {
    return basePath;
  }

  return normalizeBasePath(pathname.slice(0, index));
}

/**
 * Prefixes an app-local path for a surface currently rendering at
 * `appLocalRoute`. Use this instead of `appPath()` when writing a browser URL
 * (`history.pushState`, `<a href>`) from a surface whose own route is already
 * visible in the address bar.
 */
export function appMountedPath(path: string, appLocalRoute: string): string {
  if (!path.startsWith("/")) return path;
  const mountPath = appMountPath(appLocalRoute);
  if (!mountPath) return path;
  if (path === mountPath || path.startsWith(`${mountPath}/`)) return path;
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
  if (!path.startsWith(FRAMEWORK_ROUTE_PREFIX)) return path;
  return appPath(path);
}

/**
 * Optional cross-origin response-streaming endpoint. The browser uses the
 * normal same-origin chat route to mint a short-lived bearer token first.
 */
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
