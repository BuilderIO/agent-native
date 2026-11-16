import { redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";

import { ARTICLES_BASE, ARTICLES_PAGE_SIZE } from "../../lib/site-content";
import { loadSiteContent } from "../../lib/site-content.server";
import {
  DEFAULT_DOCS_LOCALE,
  docsLocaleFromSegment,
  sitePathForLocale,
} from "../components/docs-locale";
import { ArticlesList } from "../components/site-content/articles";
import { articlesListCopy } from "../lib/articles-copy.server";
import { siteContentMeta, localeAlternates } from "../lib/site-content-seo";
import { articlesPageData } from "./articles._index";

// Serves page 2 onward of the grid in the route's language; the localized
// route calls it only for a language that has translated articles.
export function loader({ params }: LoaderFunctionArgs) {
  if (!params.page || !/^[1-9]\d*$/.test(params.page))
    throw new Response(null, { status: 404 });
  const page = Number(params.page);
  if (page === 1)
    throw redirect(sitePathForLocale(ARTICLES_BASE, params.locale), 301);
  const { articles } = loadSiteContent();
  const start = (page - 1) * ARTICLES_PAGE_SIZE;
  if (!Number.isSafeInteger(page) || start >= articles.length)
    throw new Response(null, { status: 404 });
  const locale = docsLocaleFromSegment(params.locale) ?? DEFAULT_DOCS_LOCALE;
  return {
    ...articlesPageData(articles, page, locale),
    copy: articlesListCopy(locale),
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
    ? [
        ...siteContentMeta(
          content.copy.title,
          content.copy.description,
          `${ARTICLES_BASE}/page/${content.page}`,
          "website",
          params?.locale,
        ),
        ...localeAlternates(
          `${ARTICLES_BASE}/page/${content.page}/`,
          content.locales,
        ),
      ]
    : [];
};
export default function ArticlesPageRoute() {
  const { articles, translatedSlugs, page, hasMore } =
    useLoaderData<typeof loader>();
  return (
    <ArticlesList
      articles={articles}
      translatedSlugs={translatedSlugs}
      page={page}
      hasMore={hasMore}
    />
  );
}
