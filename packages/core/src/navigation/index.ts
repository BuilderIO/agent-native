import {
  AGENT_NATIVE_OPEN_PATH,
  withCollapsedAgentSidebarParam,
} from "../shared/agent-sidebar-url.js";
import type { SettingsRedirect } from "./settings-redirects.js";

export {
  CORE_SETTINGS_PAGE_ID_LIST,
  describeSettingsViewForAgent,
  isCoreSettingsPageId,
  isSettingsSectionId,
  legacySettingsTabIdsForPage,
  normalizeSettingsId,
  resolveLegacySettingsId,
  resolveSettingsIdPattern,
  resolveSettingsSectionRedirect,
  SETTINGS_PAGE_IDS,
  SETTINGS_SECTION_ALIASES,
  SETTINGS_VIEW_STATE_KEY,
  type CoreSettingsPageId,
  type SettingsRedirect,
  type SettingsViewState,
} from "./settings-redirects.js";

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
  mcp: "mcp",
  team: "organization",
  usage: "usage",
  language: "language",
  whatsNew: "whats-new",
} as const;

export type StandardAppRouteId = keyof typeof STANDARD_APP_ROUTES;
export type StandardSettingsTabId =
  (typeof STANDARD_SETTINGS_TABS)[keyof typeof STANDARD_SETTINGS_TABS];

export interface BuildStandardAppRouteOptions {
  settingsTab?: string | null;
  teamInSettings?: boolean;
}

export interface BuildSettingsRouteOptions {
  /** Defaults to `/settings`. */
  basePath?: string;
  /** In-page target appended as the hash, for example a `SettingsRow` id. */
  anchor?: string | null;
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

const LEGACY_AGENT_RESOURCE_TABS = new Set([
  "files",
  "instructions",
  "agents",
  "memory",
  "skills",
  "learnings",
]);

const LEGACY_AGENT_SETTINGS_TABS = new Set([
  "llm",
  "app-models",
  "limits",
  "voice",
  "background",
]);

function normalizeLeadingPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "/") return "/";
  return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

const SECRET_KEY_IN_TAB_ID = /(?:^|:)secrets:(.+)$/i;

function normalizeTabId(tab: string): string {
  const normalized = tab
    .trim()
    .replace(/^#/, "")
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[\s_]+/g, "-");
  if (normalized === "connections") return "integrations";
  if (normalized === "team") return "organization";
  if (
    normalized === "changelog" ||
    normalized === "what-s-new" ||
    normalized === "updates"
  ) {
    return "whats-new";
  }
  return normalized;
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

/**
 * A Settings URL. Pass a page id and an optional sub-page
 * (`buildSettingsRoute("integrations", "builder")` is
 * `/settings/integrations/builder`). Today's `a:b:c` tab ids still work
 * (`agent:resources:files` is `/settings/agent/resources/files`); the
 * redirect table maps them onto the new pages.
 *
 * The second argument used to be the base path; a value starting with "/"
 * is still read that way. Pass `{ basePath }` instead.
 */
export function buildSettingsRoute(
  page?: string | null,
  subOrBasePath?: string | null,
  options: BuildSettingsRouteOptions = {},
): string {
  const legacyBasePath = subOrBasePath?.startsWith("/") ?? false;
  const sub = legacyBasePath ? null : subOrBasePath;
  const path = normalizeLeadingPath(
    (legacyBasePath ? subOrBasePath : options.basePath) ??
      STANDARD_APP_ROUTES.settings,
  );
  // A secret key is a case-sensitive env name (`OPENAI_API_KEY`); tab-id
  // normalization would lowercase it and swap `_` for `-`, so the key the
  // route opens would match no secret.
  const secret = page ? SECRET_KEY_IN_TAB_ID.exec(page) : null;
  const secretKey = secret?.[1];
  const tabId =
    page && secretKey
      ? page.slice(0, page.length - secretKey.length - 1)
      : page;
  const normalizedTab = tabId ? normalizeTabId(tabId) : null;
  const segments = [
    ...(normalizedTab || STANDARD_SETTINGS_TABS.general).split(":"),
    ...(secretKey ? [secretKey] : []),
    ...(sub ? [sub] : []),
  ]
    .map((segment) => pathSegment(segment))
    .filter(Boolean);
  const anchor = options.anchor?.trim().replace(/^#/, "");
  return `${path}/${segments.join("/")}${anchor ? `#${anchor}` : ""}`;
}

/** The URL a `SettingsRedirect` opens. */
export function buildSettingsRedirectRoute(redirect: SettingsRedirect): string {
  return buildSettingsRoute(redirect.page, redirect.sub ?? null, {
    anchor: redirect.anchor,
  });
}

/**
 * The URL for a search entry in today's tabbed Settings: its tab, plus the
 * section it scrolls to when that isn't the tab itself.
 */
export function buildSettingsEntryRoute(
  tabId: string,
  section?: string,
): string {
  const normalizedSection = section?.replace(/^#/, "").trim();
  if (!normalizedSection || normalizedSection === tabId) {
    return buildSettingsRoute(tabId);
  }
  if (normalizedSection.startsWith("agent:")) {
    return buildSettingsRoute(normalizedSection);
  }
  if (normalizedSection.startsWith(`${tabId}:`)) {
    return buildSettingsRoute(normalizedSection);
  }
  return buildSettingsRoute(`${tabId}:${normalizedSection}`);
}

export function buildLegacyAgentSettingsRoute(
  hash?: string | null,
  search = "",
): string {
  const legacyTab = hash?.replace(/^#/, "").toLowerCase() ?? "";
  const destination = LEGACY_AGENT_RESOURCE_TABS.has(legacyTab)
    ? buildSettingsRoute(`agent:resources:${legacyTab}`)
    : legacyTab === "remote-agents"
      ? buildSettingsRoute("agent:agents")
      : legacyTab === "connections"
        ? buildSettingsRoute("connections")
        : legacyTab === "jobs"
          ? buildSettingsRoute("agent:automations")
          : legacyTab === "library"
            ? buildSettingsRoute("library")
            : legacyTab === "access"
              ? buildSettingsRoute(STANDARD_SETTINGS_TABS.mcp)
              : LEGACY_AGENT_SETTINGS_TABS.has(legacyTab)
                ? buildSettingsRoute(`agent:${legacyTab}`)
                : buildSettingsRoute("agent");

  return `${destination}${search}`;
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
