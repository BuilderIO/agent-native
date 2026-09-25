import {
  buildSettingsRoute,
  STANDARD_APP_ROUTES,
} from "../../../navigation/index.js";
import {
  isCoreSettingsPageId,
  resolveLegacySettingsId,
  resolveSettingsIdPattern,
  resolveSettingsSectionRedirect,
  type SettingsRedirect,
} from "../../../navigation/settings-redirects.js";
import { appMountedPath, appMountPath } from "../../api-path.js";
import type { SettingsPageDefinition } from "./registry.js";

export interface SettingsLocation {
  pathname: string;
  hash: string;
  /** The query string. `?section=` names a template tab (Mail, Brain). */
  search?: string;
  /** An `agent-panel:open-settings` section carried in history state. */
  section?: string | null;
}

export interface SettingsRoute {
  page: string | null;
  sub: string | null;
}

export interface ResolvedSettingsRoute extends SettingsRoute {
  /** In-page target to scroll to: a row or group id, a section id, or `secrets:KEY`. */
  anchor: string | null;
  /**
   * The URL named the page through a legacy form, so the shell replaces it
   * with the page's own path (keeping the query).
   */
  legacy: boolean;
}

export interface ResolveSettingsRouteOptions {
  /** Tabs on the app's General page, routed `/settings/app/<id>`. */
  appAreaIds?: readonly string[];
  /**
   * The tab a controlled template chose. A bare `/settings` opens it, which
   * covers the moment between a template stripping `?section=` from the URL
   * and the shell navigating to the page it named.
   */
  tabValue?: string | null;
}

/**
 * `history.state` key for the section an `agent-panel:open-settings` request
 * named. Today's Settings reads only the hash it navigates to; the shell reads
 * this first because that hash can't tell API keys from Integrations.
 */
export const SETTINGS_SECTION_STATE_KEY = "agentNativeSettingsSection";

const SETTINGS_PREFIX = STANDARD_APP_ROUTES.settings;

const NO_ROUTE: ResolvedSettingsRoute = {
  page: null,
  sub: null,
  anchor: null,
  legacy: false,
};

/** Strips a workspace mount (`/dispatch/settings/…` → `/settings/…`). */
export function settingsLocalPathname(pathname: string): string {
  const mountPath = appMountPath(SETTINGS_PREFIX);
  if (
    mountPath &&
    (pathname === mountPath || pathname.startsWith(`${mountPath}/`))
  ) {
    return pathname.slice(mountPath.length) || "/";
  }
  return pathname;
}

export function isSettingsPathname(pathname: string): boolean {
  const local = settingsLocalPathname(pathname);
  return local === SETTINGS_PREFIX || local.startsWith(`${SETTINGS_PREFIX}/`);
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    // coercion-ok: a malformed external segment still routes by its raw text.
    return segment;
  }
}

export function settingsPathSegments(pathname: string): string[] {
  const local = settingsLocalPathname(pathname);
  if (!local.startsWith(`${SETTINGS_PREFIX}/`)) return [];
  return local
    .slice(SETTINGS_PREFIX.length + 1)
    .split("/")
    .filter(Boolean)
    .map(decodeSegment);
}

/** `/settings/:page` or `/settings/:page/:sub`. */
export function settingsPagePath(page: string, sub?: string | null): string {
  return buildSettingsRoute(page, sub ?? null);
}

/** The browser URL for a page, keeping a workspace mount prefix. */
export function settingsPageHref(page: string, sub?: string | null): string {
  return appMountedPath(settingsPagePath(page, sub), SETTINGS_PREFIX);
}

/** The `?section=` a Mail or Brain deep link carries, if any. */
export function settingsSectionParam(search: string | undefined): string {
  if (!search) return "";
  return new URLSearchParams(search).get("section")?.trim() ?? "";
}

function redirectRoute(
  redirect: SettingsRedirect,
  pages: readonly SettingsPageDefinition[],
  fallbackAnchor: string | null,
): ResolvedSettingsRoute {
  const exists = (id: string) => pages.some((page) => page.id === id);
  const page =
    !exists(redirect.page) &&
    redirect.fallbackPage &&
    exists(redirect.fallbackPage)
      ? redirect.fallbackPage
      : redirect.page;
  return {
    page,
    sub: page === redirect.page ? (redirect.sub ?? null) : null,
    anchor: redirect.anchor ?? fallbackAnchor,
    legacy: true,
  };
}

