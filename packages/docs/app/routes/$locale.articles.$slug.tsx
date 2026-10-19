import type { LoaderFunctionArgs } from "react-router";

import { ARTICLES_BASE } from "../../lib/campaign-content";
import { loadCampaignContent } from "../../lib/campaign-content.server";
import { redirectLocalizedCampaign } from "./localized-campaign-redirect";

export function loader({ params, request }: LoaderFunctionArgs) {
  if (
    !loadCampaignContent().articles.some(
      (article) => article.slug === params.slug,
    )
  )
    throw new Response(null, { status: 404 });
  return redirectLocalizedCampaign(
    request,
    params.locale,
    `${ARTICLES_BASE}/${params.slug}/`,
  );
}
