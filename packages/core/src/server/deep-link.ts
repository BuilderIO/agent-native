import { withCollapsedAgentSidebarParam } from "../shared/agent-sidebar-url.js";
import {
  getConfiguredAppBasePath,
  normalizeAppBasePath,
} from "./app-base-path.js";
import { publicFrameworkPath } from "./framework-route-prefix.js";

export const OPEN_ROUTE_SUBPATH = "/open";

export const DESKTOP_OPEN_URL = "agentnative://open";

export const VSCODE_OPEN_URL = "vscode://builder.agent-native/open";

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

export function toDesktopOpenUrl(urlOrPath: string): string {
  const qIdx = urlOrPath.indexOf("?");
  const query = qIdx >= 0 ? urlOrPath.slice(qIdx + 1) : "";
  return query ? `${DESKTOP_OPEN_URL}?${query}` : DESKTOP_OPEN_URL;
}

export function toVsCodeOpenUrl(urlOrPath: string): string {
  const sp = new URLSearchParams();
  sp.set("url", urlOrPath);
  return `${VSCODE_OPEN_URL}?${sp.toString()}`;
}
