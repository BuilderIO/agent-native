import type { LoaderFunctionArgs } from "react-router";

import {
  ARTICLES_BASE,
  ARTICLES_PAGE_SIZE,
  translatedArticleLocales,
} from "../../lib/campaign-content";
import { loadCampaignContent } from "../../lib/campaign-content.server";
import { docsLocaleFromSegment } from "../components/docs-locale";
import { loader as englishLoader } from "./articles.page.$page";
import { redirectLocalizedCampaign } from "./localized-campaign-redirect";

export { default, meta } from "./articles.page.$page";

export function loader(args: LoaderFunctionArgs) {
  const { params, request } = args;
  const locale = docsLocaleFromSegment(params.locale);
  const { articles } = loadCampaignContent();
  if (locale && translatedArticleLocales(articles).includes(locale))
    return englishLoader(args);
  if (!params.page || !/^[1-9]\d*$/.test(params.page))
    throw new Response(null, { status: 404 });
  const page = Number(params.page);
  if (page === 1)
    return redirectLocalizedCampaign(
      request,
      params.locale,
      `${ARTICLES_BASE}/`,
    );
  const start = (page - 1) * ARTICLES_PAGE_SIZE;
  if (!Number.isSafeInteger(page) || start >= articles.length)
    throw new Response(null, { status: 404 });
  return redirectLocalizedCampaign(
    request,
    params.locale,
    `${ARTICLES_BASE}/page/${page}/`,
  );
}
