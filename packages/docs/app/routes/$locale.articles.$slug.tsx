import type { LoaderFunctionArgs } from "react-router";

import { ARTICLES_BASE } from "../../lib/site-content";
import { loadSiteContent } from "../../lib/site-content.server";
import { docsLocaleFromSegment } from "../components/docs-locale";
import { articleDataFor, loader as englishLoader } from "./articles.$slug";
import { redirectLocalizedSiteContent } from "./localized-site-content-redirect";

export { default, meta } from "./articles.$slug";

// An article translated into this language is served here; any other article
// redirects to its English version, and an unknown one is the English route's
// 404.
export function loader(args: LoaderFunctionArgs) {
  const { params, request } = args;
  const content = loadSiteContent();
  const entry = content.articles.find(
    (article) => article.slug === params.slug,
  );
  if (!entry) return englishLoader(args);
  const locale = docsLocaleFromSegment(params.locale);
  const translation = locale ? entry.translations[locale] : undefined;
  if (locale && translation)
    return articleDataFor(content, entry, translation, locale);
  return redirectLocalizedSiteContent(
    request,
    params.locale,
    `${ARTICLES_BASE}/${params.slug}/`,
  );
}
