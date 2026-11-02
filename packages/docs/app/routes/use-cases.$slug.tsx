import { withSsrHtmlContentType } from "@agent-native/core/shared";
import { redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";

import {
  USE_CASES_BASE,
  type UseCase,
  type UseCaseEntry,
} from "../../lib/campaign-content";
import { loadCampaignContent } from "../../lib/campaign-content.server";
import { UseCasePage } from "../components/campaign/use-case-page";
import { movedUseCaseSlug } from "../components/campaign/use-case-redirects";
import { DEFAULT_DOCS_LOCALE } from "../components/docs-locale";
import { campaignMeta, localeAlternates } from "../lib/campaign-seo";

/** A use-case page in one language, and every language it exists in. */
export function pageDataFor(entry: UseCaseEntry, page: UseCase) {
  return {
    page,
    locales: [DEFAULT_DOCS_LOCALE, ...Object.keys(entry.translations)],
  };
}

export function loader({ params }: LoaderFunctionArgs) {
  const moved = movedUseCaseSlug(params.slug);
  if (moved) {
    return withSsrHtmlContentType(redirect(`${USE_CASES_BASE}/${moved}/`, 301));
  }
  const content = loadCampaignContent();
  const item = content.useCases.find((item) => item.slug === params.slug);
  if (!item) throw new Response(null, { status: 404 });
  const { translations: _translations, ...page } = item;
  return pageDataFor(item, page);
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
  return [
    ...campaignMeta(
      content.page.seo_title,
      content.page.meta_description,
      `${USE_CASES_BASE}/${content.page.slug}`,
      "website",
      params?.locale,
    ),
    ...localeAlternates(
      `${USE_CASES_BASE}/${content.page.slug}/`,
      content.locales,
    ),
  ];
};
export default function UseCaseRoute() {
  return <UseCasePage page={useLoaderData<typeof loader>().page} />;
}
