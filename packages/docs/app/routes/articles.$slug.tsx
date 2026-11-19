import { useLoaderData, type LoaderFunctionArgs } from "react-router";

import {
  ARTICLES_BASE,
  type ArticleEntry,
  type SiteContent,
  type PublicArticle,
} from "../../lib/site-content";
import { loadSiteContent } from "../../lib/site-content.server";
import {
  DEFAULT_DOCS_LOCALE,
  sitePathForLocale,
  type DocsLocale,
} from "../components/docs-locale";
import { ArticlePage } from "../components/site-content/articles";
import {
  articleCards,
  newestArticles,
  publicArticle,
} from "../components/site-content/public-content";
import { siteContentMeta, localeAlternates } from "../lib/site-content-seo";

export function loader({ params }: LoaderFunctionArgs) {
  const content = loadSiteContent();
  const item = content.articles.find((article) => article.slug === params.slug);
  if (!item) throw new Response(null, { status: 404 });
  return articleDataFor(content, item, item, DEFAULT_DOCS_LOCALE);
}

/** An article in one language, and every language it exists in. */
export function articleDataFor(
  content: SiteContent,
  entry: ArticleEntry,
  article: PublicArticle,
  locale: DocsLocale,
) {
  const useCase = content.useCases.find(
    (useCase) => useCase.slug === entry.use_case,
  );
  const useCasePage = useCase
    ? (useCase.translations[locale] ?? useCase)
    : undefined;
  const more = articleCards(
    newestArticles(
      content.articles.filter((item) => item.slug !== entry.slug),
    ).slice(0, 3),
    locale,
  );
  return {
    article: publicArticle(article),
    useCase: useCasePage
      ? { slug: useCasePage.slug, title: useCasePage.title }
      : null,
    more: more.articles,
    translatedSlugs: more.translatedSlugs,
    locales: [DEFAULT_DOCS_LOCALE, ...Object.keys(entry.translations)],
  };
}

type ArticleData = ReturnType<typeof articleDataFor>;
export const meta = ({
  data,
  loaderData,
  params,
}: {
  params?: { locale?: string };
  data?: ArticleData;
  loaderData?: ArticleData;
}) => {
  const content = data ?? loaderData;
  return content
    ? [
        ...siteContentMeta(
          content.article.seo_title,
          content.article.meta_description,
          `${ARTICLES_BASE}/${content.article.slug}`,
          "article",
          params?.locale,
          content.article.og_image,
          content.article.title,
        ),
        ...localeAlternates(
          `${ARTICLES_BASE}/${content.article.slug}/`,
          content.locales,
        ),
        {
          tagName: "link" as const,
          rel: "alternate",
          type: "text/markdown",
          href: `${sitePathForLocale(ARTICLES_BASE, params?.locale)}${content.article.slug}.md`,
        },
      ]
    : [];
};
export default function ArticleRoute() {
  const { article, useCase, more, translatedSlugs } =
    useLoaderData<typeof loader>();
  return (
    <ArticlePage
      article={article}
      useCase={useCase}
      more={more}
      translatedSlugs={translatedSlugs}
    />
  );
}
