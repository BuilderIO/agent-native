import { useLoaderData } from "react-router";

import {
  ARTICLES_BASE,
  ARTICLES_PAGE_SIZE,
  translatedArticleLocales,
  type ArticleEntry,
} from "../../lib/campaign-content";
import { loadCampaignContent } from "../../lib/campaign-content.server";
import { ArticlesList } from "../components/campaign/articles";
import {
  articleCards,
  newestArticles,
} from "../components/campaign/public-content";
import {
  DEFAULT_DOCS_LOCALE,
  type DocsLocale,
} from "../components/docs-locale";
import { articlesListCopy } from "../lib/articles-copy.server";
import { campaignMeta, localeAlternates } from "../lib/campaign-seo";

/**
 * One page of the articles grid in one language. Every language with a
 * translated article gets the whole grid, its untranslated cards in English.
 */
export function articlesPageData(
  articles: ArticleEntry[],
  page: number,
  locale: DocsLocale,
) {
  const sorted = newestArticles(articles);
  const start = (page - 1) * ARTICLES_PAGE_SIZE;
  const cards = articleCards(
    sorted.slice(start, start + ARTICLES_PAGE_SIZE),
    locale,
  );
  return {
    articles: cards.articles,
    translatedSlugs: cards.translatedSlugs,
    page,
    hasMore: start + ARTICLES_PAGE_SIZE < sorted.length,
    locales: [DEFAULT_DOCS_LOCALE, ...translatedArticleLocales(articles)],
  };
}
/** The grid's <title> and description in its language, from the server-only catalog lookup. */
export type ArticlesPageData = ReturnType<typeof articlesPageData> & {
  copy: { title: string; description: string };
};

export const meta = ({
  data,
  loaderData,
  params,
}: {
  params?: { locale?: string };
  data?: ArticlesPageData;
  loaderData?: ArticlesPageData;
} = {}) => {
  const content = data ?? loaderData;
  return content
    ? [
        ...campaignMeta(
          content.copy.title,
          content.copy.description,
          ARTICLES_BASE,
          "website",
          params?.locale,
        ),
        ...localeAlternates(`${ARTICLES_BASE}/`, content.locales),
      ]
    : [];
};
export function loader(): ArticlesPageData {
  return {
    ...articlesPageData(loadCampaignContent().articles, 1, DEFAULT_DOCS_LOCALE),
    copy: articlesListCopy(DEFAULT_DOCS_LOCALE),
  };
}
export default function ArticlesRoute() {
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
