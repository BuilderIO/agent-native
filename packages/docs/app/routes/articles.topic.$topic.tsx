import { useLoaderData, type LoaderFunctionArgs } from "react-router";

import { getArticleTopics } from "../../lib/article-topics";
import { ARTICLES_BASE } from "../../lib/campaign-content";
import { loadCampaignContent } from "../../lib/campaign-content.server";
import { ArticlesList } from "../components/campaign/articles";
import {
  newestArticles,
  publicArticle,
} from "../components/campaign/public-content";
import { campaignMeta } from "../lib/campaign-seo";

export function loader({ params }: LoaderFunctionArgs) {
  const articles = loadCampaignContent().articles;
  const topics = getArticleTopics(articles);
  const topic = topics.find((topic) => topic.slug === params.topic);
  if (!topic) throw new Response(null, { status: 404 });
  return {
    articles: newestArticles(
      articles.filter((article) => article.topic === topic.slug),
    ).map(publicArticle),
    topic: topic.slug,
    topics,
    page: 1,
    hasMore: false,
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
  const topic = content?.topics.find((topic) => topic.slug === content.topic);
  return topic
    ? campaignMeta(
        topic.name,
        topic.description,
        `${ARTICLES_BASE}/topic/${topic.slug}`,
        "website",
        params?.locale,
      )
    : [];
};
export default function ArticleTopicRoute() {
  return <ArticlesList {...useLoaderData<typeof loader>()} />;
}
