import { useLoaderData, type LoaderFunctionArgs } from "react-router";

import { USE_CASES_BASE } from "../../lib/campaign-content";
import { loadCampaignContent } from "../../lib/campaign-content.server";
import {
  newestArticles,
  publicArticle,
  publicUseCase,
} from "../components/campaign/public-content";
import { UseCasePage } from "../components/campaign/use-cases";
import { campaignMeta } from "../lib/campaign-seo";

export function loader({ params }: LoaderFunctionArgs) {
  const content = loadCampaignContent();
  const item = content.useCases.find((item) => item.slug === params.slug);
  if (!item) throw new Response(null, { status: 404 });
  return {
    item: publicUseCase(item),
    useCases: content.useCases.filter((candidate) => item.next_jobs?.includes(candidate.slug)).map(publicUseCase),
    articles: newestArticles(
      content.articles.filter((article) => article.use_case === item.slug),
    ).map(publicArticle),
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
        content.item.title,
        content.item.meta_description,
        `${USE_CASES_BASE}/${content.item.slug}`,
        "website",
        params?.locale,
      )
    : [];
};
export default function UseCaseRoute() {
  const data = useLoaderData<typeof loader>();
  return <UseCasePage {...data} />;
}