/** Pages a template contributed (its own tabs), which own their tab ids. */
function isAppPage(page: SettingsPageDefinition): boolean {
  return !isCoreSettingsPageId(page.id);
}

function pageForTabIds(
  ids: readonly string[],
  pages: readonly SettingsPageDefinition[],
): SettingsPageDefinition | undefined {
  for (let length = ids.length; length > 0; length -= 1) {
    const id = ids.slice(0, length).join(":");
    const page = pages.find((candidate) =>
      candidate.legacyTabIds?.includes(id),
    );
    if (page) return page;
  }
  return undefined;
}

/**
 * The page a template's tab id opens. The template's own tabs win, because
 * its id space is its own: Mail's inbox `automations` tab is not the core
 * Automations page.
 */
export function resolveSettingsTabValue(
  value: string,
  pages: readonly SettingsPageDefinition[],
  appAreaIds: readonly string[] = [],
): ResolvedSettingsRoute {
  const tab = value.trim();
  if (!tab) return NO_ROUTE;
  const appPage = pages.find(
    (page) =>
      isAppPage(page) && (page.id === tab || page.legacyTabIds?.includes(tab)),
  );
  if (appPage) {
    return { page: appPage.id, sub: null, anchor: null, legacy: true };
  }
  if (appAreaIds.includes(tab)) {
    return { page: "app", sub: tab, anchor: null, legacy: true };
  }
  const redirect = resolveLegacySettingsId(tab, "tab");
  if (redirect) return redirectRoute(redirect, pages, null);
  const page =
    pages.find((candidate) => candidate.id === tab) ??
    pageForTabIds(tab.split(":"), pages);
  return page
    ? { page: page.id, sub: null, anchor: null, legacy: true }
    : NO_ROUTE;
}

/**
 * Which page a Settings URL names, through the legacy redirect table
 * (`settings-redirects.ts`) when it isn't a page's own path. `legacy` routes
 * are rewritten by the shell; an unknown id comes back as named so the shell
 * can send it to Profile.
 */
export function resolveSettingsRoute(
  location: SettingsLocation,
  pages: readonly SettingsPageDefinition[],
  options: ResolveSettingsRouteOptions = {},
): ResolvedSettingsRoute {
  const segments = settingsPathSegments(location.pathname);
  const hash = decodeSegment(location.hash.replace(/^#/, ""));
  if (segments.length > 0) {
    const joined = segments.join(":");
    const pageId = segments[0]!;
    if (pages.some((page) => page.id === pageId)) {
      const pattern = segments.length > 1 && resolveSettingsIdPattern(joined);
      if (pattern) return redirectRoute(pattern, pages, hash || null);
      return {
        page: pageId,
        sub: segments[1] ?? null,
        anchor: hash || null,
        legacy: segments.length > 2,
      };
    }
    const redirect = resolveLegacySettingsId(joined, "tab");
    if (redirect) return redirectRoute(redirect, pages, hash || null);
    const tabPage = pageForTabIds(segments, pages);
    if (tabPage) {
      return {
        page: tabPage.id,
        sub: null,
        anchor: hash || null,
        legacy: true,
      };
    }
    return {
      page: pageId,
      sub: segments[1] ?? null,
      anchor: null,
      legacy: false,
    };
  }

  if (location.section) {
    return redirectRoute(
      resolveSettingsSectionRedirect(location.section, hash),
      pages,
      null,
    );
  }
  if (hash) {
    const redirect = resolveLegacySettingsId(hash, "section");
    if (redirect) return redirectRoute(redirect, pages, null);
    const page =
      pages.find((candidate) => candidate.id === hash) ??
      pageForTabIds(hash.split(":"), pages);
    if (page) return { page: page.id, sub: null, anchor: null, legacy: true };
    const owner = pages.find((candidate) =>
      candidate.searchEntries?.some(
        (entry) => entry.anchor === hash || entry.id === hash,
      ),
    );
    if (owner) {
      return { page: owner.id, sub: null, anchor: hash, legacy: true };
    }
  }
  const section = settingsSectionParam(location.search);
  if (section) {
    const route = resolveSettingsTabValue(section, pages, options.appAreaIds);
    if (route.page) return route;
  }
  if (options.tabValue) {
    return resolveSettingsTabValue(options.tabValue, pages, options.appAreaIds);
  }
  return NO_ROUTE;
}
