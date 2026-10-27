import { withSsrHtmlContentType } from "@agent-native/core/shared";
import { redirect, type LoaderFunctionArgs } from "react-router";

import { USE_CASES_BASE } from "../../lib/campaign-content";
import { loadCampaignContent } from "../../lib/campaign-content.server";
import { useCaseRedirectTarget } from "../components/campaign/use-case-redirects";
import {
  docsLocaleFromSegment,
  sitePathForLocale,
} from "../components/docs-locale";
import { redirectLocalizedCampaign } from "./localized-campaign-redirect";
import { useCasePageData } from "./use-cases.$slug";

export { default, meta } from "./use-cases.$slug";

// A page translated into this language is served here; any other page
// redirects to its English version.
export function loader({ params, request }: LoaderFunctionArgs) {
  const locale = docsLocaleFromSegment(params.locale);
  const moved = useCaseRedirectTarget(params.slug);
  if (locale && moved) {
    throw withSsrHtmlContentType(
      redirect(sitePathForLocale(`${USE_CASES_BASE}/${moved}/`, locale), 301),
    );
  }
  const entry = loadCampaignContent().useCases.find(
    (item) => item.slug === params.slug,
  );
  if (!entry) throw new Response(null, { status: 404 });
  const translation = locale ? entry.translations[locale] : undefined;
  if (translation) return useCasePageData(entry, translation);
  return redirectLocalizedCampaign(
    request,
    params.locale,
    `${USE_CASES_BASE}/${params.slug}/`,
  );
}
