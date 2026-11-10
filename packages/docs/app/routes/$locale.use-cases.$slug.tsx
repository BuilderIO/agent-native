import { withSsrHtmlContentType } from "@agent-native/core/shared";
import { redirect, type LoaderFunctionArgs } from "react-router";

import { USE_CASES_BASE } from "../../lib/site-content";
import { loadSiteContent } from "../../lib/site-content.server";
import {
  docsLocaleFromSegment,
  sitePathForLocale,
} from "../components/docs-locale";
import { movedUseCaseSlug } from "../components/site-content/use-case-redirects";
import { redirectLocalizedSiteContent } from "./localized-site-content-redirect";
import { loader as englishLoader, pageDataFor } from "./use-cases.$slug";

export { default, meta } from "./use-cases.$slug";

// A page translated into this language is served here; any other page
// redirects to its English version, and an unknown one is the English
// route's 404.
export function loader(args: LoaderFunctionArgs) {
  const { params, request } = args;
  const locale = docsLocaleFromSegment(params.locale);
  const moved = movedUseCaseSlug(params.slug);
  if (locale && moved) {
    return withSsrHtmlContentType(
      redirect(sitePathForLocale(`${USE_CASES_BASE}/${moved}/`, locale), 301),
    );
  }
  const entry = loadSiteContent().useCases.find(
    (item) => item.slug === params.slug,
  );
  if (!entry) return englishLoader(args);
  const translation = locale ? entry.translations[locale] : undefined;
  if (translation) return pageDataFor(entry, translation);
  return redirectLocalizedSiteContent(
    request,
    params.locale,
    `${USE_CASES_BASE}/${params.slug}/`,
  );
}
