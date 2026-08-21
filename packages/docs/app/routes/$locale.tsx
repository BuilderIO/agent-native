import { withSsrHtmlContentType } from "@agent-native/core/shared";
import { Outlet, redirect, type LoaderFunctionArgs } from "react-router";

import {
  DEFAULT_DOCS_LOCALE,
  isDocsLocale,
  sitePathForLocale,
} from "../components/docs-locale";

export function loader({ params, url }: LoaderFunctionArgs) {
  const locale = params.locale;
  if (!isDocsLocale(locale)) {
    throw new Response("Not Found", { status: 404 });
  }
  if (locale === DEFAULT_DOCS_LOCALE) {
    throw withSsrHtmlContentType(
      redirect(sitePathForLocale(url.pathname, DEFAULT_DOCS_LOCALE), 301),
    );
  }
  return null;
}

export default function LocalizedSiteLayout() {
  return <Outlet />;
}
