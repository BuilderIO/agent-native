import { withSsrHtmlContentType } from "@agent-native/core/shared";
import {
  redirect,
  useLoaderData,
  type LoaderFunctionArgs,
  type MetaDescriptor,
} from "react-router";

import {
  USE_CASES_BASE,
  type UseCase,
  type UseCaseEntry,
} from "../../lib/campaign-content";
import { loadCampaignContent } from "../../lib/campaign-content.server";
import { UseCasePage } from "../components/campaign/use-case-page";
import { useCaseRedirectTarget } from "../components/campaign/use-case-redirects";
import {
  DEFAULT_DOCS_LOCALE,
  sitePathForLocale,
} from "../components/docs-locale";
import { campaignMeta } from "../lib/campaign-seo";

const SITE_URL = "https://www.agent-native.com";

/** A use-case page in one language, and every language it exists in. */
export function useCasePageData(entry: UseCaseEntry, page: UseCase) {
  return {
    page,
    locales: [DEFAULT_DOCS_LOCALE, ...Object.keys(entry.translations)],
  };
}

export function loader({ params }: LoaderFunctionArgs) {
  const moved = useCaseRedirectTarget(params.slug);
  if (moved) {
    return withSsrHtmlContentType(redirect(`${USE_CASES_BASE}/${moved}/`, 301));
  }
  const content = loadCampaignContent();
  const item = content.useCases.find((item) => item.slug === params.slug);
  if (!item) throw new Response(null, { status: 404 });
  const { translations: _translations, ...page } = item;
  return useCasePageData(item, page);
}
// A redirect never reaches meta, so it only sees a page's data.
type UseCaseData = Exclude<ReturnType<typeof loader>, Response>;
export const meta = ({
  data,
  loaderData,
  params,
}: {
  params?: { locale?: string };
  data?: UseCaseData;
  loaderData?: UseCaseData;
}) => {
  const content = data ?? loaderData;
  if (!content) return [];
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
};
export default function UseCaseRoute() {
  return <UseCasePage page={useLoaderData<typeof loader>().page} />;
}
