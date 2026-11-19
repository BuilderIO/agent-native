import {
  AGENT_NATIVE_OPEN_PATH,
  withCollapsedAgentSidebarParam,
} from "../shared/agent-sidebar-url.js";
import {
  getConfiguredAppBasePath,
  normalizeAppBasePath,
  stripAppBasePath,
} from "./app-base-path.js";
import {
  canonicalFrameworkPathname,
  publicFrameworkPath,
} from "./framework-route-prefix.js";

export const OPEN_ROUTE_SUBPATH = "/open";

export const DESKTOP_OPEN_URL = "agentnative://open";

/**
 * Deep-link schemes the desktop app registers, stable channel first. Nightly
 * builds register `agentnative-nightly` so both channels can be installed.
 */
export const DESKTOP_DEEP_LINK_PROTOCOLS = [
  "agentnative",
  "agentnative-nightly",
] as const;
export type DesktopDeepLinkProtocol =
  (typeof DESKTOP_DEEP_LINK_PROTOCOLS)[number];

export const VSCODE_OPEN_URL = "vscode://builder.agent-native/open";

export function isSameOriginUrl(urlOrPath: string, origin?: string): boolean {
  const hasAuthority =
    /^[a-z][a-z0-9+.-]*:/i.test(urlOrPath) || urlOrPath.startsWith("//");
  if (!hasAuthority) return true;
  if (!origin) return false;
  if (!URL.canParse(origin) || !URL.canParse(urlOrPath, origin)) return false;
  return new URL(urlOrPath, origin).origin === new URL(origin).origin;
}

export function isAgentNativeOpenUrl(
  urlOrPath: string,
  origin?: string,
  basePath = getConfiguredAppBasePath(),
): boolean {
  const base = origin ?? "http://agent-native.invalid";
  if (!URL.canParse(urlOrPath, base)) return false;
  const url = new URL(urlOrPath, base);
  if (url.protocol === "agentnative:" && url.host === "open") return true;
  if (!isSameOriginUrl(urlOrPath, origin)) return false;
  return (
    canonicalFrameworkPathname(stripAppBasePath(url.pathname, basePath)) ===
    AGENT_NATIVE_OPEN_PATH
  );
}

export interface DeepLinkInput {
  app?: string;
  view: string;
  params?: Record<string, string | number | boolean | null | undefined>;
  to?: string;
}

function buildQuery(input: DeepLinkInput): string {
  const sp = new URLSearchParams();
  if (input.app) sp.set("app", input.app);
  sp.set("view", input.view);
  if (input.to) sp.set("to", input.to);
  for (const [k, v] of Object.entries(input.params ?? {})) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  return sp.toString();
}

export function buildDeepLink(input: DeepLinkInput): string {
  return withCollapsedAgentSidebarParam(
    publicFrameworkPath(
      `/_agent-native${OPEN_ROUTE_SUBPATH}?${buildQuery(input)}`,
    ),
  );
}

export function toAbsoluteOpenUrl(
  urlOrPath: string,
  origin: string | undefined,
): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(urlOrPath)) return urlOrPath;
  if (urlOrPath.startsWith("//")) {
    return origin && URL.canParse(urlOrPath, origin)
      ? new URL(urlOrPath, origin).toString()
      : urlOrPath;
  }
  const basePath = getConfiguredAppBasePath();
  const path = withBasePath(urlOrPath, basePath);
  if (!origin) return path;
  return `${origin.replace(/\/+$/, "")}${path.startsWith("/") ? "" : "/"}${path}`;
}

function withBasePath(urlOrPath: string, basePath: string): string {
  if (!basePath) return urlOrPath;
  const leadingPath = urlOrPath.startsWith("/") ? urlOrPath : `/${urlOrPath}`;
  const [pathname] = leadingPath.split(/[?#]/, 1);
  const normalizedPathname = normalizeAppBasePath(pathname);
  if (
    normalizedPathname === basePath ||
    normalizedPathname.startsWith(`${basePath}/`)
  ) {
    return urlOrPath;
  }
  return `${basePath}${leadingPath}`;
}

export function toDesktopOpenUrl(
  urlOrPath: string,
  protocol: DesktopDeepLinkProtocol = "agentnative",
): string {
  const qIdx = urlOrPath.indexOf("?");
  const query = qIdx >= 0 ? urlOrPath.slice(qIdx + 1) : "";
  const base = `${protocol}://open`;
  return query ? `${base}?${query}` : base;
}

export function toVsCodeOpenUrl(urlOrPath: string): string {
  const sp = new URLSearchParams();
  sp.set("url", urlOrPath);
  return `${VSCODE_OPEN_URL}?${sp.toString()}`;
}
