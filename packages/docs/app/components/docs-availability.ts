import { docSourceFilenamesForSlug } from "../../lib/docs-source";
import {
  DEFAULT_DOCS_LOCALE,
  docsLocaleFromSegment,
  type DocsLocale,
} from "./docs-locale";
// SEO only needs to know whether a source file exists, so this reads only the
// KEYS of the shared map — the loaders are never called here.
import {
  docSourceLoaders as defaultDocLoaders,
  localizedDocLoaders,
} from "./docs-source-loaders";

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
  const docsLocale: DocsLocale =
    docsLocaleFromSegment(locale) ?? DEFAULT_DOCS_LOCALE;
  if (docsLocale === DEFAULT_DOCS_LOCALE) {
    return sourceExists(defaultDocLoaders, "../../../core/docs/content/", slug);
  }
  return sourceExists(
    localizedDocLoaders,
    `../../../core/docs/content/locales/${docsLocale}/`,
    slug,
  );
}
