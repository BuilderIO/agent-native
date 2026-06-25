import {
  DEFAULT_LOCALE,
  LOCALE_METADATA,
  SUPPORTED_LOCALES,
  localeDirection,
  normalizeLocaleCode,
  resolveLocaleFromCandidates,
  type LocaleCode,
} from "@agent-native/core/client";

export type DocsLocale = LocaleCode;

export const DEFAULT_DOCS_LOCALE = DEFAULT_LOCALE;
export const DOCS_LOCALES = SUPPORTED_LOCALES;
export const DOCS_LOCALE_METADATA = LOCALE_METADATA;
export { localeDirection };

function normalizePath(pathname: string) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function pathSegments(pathname: string) {
  return normalizePath(pathname).split("/").filter(Boolean);
}

export function isDocsLocale(value: unknown): value is DocsLocale {
  return normalizeLocaleCode(value) === value;
}

export function routeLocaleFromPathname(
  pathname: string,
): DocsLocale | undefined {
  const segments = pathSegments(pathname);
  const prefixLocale = normalizeLocaleCode(segments[0]);
  if (prefixLocale) return prefixLocale;
  if (segments[0] === "docs") {
    return normalizeLocaleCode(segments[1]) ?? undefined;
  }
  return undefined;
}

export function docsLocaleFromPathname(
  pathname: string,
): DocsLocale | undefined {
  if (!isDocsPath(pathname)) return undefined;
  return routeLocaleFromPathname(pathname);
}

export function docsSlugFromPathname(pathname: string): string | undefined {
  const segments = pathSegments(pathname);
  const prefixLocale = normalizeLocaleCode(segments[0]);
  const docsIndex = prefixLocale ? 1 : 0;
  if (segments[docsIndex] !== "docs") return undefined;
  if (segments.length === docsIndex + 1) return "getting-started";

  if (!prefixLocale) {
    const legacyLocale = normalizeLocaleCode(segments[1]);
    if (legacyLocale) return segments[2] ?? "getting-started";
  }

  return segments[docsIndex + 1] ?? "getting-started";
}

export function isDocsPath(pathname: string) {
  return docsSlugFromPathname(pathname) !== undefined;
}

export function docsPathForSlug(
  slug: string,
  locale: DocsLocale = DEFAULT_DOCS_LOCALE,
) {
  if (locale === DEFAULT_DOCS_LOCALE) {
    return slug === "getting-started" ? "/docs" : `/docs/${slug}`;
  }
  return slug === "getting-started"
    ? `/${locale}/docs`
    : `/${locale}/docs/${slug}`;
}

export function comparableDocsPath(pathname: string) {
  const slug = docsSlugFromPathname(pathname);
  return slug
    ? docsPathForSlug(slug, DEFAULT_DOCS_LOCALE)
    : normalizePath(pathname);
}

export function localizedDocsPath(pathname: string, locale: DocsLocale) {
  const slug = docsSlugFromPathname(pathname);
  if (!slug) return pathname;
  return docsPathForSlug(slug, locale);
}

export function sitePathForLocale(
  pathname: string,
  locale: DocsLocale = DEFAULT_DOCS_LOCALE,
) {
  const normalized = normalizePath(pathname);
  const docsSlug = docsSlugFromPathname(normalized);
  if (docsSlug) return docsPathForSlug(docsSlug, locale);

  const segments = pathSegments(normalized);
  const prefixLocale = normalizeLocaleCode(segments[0]);
  const unprefixedSegments = prefixLocale ? segments.slice(1) : segments;
  const unprefixedPath = unprefixedSegments.length
    ? `/${unprefixedSegments.join("/")}`
    : "/";

  if (locale === DEFAULT_DOCS_LOCALE) return unprefixedPath;
  return unprefixedPath === "/" ? `/${locale}` : `/${locale}${unprefixedPath}`;
}

export function browserDocsLocale() {
  if (typeof navigator === "undefined") return DEFAULT_DOCS_LOCALE;
  return resolveLocaleFromCandidates(
    navigator.languages?.length ? navigator.languages : [navigator.language],
  );
}
