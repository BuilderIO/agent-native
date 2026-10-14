import { useLoaderData } from "react-router";

import { loadCampaignContent } from "../../lib/campaign-content";
import { ArticlesList } from "../components/campaign/articles";
import {
  newestArticles,
  publicArticle,
} from "../components/campaign/public-content";
import enUS from "../i18n/en-US";
import { campaignMeta } from "../lib/campaign-seo";

export const meta = () =>
  campaignMeta(
    enUS.campaign.articles,
    enUS.campaign.articlesIntro,
    "/articles",
  );
export function loader() {
  const articles = newestArticles(loadCampaignContent().articles);
  return {
    articles: articles.slice(0, 12).map(publicArticle),
    page: 1,
    hasMore: articles.length > 12,
  };
}
export default function ArticlesRoute() {
  return <ArticlesList {...useLoaderData<typeof loader>()} />;
}
