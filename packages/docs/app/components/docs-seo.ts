import { hasAvailableDoc } from "./docs-availability";
import {
  DEFAULT_DOCS_LOCALE,
  DOCS_LOCALES,
  docsLocaleFromPathname,
  docsMarkdownPathForSlug,
  docsPathForSlug,
  docsSlugFromPathname,
  type DocsLocale,
} from "./docs-locale";

export const CANONICAL_ALIASES: Record<string, string> = {
  "/docs/getting-started": "/docs",
};

export interface DocsAlternateLink {
  hrefLang: string;
  path: string;
}

function normalizePath(pathname: string) {
  return pathname.replace(/\/$/, "") || "/";
}

export function canonicalPathForPath(pathname: string) {
  const path = normalizePath(pathname);
  const slug = docsSlugFromPathname(path);
  if (slug === "getting-started") {
    return docsPathForSlug(
      "getting-started",
      docsLocaleFromPathname(path) ?? DEFAULT_DOCS_LOCALE,
    );
  }
  return CANONICAL_ALIASES[path] ?? path;
}

function canonicalDocsPathForSlug(slug: string, locale: DocsLocale) {
  return canonicalPathForPath(docsPathForSlug(slug, locale));
}

export function docsMarkdownPathForDoc(
  slug: string,
  locale: DocsLocale = DEFAULT_DOCS_LOCALE,
) {
  const markdownLocale = hasAvailableDoc(locale, slug)
    ? locale
    : DEFAULT_DOCS_LOCALE;
  if (!hasAvailableDoc(markdownLocale, slug)) return null;
  return docsMarkdownPathForSlug(slug, markdownLocale);
}

export function docsMarkdownPathForPath(pathname: string) {
  const slug = docsSlugFromPathname(pathname);
  if (!slug) return null;
  return docsMarkdownPathForDoc(
    slug,
    docsLocaleFromPathname(pathname) ?? DEFAULT_DOCS_LOCALE,
  );
}

export function docsAlternateLinksForPath(
  pathname: string,
): DocsAlternateLink[] {
  const slug = docsSlugFromPathname(pathname);
  if (!slug || !hasAvailableDoc(DEFAULT_DOCS_LOCALE, slug)) return [];

  const links: DocsAlternateLink[] = [
    {
      hrefLang: DEFAULT_DOCS_LOCALE,
      path: canonicalDocsPathForSlug(slug, DEFAULT_DOCS_LOCALE),
    },
  ];

  for (const locale of DOCS_LOCALES) {
    if (locale === DEFAULT_DOCS_LOCALE) continue;
    if (!hasAvailableDoc(locale, slug)) continue;
    links.push({
      hrefLang: locale,
      path: canonicalDocsPathForSlug(slug, locale),
    });
  }

  links.push({
    hrefLang: "x-default",
    path: canonicalDocsPathForSlug(slug, DEFAULT_DOCS_LOCALE),
  });

  return links;
}
