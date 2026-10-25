import {
  useLoaderData,
  type LoaderFunctionArgs,
  type MetaDescriptor,
} from "react-router";

import {
  USE_CASES_BASE,
  type UseCasePageEntry,
  type UseCasePageV2,
} from "../../lib/campaign-content";
import { loadCampaignContent } from "../../lib/campaign-content.server";
import {
  newestArticles,
  publicArticle,
  publicUseCase,
} from "../components/campaign/public-content";
import { UseCasePageV2 as UseCasePageV2View } from "../components/campaign/use-case-page-v2";
import { UseCasePage } from "../components/campaign/use-cases";
import {
  DEFAULT_DOCS_LOCALE,
  sitePathForLocale,
} from "../components/docs-locale";
import { campaignMeta } from "../lib/campaign-seo";

const SITE_URL = "https://www.agent-native.com";

/** A new-style page in one language, and every language it exists in. */
export function useCasePageData(entry: UseCasePageEntry, page: UseCasePageV2) {
  return {
    version: "v2" as const,
    page,
    locales: [DEFAULT_DOCS_LOCALE, ...Object.keys(entry.translations)],
  };
}

export function loader({ params }: LoaderFunctionArgs) {
  const content = loadCampaignContent();
  const entry = content.useCasePages.find((item) => item.slug === params.slug);
  if (entry) {
    const { translations: _translations, ...page } = entry;
    return useCasePageData(entry, page);
  }
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
  if (content.version === "v2") {
    const path = `${USE_CASES_BASE}/${content.page.slug}/`;
    // Every language version names all the others, and English is the default.
    const alternates: MetaDescriptor[] = [
      ...content.locales.map((locale) => ({
        tagName: "link",
        rel: "alternate",
        hrefLang: locale,
        href: `${SITE_URL}${sitePathForLocale(path, locale)}`,
      })),
      {
        tagName: "link",
        rel: "alternate",
        hrefLang: "x-default",
        href: `${SITE_URL}${path}`,
      },
    ];
    return [
      ...campaignMeta(
        content.page.seo_title,
        content.page.meta_description,
        `${USE_CASES_BASE}/${content.page.slug}`,
        "website",
        params?.locale,
      ),
      ...alternates,
    ];
  }
  return campaignMeta(
    content.item.title,
    content.item.meta_description,
    `${USE_CASES_BASE}/${content.item.slug}`,
    "website",
    params?.locale,
  );
};
export default function UseCaseRoute() {
  const data = useLoaderData<typeof loader>();
  if (data.version === "v2") return <UseCasePageV2View page={data.page} />;
  return <UseCasePage {...data} />;
}
