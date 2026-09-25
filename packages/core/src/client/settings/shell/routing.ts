import { STANDARD_APP_ROUTES } from "../../../navigation/index.js";
import { appMountedPath, appMountPath } from "../../api-path.js";
import type { SettingsPageDefinition } from "./registry.js";

export interface SettingsLocation {
  pathname: string;
  hash: string;
}

export interface SettingsRoute {
  page: string | null;
  sub: string | null;
}

const SETTINGS_PREFIX = STANDARD_APP_ROUTES.settings;

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

function normalizeLegacyId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[\s_]+/g, "-");
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
  const segments = [page, sub].filter(
    (segment): segment is string => typeof segment === "string" && !!segment,
  );
  return `${SETTINGS_PREFIX}/${segments.map(encodeURIComponent).join("/")}`;
}

/** The browser URL for a page, keeping a workspace mount prefix. */
export function settingsPageHref(page: string, sub?: string | null): string {
  return appMountedPath(settingsPagePath(page, sub), SETTINGS_PREFIX);
}

function pageForLegacyId(
  id: string,
  pages: readonly SettingsPageDefinition[],
): SettingsPageDefinition | undefined {
  const normalized = normalizeLegacyId(id);
  if (!normalized) return undefined;
  return (
    pages.find((page) => page.id === normalized) ??
    pages.find((page) => page.legacyTabIds?.includes(normalized))
  );
}

/**
 * Which page a Settings URL names. New ids win; today's tab ids and nested
 * `a/b/c` ids resolve through each page's `legacyTabIds` by longest prefix,
 * and a bare `/settings#id` resolves the hash the same way. The full legacy
 * redirect table (section hashes, `?section=`, `/agent#…`) replaces the
 * fallback here, not the new-id path.
 */
export function resolveSettingsRoute(
  location: SettingsLocation,
  pages: readonly SettingsPageDefinition[],
): SettingsRoute {
  const segments = settingsPathSegments(location.pathname);
  if (segments.length > 0) {
    const direct = pages.find((page) => page.id === segments[0]);
    if (direct) return { page: direct.id, sub: segments[1] ?? null };
    for (let length = segments.length; length > 0; length -= 1) {
      const page = pageForLegacyId(segments.slice(0, length).join(":"), pages);
      if (page) return { page: page.id, sub: null };
    }
    return { page: segments[0], sub: segments[1] ?? null };
  }
  const hash = decodeSegment(location.hash.replace(/^#/, ""));
  if (hash) {
    const page =
      pageForLegacyId(hash, pages) ??
      pageForLegacyId(hash.split(":")[0] ?? "", pages) ??
      pages.find((candidate) =>
        candidate.searchEntries?.some(
          (entry) => entry.anchor === hash || entry.id === hash,
        ),
      );
    if (page) return { page: page.id, sub: null };
  }
  return { page: null, sub: null };
}
