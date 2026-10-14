import { useLoaderData, type LoaderFunctionArgs } from "react-router";

import { loadCampaignContent } from "../../lib/campaign-content";
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
  const start = (page - 1) * 12;
  if (!Number.isSafeInteger(page) || start >= articles.length)
    throw new Response(null, { status: 404 });
  return {
    articles: articles.slice(start, start + 12).map(publicArticle),
    page,
    hasMore: start + 12 < articles.length,
  };
}
export const meta = ({
  data,
  loaderData,
}: {
  data?: ReturnType<typeof loader>;
  loaderData?: ReturnType<typeof loader>;
}) => {
  const content = data ?? loaderData;
  return content
    ? campaignMeta(
        enUS.campaign.articles,
        enUS.campaign.articlesIntro,
        `/articles/page/${content.page}`,
      )
    : [];
};
export default function ArticlesPageRoute() {
  return <ArticlesList {...useLoaderData<typeof loader>()} />;
}
