import { useLoaderData, type LoaderFunctionArgs } from "react-router";

import { USE_CASES_BASE } from "../../lib/campaign-content";
import { loadCampaignContent } from "../../lib/campaign-content.server";
import {
  newestArticles,
  publicArticle,
  publicUseCase,
} from "../components/campaign/public-content";
import { UseCasePageV2 } from "../components/campaign/use-case-page-v2";
import { UseCasePage } from "../components/campaign/use-cases";
import { campaignMeta } from "../lib/campaign-seo";

export function loader({ params }: LoaderFunctionArgs) {
  const content = loadCampaignContent();
  const page = content.useCasePages.find((item) => item.slug === params.slug);
  if (page) return { version: "v2" as const, page };
  const item = content.useCases.find((item) => item.slug === params.slug);
  if (!item) throw new Response(null, { status: 404 });
  return {
    version: "v1" as const,
    item: publicUseCase(item),
    useCases: content.useCases
      .filter((candidate) => item.next_jobs?.includes(candidate.slug))
      .map(publicUseCase),
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
  if (!content) return [];
  const { title, description, slug } =
    content.version === "v2"
      ? {
          title: content.page.seo_title,
          description: content.page.meta_description,
          slug: content.page.slug,
        }
      : {
          title: content.item.title,
          description: content.item.meta_description,
          slug: content.item.slug,
        };
  return campaignMeta(
    title,
    description,
    `${USE_CASES_BASE}/${slug}`,
    "website",
    params?.locale,
  );
};
export default function UseCaseRoute() {
  const data = useLoaderData<typeof loader>();
  if (data.version === "v2") return <UseCasePageV2 page={data.page} />;
  return <UseCasePage {...data} />;
}
