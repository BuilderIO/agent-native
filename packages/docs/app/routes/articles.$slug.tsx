import { useLoaderData, type LoaderFunctionArgs } from "react-router";

import { ARTICLES_BASE } from "../../lib/campaign-content";
import { loadCampaignContent } from "../../lib/campaign-content.server";
import { ArticlePage } from "../components/campaign/articles";
import {
  newestArticles,
  publicArticle,
} from "../components/campaign/public-content";
import { campaignMeta } from "../lib/campaign-seo";

export function loader({ params }: LoaderFunctionArgs) {
  const content = loadCampaignContent();
  const item = content.articles.find((article) => article.slug === params.slug);
  if (!item) throw new Response(null, { status: 404 });
  const useCase = content.useCases.find(
    (useCase) => useCase.slug === item.use_case,
  );
  const candidates = newestArticles(
    content.articles.filter((article) => article.slug !== item.slug),
  );
  const more = [
    ...candidates.filter((article) => article.topic === item.topic),
    ...candidates.filter((article) => article.topic !== item.topic),
  ].slice(0, 3);
  return {
    article: publicArticle(item),
    useCase: useCase ? { slug: useCase.slug, title: useCase.title } : null,
    more: more.map(publicArticle),
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
        content.article.title,
        content.article.meta_description,
        `${ARTICLES_BASE}/${content.article.slug}`,
        "article",
        params?.locale,
      )
    : [];
};
export default function ArticleRoute() {
  return <ArticlePage {...useLoaderData<typeof loader>()} />;
}
