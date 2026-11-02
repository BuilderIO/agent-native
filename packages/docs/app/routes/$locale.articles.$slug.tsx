import type { LoaderFunctionArgs } from "react-router";

import { ARTICLES_BASE } from "../../lib/campaign-content";
import { loadCampaignContent } from "../../lib/campaign-content.server";
import { docsLocaleFromSegment } from "../components/docs-locale";
import { articleDataFor, loader as englishLoader } from "./articles.$slug";
import { redirectLocalizedCampaign } from "./localized-campaign-redirect";

export { default, meta } from "./articles.$slug";

// An article translated into this language is served here; any other article
// redirects to its English version, and an unknown one is the English route's
// 404.
export function loader(args: LoaderFunctionArgs) {
  const { params, request } = args;
  const content = loadCampaignContent();
  const entry = content.articles.find(
    (article) => article.slug === params.slug,
  );
  if (!entry) return englishLoader(args);
  const locale = docsLocaleFromSegment(params.locale);
  const translation = locale ? entry.translations[locale] : undefined;
  if (locale && translation)
    return articleDataFor(content, entry, translation, locale);
  return redirectLocalizedCampaign(
    request,
    params.locale,
    `${ARTICLES_BASE}/${params.slug}/`,
  );
}
