import type { LoaderFunctionArgs } from "react-router";

import { getArticleTopics } from "../../lib/article-topics";
import { ARTICLES_BASE } from "../../lib/campaign-content";
import { loadCampaignContent } from "../../lib/campaign-content.server";
import { redirectLocalizedCampaign } from "./localized-campaign-redirect";

export function loader({ params, request }: LoaderFunctionArgs) {
  const topic = getArticleTopics(loadCampaignContent().articles).find(
    (item) => item.slug === params.topic,
  );
  if (!topic) throw new Response(null, { status: 404 });
  return redirectLocalizedCampaign(
    request,
    params.locale,
    `${ARTICLES_BASE}/topic/${topic.slug}/`,
  );
}
