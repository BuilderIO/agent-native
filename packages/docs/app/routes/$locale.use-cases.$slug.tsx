import type { LoaderFunctionArgs } from "react-router";

import { USE_CASES_BASE } from "../../lib/campaign-content";
import { loadCampaignContent } from "../../lib/campaign-content.server";
import { redirectLocalizedCampaign } from "./localized-campaign-redirect";

export function loader({ params, request }: LoaderFunctionArgs) {
  if (!loadCampaignContent().useCases.some((item) => item.slug === params.slug))
    throw new Response(null, { status: 404 });
  return redirectLocalizedCampaign(
    request,
    params.locale,
    `${USE_CASES_BASE}/${params.slug}/`,
  );
}
