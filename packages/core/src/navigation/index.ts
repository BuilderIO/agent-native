import {
  AGENT_NATIVE_OPEN_PATH,
  withCollapsedAgentSidebarParam,
} from "../shared/agent-sidebar-url.js";

export const STANDARD_APP_ROUTES = {
  home: "/",
  settings: "/settings",
  team: "/team",
} as const;

export const STANDARD_SETTINGS_TABS = {
  general: "general",
  agent: "agent",
  providers: "providers",
  connections: "connections",
  secrets: "secrets",
  team: "organization",
  usage: "usage",
  language: "language",
  whatsNew: "whats-new",
} as const;

export type StandardAppRouteId = keyof typeof STANDARD_APP_ROUTES;
export type StandardSettingsTabId =
  (typeof STANDARD_SETTINGS_TABS)[keyof typeof STANDARD_SETTINGS_TABS];

export interface BuildStandardAppRouteOptions {
  settingsTab?: StandardSettingsTabId | string | null;
  teamInSettings?: boolean;
}

export interface BuildResourceRouteOptions {
  basePath?: string;
}

export interface NavigationTarget {
  app?: string;
  view: string;
  params?: Record<string, string | number | boolean | null | undefined>;
  to?: string;
}

export interface NavigationLink extends NavigationTarget {
  label: string;
  url: string;
}

export type StandardOpenPathRoute =
  | string
  | ((params: Record<string, string>) => string | null | undefined);

export interface StandardOpenPathResolverOptions {
  fallback?: StandardOpenPathRoute;
}

function normalizeLeadingPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "/") return "/";
  return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function normalizeTabId(tab: string): string {
  return tab
    .trim()
    .replace(/^#/, "")
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[\s_]+/g, "-");
}

function pathSegment(value: string): string {
  return encodeURIComponent(value.trim().replace(/^\/+|\/+$/g, ""));
}

function resolveOpenPathRoute(
  route: StandardOpenPathRoute | undefined,
  params: Record<string, string>,
): string | null | undefined {
  if (!route) return null;
  return typeof route === "function" ? route(params) : route;
}

export function buildSettingsRoute(
  tab?: StandardSettingsTabId | string | null,
  basePath = STANDARD_APP_ROUTES.settings,
): string {
  const path = normalizeLeadingPath(basePath);
  const normalizedTab = tab ? normalizeTabId(tab) : null;
  if (!normalizedTab || normalizedTab === STANDARD_SETTINGS_TABS.general) {
    return path;
  }
  return `${path}#${encodeURIComponent(normalizedTab)}`;
}

export function buildTeamRoute(
  options: Pick<BuildStandardAppRouteOptions, "teamInSettings"> = {},
): string {
  return options.teamInSettings
    ? buildSettingsRoute(STANDARD_SETTINGS_TABS.team)
    : STANDARD_APP_ROUTES.team;
}

export function buildStandardAppRoute(
  route: StandardAppRouteId,
  options: BuildStandardAppRouteOptions = {},
): string {
  if (route === "settings") return buildSettingsRoute(options.settingsTab);
  if (route === "team") return buildTeamRoute(options);
  return STANDARD_APP_ROUTES[route];
}

export function buildResourceRoute(
  collection: string,
  resourceId: string,
  options: BuildResourceRouteOptions = {},
): string {
  const base = normalizeLeadingPath(options.basePath ?? "/");
  const collectionPath = collection
    .split("/")
    .map((segment) => pathSegment(segment))
    .filter(Boolean)
    .join("/");
  if (!collectionPath) throw new Error("collection is required");
  if (!resourceId.trim()) throw new Error("resourceId is required");
  const prefix = base === "/" ? "" : base;
  return `${prefix}/${collectionPath}/${pathSegment(resourceId)}`;
}

export function buildOpenRoutePath(input: NavigationTarget): string {
  const sp = new URLSearchParams();
  if (input.app) sp.set("app", input.app);
  sp.set("view", input.view);
  if (input.to) sp.set("to", input.to);
  for (const [key, value] of Object.entries(input.params ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    sp.set(key, String(value));
  }
  return withCollapsedAgentSidebarParam(`${AGENT_NATIVE_OPEN_PATH}?${sp}`);
}

export function buildOpenRouteLink(
  input: NavigationTarget & { label?: string },
): NavigationLink {
  return {
    ...input,
    label: input.label ?? `Open ${input.view}`,
    url: buildOpenRoutePath(input),
  };
}

export function createStandardOpenPathResolver(
  routes: Record<string, StandardOpenPathRoute>,
  options: StandardOpenPathResolverOptions = {},
) {
  return (input: {
    app?: string;
    view?: string;
    params: Record<string, string>;
  }): string | null | undefined => {
    void input.app;
    if (!input.view)
      return resolveOpenPathRoute(options.fallback, input.params);
    return (
      resolveOpenPathRoute(routes[input.view], input.params) ??
      resolveOpenPathRoute(options.fallback, input.params) ??
      `/${input.view}`
    );
  };
}
