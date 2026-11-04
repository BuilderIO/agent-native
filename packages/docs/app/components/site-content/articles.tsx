import { useT, useLocale } from "@agent-native/core/client/i18n";
import { Link } from "react-router";

import { ARTICLES_BASE, USE_CASES_BASE } from "../../../lib/site-content";
import { DEFAULT_DOCS_LOCALE, sitePathForLocale } from "../docs-locale";
import { TemplateLandingShell } from "../template-landing";
import { Button } from "../website-redesign/ds/button";
import { SectionHeader } from "../website-redesign/ds/section-header";
import { ArticleBody, sanitizedMarkdown } from "./markdown";
import { safeHref, type Article } from "./public-content";
import {
  SiteContentBand,
  SiteContentDate,
  SiteContentView,
  JsonLd,
  faqSchema,
} from "./shared";

const SITE = "https://www.agent-native.com";
const PUBLISHER = {
  "@type": "Organization",
  name: "Agent-Native",
  url: SITE,
  logo: { "@type": "ImageObject", url: `${SITE}/favicon.svg` },
};
// English unless the article has a page in this language.
const articlePath = (slug: string, locale: string, translated: boolean) =>
  sitePathForLocale(
    `${ARTICLES_BASE}/${slug}/`,
    translated ? locale : DEFAULT_DOCS_LOCALE,
  );

// A card in the 3×3 grid: the article's share image as its thumbnail, at the share image's own ratio.
function ArticleCard({
  article,
  translated,
  heading: Heading = "h2",
}: {
  article: Article;
  /** Whether the article has a page in the current language. */
  translated: boolean;
  /** h3 under another section's heading, such as "More articles". */
  heading?: "h2" | "h3";
}) {
  const { locale } = useLocale();
  const image = safeHref(article.og_image);
  return (
    <Link
      to={articlePath(article.slug, locale, translated)}
      className="group flex h-full flex-col bg-[var(--docs-bg,var(--b-bg-default))] no-underline"
    >
      <div className="aspect-[1200/630] w-full overflow-hidden border-b border-[var(--docs-border)] bg-[var(--b-bg-raised)]">
        {image ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            decoding="async"
            className="block h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-6 transition-colors group-hover:bg-[var(--b-bg-raised)]">
        <Heading className="site-content-card-title m-0">
          {article.title}
        </Heading>
        <p className="m-0 line-clamp-2 text-sm text-[var(--fg-secondary)]">
          {article.meta_description}
        </p>
        <p className="m-0 mt-auto pt-2 text-sm text-[var(--fg-secondary)]">
          {article.author.name} ·{" "}
          <SiteContentDate date={article.updated} month="short" />
        </p>
      </div>
    </Link>
  );
}

export function ArticlesList({
  articles,
  translatedSlugs = [],
  page,
  hasMore,
}: {
  articles: Article[];
  /** The listed articles that have a page in the current language. */
  translatedSlugs?: readonly string[];
  page: number;
  hasMore: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <TemplateLandingShell className="builder-brand-tokens site-content-page site-content-articles-page pb-16">
      <JsonLd
        value={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            {
              "@type": "ListItem",
              position: 1,
              name: t("siteContent.articles"),
              item: `${SITE}${sitePathForLocale(ARTICLES_BASE, locale)}`,
            },
          ],
        }}
      />
      <JsonLd
        value={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          itemListElement: articles.map((article, i) => ({
            "@type": "ListItem",
            position: i + 1,
            url: `${SITE}${articlePath(article.slug, locale, translatedSlugs.includes(article.slug))}`,
            name: article.title,
          })),
        }}
      />
      <div className="site-content-section border-x border-[var(--docs-border)]">
        <SectionHeader
          as="h1"
          heading={t("siteContent.articles")}
          subheading={t("siteContent.articlesIntro")}
        />
      </div>
      <section className="template-section-flush border border-[var(--docs-border)]">
        <div className="grid gap-px bg-[var(--docs-border)] sm:grid-cols-2 lg:grid-cols-3">
          {articles.map((article) => (
            <ArticleCard
              key={article.slug}
              article={article}
              translated={translatedSlugs.includes(article.slug)}
            />
          ))}
        </div>
      </section>
      {hasMore ? (
        <div className="border-x border-b border-[var(--docs-border)] p-6 text-center">
          <Button
            variant="secondary"
            href={sitePathForLocale(
              `${ARTICLES_BASE}/page/${page + 1}`,
              locale,
            )}
          >
            {t("siteContent.showMore")}
          </Button>
        </div>
      ) : null}
    </TemplateLandingShell>
  );
}

