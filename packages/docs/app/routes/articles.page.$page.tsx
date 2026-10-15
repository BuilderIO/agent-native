import { useLoaderData, type LoaderFunctionArgs } from "react-router";

import { ARTICLES_BASE, ARTICLES_PAGE_SIZE } from "../../lib/campaign-content";
import { loadCampaignContent } from "../../lib/campaign-content.server";
import { ArticlesList } from "../components/campaign/articles";
import {
  newestArticles,
  publicArticle,
} from "../components/campaign/public-content";
import enUS from "../i18n/en-US";
import { campaignMeta } from "../lib/campaign-seo";

export function loader({ params }: LoaderFunctionArgs) {
  if (!params.page || !/^[1-9]\d*$/.test(params.page))
    throw new Response(null, { status: 404 });
  const page = Number(params.page);
  const articles = newestArticles(loadCampaignContent().articles);
  const start = (page - 1) * ARTICLES_PAGE_SIZE;
  if (!Number.isSafeInteger(page) || start >= articles.length)
    throw new Response(null, { status: 404 });
  return {
    articles: articles
      .slice(start, start + ARTICLES_PAGE_SIZE)
      .map(publicArticle),
    page,
    hasMore: start + ARTICLES_PAGE_SIZE < articles.length,
  };
}
export const meta = ({
  data,
  loaderData,
  params,
}: {
  params?: { locale?: string };
  data?: ReturnType<typeof loader>;
  loaderData?: ReturnType<typeof loader>;
}) => {
  const content = data ?? loaderData;
  return content
    ? campaignMeta(
        enUS.campaign.articles,
        enUS.campaign.articlesIntro,
        `${ARTICLES_BASE}/page/${content.page}`,
        "website",
        params?.locale,
      )
    : [];
};
export default function ArticlesPageRoute() {
  return <ArticlesList {...useLoaderData<typeof loader>()} />;
}
