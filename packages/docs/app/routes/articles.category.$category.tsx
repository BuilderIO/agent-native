import { useLoaderData, type LoaderFunctionArgs } from "react-router";

import {
  ARTICLES_BASE,
  CATEGORY_NAMES,
  categories,
} from "../../lib/campaign-content";
import { loadCampaignContent } from "../../lib/campaign-content.server";
import { ArticlesList } from "../components/campaign/articles";
import {
  newestArticles,
  publicArticle,
} from "../components/campaign/public-content";
import enUS from "../i18n/en-US";
import { campaignMeta } from "../lib/campaign-seo";

export function loader({ params }: LoaderFunctionArgs) {
  const category = params.category;
  if (!category || !categories.some((value) => value === category))
    throw new Response(null, { status: 404 });
  return {
    articles: newestArticles(
      loadCampaignContent().articles.filter(
        (article) => article.category === category,
      ),
    ).map(publicArticle),
    category,
    page: 1,
    hasMore: false,
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
        CATEGORY_NAMES[content.category as keyof typeof CATEGORY_NAMES],
        enUS.campaign.articlesIntro,
        `${ARTICLES_BASE}/category/${content.category}`,
      )
    : [];
};
export default function ArticleCategoryRoute() {
  return <ArticlesList {...useLoaderData<typeof loader>()} />;
}
