import { docSourceFilenamesForSlug } from "../../lib/docs-source";
import {
  DEFAULT_DOCS_LOCALE,
  isDocsLocale,
  type DocsLocale,
} from "./docs-locale";

// SEO only needs to know whether a source file exists. Keep these globs lazy so
// importing the root layout does not pull the full markdown corpus into every
// page's initial module graph.
const defaultDocLoaders = {
  ...import.meta.glob("../../../core/docs/content/*.md", {
    query: "?raw",
    import: "default",
  }),
  ...import.meta.glob("../../../core/docs/content/*.mdx", {
    query: "?raw",
    import: "default",
  }),
};

const localizedDocLoaders = {
  ...import.meta.glob("../../../core/docs/content/locales/*/*.md", {
    query: "?raw",
    import: "default",
  }),
  ...import.meta.glob("../../../core/docs/content/locales/*/*.mdx", {
    query: "?raw",
    import: "default",
  }),
};

function sourceExists(
  sources: Record<string, unknown>,
  prefix: string,
  slug: string,
): boolean {
  return docSourceFilenamesForSlug(slug).some(
    (filename) => `${prefix}${filename}` in sources,
  );
}

export function hasAvailableDoc(locale: unknown, slug: string): boolean {
  const docsLocale: DocsLocale = isDocsLocale(locale)
    ? locale
    : DEFAULT_DOCS_LOCALE;
  if (docsLocale === DEFAULT_DOCS_LOCALE) {
    return sourceExists(defaultDocLoaders, "../../../core/docs/content/", slug);
  }
  return sourceExists(
    localizedDocLoaders,
    `../../../core/docs/content/locales/${docsLocale}/`,
    slug,
  );
}
