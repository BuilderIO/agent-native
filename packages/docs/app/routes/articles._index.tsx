import { useLoaderData } from "react-router";

import { ARTICLES_BASE, ARTICLES_PAGE_SIZE } from "../../lib/campaign-content";
import { loadCampaignContent } from "../../lib/campaign-content.server";
import { ArticlesList } from "../components/campaign/articles";
import {
  newestArticles,
  publicArticle,
} from "../components/campaign/public-content";
import enUS from "../i18n/en-US";
import { campaignMeta } from "../lib/campaign-seo";

export const meta = ({ params }: { params?: { locale?: string } } = {}) =>
  campaignMeta(
    enUS.campaign.articles,
    enUS.campaign.articlesIntro,
    ARTICLES_BASE,
    "website",
    params?.locale,
  );
export function loader() {
  const articles = newestArticles(loadCampaignContent().articles);
  return {
    articles: articles.slice(0, ARTICLES_PAGE_SIZE).map(publicArticle),
    page: 1,
    hasMore: articles.length > ARTICLES_PAGE_SIZE,
  };
}
export default function ArticlesRoute() {
  return <ArticlesList {...useLoaderData<typeof loader>()} />;
}
