import { hasLocalizedDoc } from "./docs-content";
import {
  DEFAULT_DOCS_LOCALE,
  DOCS_LOCALES,
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
  return CANONICAL_ALIASES[path] ?? path;
}

function canonicalDocsPathForSlug(slug: string, locale: DocsLocale) {
  return canonicalPathForPath(docsPathForSlug(slug, locale));
}

export function docsAlternateLinksForPath(
  pathname: string,
): DocsAlternateLink[] {
  const slug = docsSlugFromPathname(pathname);
  if (!slug || !hasLocalizedDoc(DEFAULT_DOCS_LOCALE, slug)) return [];

  const links: DocsAlternateLink[] = [
    {
      hrefLang: DEFAULT_DOCS_LOCALE,
      path: canonicalDocsPathForSlug(slug, DEFAULT_DOCS_LOCALE),
    },
  ];

  for (const locale of DOCS_LOCALES) {
    if (locale === DEFAULT_DOCS_LOCALE) continue;
    if (!hasLocalizedDoc(locale, slug)) continue;
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