export function ArticlePage({
  article,
  useCase,
  more,
  translatedSlugs = [],
}: {
  article: Article;
  useCase: { slug: string; title: string } | null;
  more: Article[];
  /** The "More articles" that have a page in the current language. */
  translatedSlugs?: readonly string[];
}) {
  const t = useT();
  const { locale } = useLocale();
  const words = sanitizedMarkdown(article.body)
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const minutes = Math.max(1, Math.ceil(words / 200));
  const { author } = article;
  const photo = author.photo ? safeHref(author.photo) : undefined;
  const authorHref = safeHref(author.url);
  // The page itself only renders in a language it is translated into.
  const url = `${SITE}${articlePath(article.slug, locale, true)}`;
  return (
    <TemplateLandingShell className="builder-brand-tokens site-content-page site-content-articles-page">
      <SiteContentView item={article} />
      <JsonLd
        value={{
          "@context": "https://schema.org",
          "@type": "Article",
          headline: article.title,
          inLanguage: locale,
          description: article.meta_description,
          image: article.og_image,
          datePublished: article.published,
          dateModified: article.updated,
          mainEntityOfPage: url,
          author: {
            "@type": "Person",
            name: author.name,
            url: author.url,
            ...(author.same_as?.length ? { sameAs: author.same_as } : {}),
            ...(author.role ? { jobTitle: author.role } : {}),
            ...(author.photo ? { image: author.photo } : {}),
          },
          publisher: PUBLISHER,
        }}
      />
      {article.faqs.length ? <JsonLd value={faqSchema(article.faqs)} /> : null}
      <JsonLd
        value={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            {
              "@type": "ListItem",
              position: 1,
              name: t("siteContent.articles"),
              item: `${SITE}${sitePathForLocale(ARTICLES_BASE, locale)}`,
            },
            {
              "@type": "ListItem",
              position: 2,
              name: article.title,
              item: url,
            },
          ],
        }}
      />
      <div className="site-content-section border-x border-[var(--docs-border)]">
        <div className="mx-auto max-w-[760px]">
          <nav
            aria-label={t("siteContent.breadcrumb")}
            className="mb-8 flex flex-wrap items-center gap-2 text-sm text-[var(--fg-secondary)]"
          >
            <Link to={sitePathForLocale(ARTICLES_BASE, locale)}>
              {t("siteContent.articles")}
            </Link>
          </nav>
          <h1 className="m-0 text-3xl font-medium leading-tight tracking-tight sm:text-5xl">
            {article.title}
          </h1>
          <div className="my-8 flex flex-wrap items-center gap-x-4 gap-y-2">
            {photo ? (
              <img
                src={photo}
                alt=""
                loading="lazy"
                decoding="async"
                className="size-10 rounded-full object-cover"
              />
            ) : null}
            <div>
              <p className="m-0 font-medium">
                {authorHref ? (
                  <a
                    href={authorHref}
                    rel="author"
                    className="site-content-inline-link"
                  >
                    {author.name}
                  </a>
                ) : (
                  author.name
                )}
              </p>
              {author.role ? (
                <p className="m-0 text-sm text-[var(--fg-secondary)]">
                  {author.role}
                </p>
              ) : null}
            </div>
            <span className="text-sm text-[var(--fg-secondary)]">
              <SiteContentDate date={article.published} kind="published" />
              {article.updated !== article.published ? (
                <>
                  {" · "}
                  <SiteContentDate date={article.updated} />
                </>
              ) : null}
            </span>
            <span className="text-sm text-[var(--fg-secondary)]">
              {t("siteContent.readTime", { count: minutes })}
            </span>
          </div>
          <ArticleBody article={article} />
          {useCase ? (
            <p className="my-12 text-[var(--fg-secondary)]">
              {t("siteContent.partOf")}{" "}
              <Link
                to={sitePathForLocale(
                  `${USE_CASES_BASE}/${useCase.slug}`,
                  locale,
                )}
                className="site-content-inline-link text-[var(--docs-accent)]"
              >
                {useCase.title}
              </Link>
            </p>
          ) : null}
        </div>
      </div>
      {more.length ? (
        <section className="template-section-flush border border-[var(--docs-border)]">
          <div className="site-content-section">
            <SectionHeader heading={t("siteContent.genericMore")} />
          </div>
          <div className="grid gap-px bg-[var(--docs-border)] sm:grid-cols-2 lg:grid-cols-3">
            {more.map((item) => (
              <ArticleCard
                key={item.slug}
                article={item}
                translated={translatedSlugs.includes(item.slug)}
                heading="h3"
              />
            ))}
          </div>
        </section>
      ) : null}
      <SiteContentBand item={article} />
    </TemplateLandingShell>
  );
}
