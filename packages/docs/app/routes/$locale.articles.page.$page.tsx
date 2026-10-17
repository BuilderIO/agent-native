import type { LoaderFunctionArgs } from "react-router";

import { ARTICLES_BASE, ARTICLES_PAGE_SIZE } from "../../lib/campaign-content";
import { loadCampaignContent } from "../../lib/campaign-content.server";
import { redirectLocalizedCampaign } from "./localized-campaign-redirect";

export function loader({ params, request }: LoaderFunctionArgs) {
  if (!params.page || !/^[1-9]\d*$/.test(params.page))
    throw new Response(null, { status: 404 });
  const page = Number(params.page);
  if (page === 1)
    return redirectLocalizedCampaign(
      request,
      params.locale,
      `${ARTICLES_BASE}/`,
    );
  const articleCount = loadCampaignContent().articles.length;
  const start = (page - 1) * ARTICLES_PAGE_SIZE;
  if (!Number.isSafeInteger(page) || start >= articleCount)
    throw new Response(null, { status: 404 });
  return redirectLocalizedCampaign(
    request,
    params.locale,
    `${ARTICLES_BASE}/page/${page}/`,
  );
}
