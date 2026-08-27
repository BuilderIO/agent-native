import {
  DEFAULT_LOCALE,
  LOCALE_METADATA,
  localeDirection,
  normalizeLocaleCode,
  resolveLocaleFromCandidates,
  type LocaleCode,
} from "@agent-native/core/client/i18n";

export type DocsLocale = LocaleCode;

export const DEFAULT_DOCS_LOCALE = DEFAULT_LOCALE;
export const DOCS_LOCALES = [
  "en-US",
  "es-ES",
  "fr-FR",
  "de-DE",
  "pt-BR",
  "zh-CN",
  "zh-TW",
  "ja-JP",
  "ko-KR",
  "hi-IN",
  "ar-SA",
] as const satisfies readonly DocsLocale[];
export const DOCS_LOCALE_METADATA = LOCALE_METADATA;
export { localeDirection };

export function docsLocaleOptionLabel(locale: DocsLocale) {
  const metadata = DOCS_LOCALE_METADATA[locale];
  return `${metadata.nativeName} (${locale})`;
}

function normalizePath(pathname: string) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function pathSegments(pathname: string) {
  return normalizePath(pathname).split("/").filter(Boolean);
}

/**
 * Netlify lowercases locale path segments, so an emitted URL must use the
 * lowercase form to be the one that answers 200. The locale tag itself stays
 * BCP-47 everywhere else -- `hreflang` values and translation lookups both
 * depend on the cased form.
 */
function localeSegment(locale: DocsLocale) {
  return locale.toLowerCase();
}

function docsBasePath(locale: DocsLocale) {
  return locale === DEFAULT_DOCS_LOCALE
    ? "/docs"
    : `/${localeSegment(locale)}/docs`;
}

/** Markdown twins and machine-readable endpoints answer at an exact URL. */
function isFileLikePath(pathname: string) {
  return (pathname.split("/").pop() ?? "").includes(".");
}

/**
 * Resolve a URL locale segment to its canonical locale, accepting any casing.
 * The counterpart to `localeSegment`: emitted paths are lowercase, so route
 * params arrive lowercase, and comparing them against the BCP-47 tag rejects
 * every localized URL the site serves. Matches supported locales only -- no
 * language-prefix fallback, so a real doc slug can never read as a locale.
 */
export function docsLocaleFromSegment(
  segment: unknown,
): DocsLocale | undefined {
  if (typeof segment !== "string") return undefined;
  const lower = segment.toLowerCase();
  return DOCS_LOCALES.find((locale) => locale.toLowerCase() === lower);
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

/**
 * The canonical route path: trailing slash, lowercase locale segment. This is
 * the form the CDN answers 200 for, so canonical tags, alternates, sitemap
 * entries, redirect targets, prerender paths, and internal links all use it.
 * Non-route strings must not be built by appending onto it -- see
 * `docsMarkdownPathForSlug` and `comparableDocsPath`.
 */
export function docsPathForSlug(
  slug: string,
  locale: DocsLocale = DEFAULT_DOCS_LOCALE,
) {
  const base = docsBasePath(locale);
  return slug === "getting-started" ? `${base}/` : `${base}/${slug}/`;
}

export function docsMarkdownPathForSlug(
  slug: string,
  locale: DocsLocale = DEFAULT_DOCS_LOCALE,
) {
  return `${docsBasePath(locale)}/${slug}.md`;
}

export function comparableDocsPath(pathname: string) {
  const slug = docsSlugFromPathname(pathname);
  return slug
    ? normalizePath(docsPathForSlug(slug, DEFAULT_DOCS_LOCALE))
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
  if (isFileLikePath(normalized)) return normalized;

  const docsSlug = docsSlugFromPathname(normalized);
  if (docsSlug) return docsPathForSlug(docsSlug, locale);

  const segments = pathSegments(normalized);
  const prefixLocale = normalizeLocaleCode(segments[0]);
  const unprefixedSegments = prefixLocale ? segments.slice(1) : segments;
  const unprefixedPath = unprefixedSegments.length
    ? `/${unprefixedSegments.join("/")}/`
    : "/";

  if (locale === DEFAULT_DOCS_LOCALE) return unprefixedPath;
  return unprefixedPath === "/"
    ? `/${localeSegment(locale)}/`
    : `/${localeSegment(locale)}${unprefixedPath}`;
}

/**
 * Rewrite a same-site `/docs/...` href from a doc body to the canonical URL.
 * An href that already names a locale keeps that locale; otherwise it inherits
 * the page's. Both forms are rewritten rather than passed through: a body link
 * written as `/docs/client-data` or `/de-DE/docs/client-data` still resolves,
 * but only after a redirect, and rendered pages are where most internal links
 * on the site come from.
 *
 * Leaves external, relative, in-page (`#anchor`), file-like (Markdown twins),
 * and non-docs hrefs alone.
 */
export function localizeDocsHref(href: string, locale: DocsLocale): string {
  // Split on whichever comes first: a query would otherwise be read as part of
  // the slug and land inside the path, as `/docs/x?tab=api/`.
  const suffixIndex = href.search(/[?#]/);
  const path = suffixIndex === -1 ? href : href.slice(0, suffixIndex);
  const suffix = suffixIndex === -1 ? "" : href.slice(suffixIndex);
  if (!path || !path.startsWith("/") || isFileLikePath(path)) return href;
  if (!isDocsPath(path)) return href;
  const slug = docsSlugFromPathname(path);
  if (!slug) return href;
  const target = routeLocaleFromPathname(path) ?? locale;
  return `${docsPathForSlug(slug, target)}${suffix}`;
}

/**
 * Apply `localizeDocsHref` to every same-site link in a Markdown body. The
 * generated Markdown twins are served to agents verbatim, so without this they
 * hand out the redirecting form of every internal link.
 */
export function localizeDocsMarkdownLinks(
  markdown: string,
  locale: DocsLocale,
): string {
  // Fenced and inline code are literal samples a reader copies. Rewriting a
  // link inside one edits the example instead of the page's own links, so the
  // split keeps code spans out of the rewrite.
  return markdown
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(
            /(\]\()(\/[^)\s]+)(\))/g,
            (_match, open: string, href: string, close: string) =>
              `${open}${localizeDocsHref(href, locale)}${close}`,
          ),
    )
    .join("");
}

export function browserDocsLocale() {
  if (typeof navigator === "undefined") return DEFAULT_DOCS_LOCALE;
  return resolveLocaleFromCandidates(
    navigator.languages?.length ? navigator.languages : [navigator.language],
  );
}
