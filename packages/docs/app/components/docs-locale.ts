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

export function isDocsLocale(value: unknown): value is DocsLocale {
  return normalizeLocaleCode(value) === value;
}

export function docsLocaleFromPathname(
  pathname: string,
): DocsLocale | undefined {
  const segments = normalizePath(pathname).split("/").filter(Boolean);
  if (segments[0] !== "docs") return undefined;
  const locale = normalizeLocaleCode(segments[1]);
  return locale ?? undefined;
}

export function docsSlugFromPathname(pathname: string): string | undefined {
  const segments = normalizePath(pathname).split("/").filter(Boolean);
  if (segments[0] !== "docs") return undefined;
  if (segments.length === 1) return "getting-started";
  const maybeLocale = normalizeLocaleCode(segments[1]);
  if (maybeLocale) return segments[2] ?? "getting-started";
  return segments[1] ?? "getting-started";
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
  return `/docs/${locale}/${slug}`;
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

export function browserDocsLocale() {
  if (typeof navigator === "undefined") return DEFAULT_DOCS_LOCALE;
  return resolveLocaleFromCandidates(
    navigator.languages?.length ? navigator.languages : [navigator.language],
  );
}
