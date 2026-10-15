import { useT, useLocale } from "@agent-native/core/client/i18n";
import { Link } from "react-router";

import {
  ARTICLE_TOPICS,
  getArticleTopics,
  type ArticleTopic,
  type ArticleTopicSummary,
} from "../../../lib/article-topics";
import { ARTICLES_BASE, USE_CASES_BASE } from "../../../lib/campaign-content";
import { sitePathForLocale } from "../docs-locale";
import { TemplateLandingShell } from "../template-landing";
import { Button } from "../website-redesign/ds/button";
import { ContentCard } from "../website-redesign/ds/content-card";
import { SectionHeader } from "../website-redesign/ds/section-header";
import { ArticleBody, parseArticle, sanitizedMarkdown } from "./markdown";
import {
  campaignHref,
  safeHref,
  type Article,
  type UseCase,
} from "./public-content";
import {
  CampaignBand,
  CampaignDate,
  CampaignView,
  CopyControl,
  JsonLd,
  faqSchema,
} from "./shared";

export function ArticlesList({
  articles,
  topic,
  topics = getArticleTopics(articles),
  page,
  hasMore,
}: {
  articles: Article[];
  topic?: ArticleTopic;
  topics?: ArticleTopicSummary[];
  page: number;
  hasMore: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  const intro = t("campaign.articlesIntro", { useCases: "{{useCases}}" }).split(
    "{{useCases}}",
  );
  return (
    <TemplateLandingShell className="builder-brand-tokens campaign-page pb-16">
      <div className="campaign-section border-x border-[var(--docs-border)]">
        <SectionHeader
          eyebrow={topic ? t("campaign.articles") : undefined}
          as="h1"
          heading={topic ? ARTICLE_TOPICS[topic].name : t("campaign.articles")}
          subheading={
            topic ? (
              ARTICLE_TOPICS[topic].description
            ) : (
              <>
                {intro[0]}
                <Link
                  to={sitePathForLocale(USE_CASES_BASE, locale)}
                  className="campaign-inline-link text-[var(--docs-accent)]"
                >
                  {t("campaign.useCasesLink")}
                </Link>
                {intro[1]}
              </>
            )
          }
        />
      </div>
      <section className="border border-[var(--docs-border)]">
        {!topic ? (
          <div className="campaign-section">
            <SectionHeader heading={t("campaign.allArticles")} />
          </div>
        ) : null}
        {articles.map((article) => (
          <article
            key={article.slug}
            className="border-t border-[var(--docs-border)] first:border-t-0"
          >
            <Link
              to={sitePathForLocale(`${ARTICLES_BASE}/${article.slug}`, locale)}
              className="grid gap-3 p-6 no-underline hover:bg-[var(--b-bg-raised)] sm:grid-cols-[1fr_2fr] sm:p-8"
            >
              <span className="campaign-label">
                {ARTICLE_TOPICS[article.topic].name}
              </span>
              <h2 className="campaign-card-title">{article.title}</h2>
            </Link>
          </article>
        ))}
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
            {t("campaign.showMore")}
          </Button>
        </div>
      ) : null}
      {!topic ? (
        <section className="mt-16 border border-[var(--docs-border)]">
          <div className="campaign-section">
            <SectionHeader heading={t("campaign.allTopics")} />
          </div>
          <ul className="m-0 list-none border-t border-[var(--docs-border)] p-0 lg:columns-2 lg:gap-0">
            {topics
              .filter((item) => item.count > 0)
              .map((item) => (
                <li
                  key={item.slug}
                  className="break-inside-avoid border-b border-[var(--docs-border)] last:border-b-0"
                >
                  <Link
                    to={sitePathForLocale(
                      `${ARTICLES_BASE}/topic/${item.slug}`,
                      locale,
                    )}
                    className="flex h-full flex-col gap-3 p-6 no-underline hover:bg-[var(--b-bg-raised)] sm:p-8"
                  >
                    <h3 className="campaign-card-title">{item.name}</h3>
                    <p className="m-0 text-[var(--fg-secondary)]">
                      {item.description}
                    </p>
                    <span className="campaign-label">
                      {t(
                        item.count === 1
                          ? "campaign.articleCountOne"
                          : "campaign.articleCountOther",
                        { count: item.count },
                      )}
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </TemplateLandingShell>
  );
}

export function ArticlePage({
  article,
  useCase,
  more,
}: {
  article: Article;
  useCase: Pick<UseCase, "slug" | "title"> | null;
  more: Article[];
}) {
  const t = useT();
  const { locale } = useLocale();
  const parsed = parseArticle(article.body);
  const words = sanitizedMarkdown(article.body)
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const minutes = Math.max(1, Math.ceil(words / 200));
  const avatar = article.author_avatar
    ? safeHref(article.author_avatar)
    : undefined;
  return (
    <TemplateLandingShell className="builder-brand-tokens campaign-page">
      <CampaignView item={article} />
      <JsonLd
        value={{
          "@context": "https://schema.org",
          "@type": "Article",
          headline: article.title,
          description: article.meta_description,
          articleSection: ARTICLE_TOPICS[article.topic].name,
          datePublished: article.published,
          dateModified: article.updated ?? article.published,
          author: { "@type": "Person", name: article.author },
          publisher: {
            "@type": "Organization",
            name: "Agent-Native",
            url: "https://www.agent-native.com",
          },
        }}
      />
      {parsed.faqs.length ? <JsonLd value={faqSchema(parsed.faqs)} /> : null}
      <div className="campaign-section border-x border-[var(--docs-border)]">
        <div className="mx-auto max-w-[720px]">
          <nav
            aria-label={t("campaign.breadcrumb")}
            className="mb-8 flex flex-wrap items-center gap-2 text-sm text-[var(--fg-secondary)]"
          >
            <Link to={sitePathForLocale(ARTICLES_BASE, locale)}>
              {t("campaign.articles")}
            </Link>
            <span aria-hidden="true">/</span>
            <Link
              to={sitePathForLocale(
                `${ARTICLES_BASE}/topic/${article.topic}`,
                locale,
              )}
            >
              {ARTICLE_TOPICS[article.topic].name}
            </Link>
          </nav>
          <h1 className="m-0 text-3xl font-medium leading-tight tracking-tight sm:text-5xl">
            {article.title}
          </h1>
          <div className="my-8 flex flex-wrap items-center gap-4">
            {avatar ? (
              <img
                src={avatar}
                alt={article.author}
                className="size-10 rounded-full object-cover"
              />
            ) : null}
            <div>
              <p className="m-0 font-medium">{article.author}</p>
              {article.author_role ? (
                <p className="m-0 text-sm text-[var(--fg-secondary)]">
                  {article.author_role}
                </p>
              ) : null}
            </div>
            <span className="text-sm text-[var(--fg-secondary)]">
              <CampaignDate date={article.updated ?? article.published} />
            </span>
            <span className="text-sm text-[var(--fg-secondary)]">
              {t("campaign.readTime", { count: minutes })}
            </span>
            <CopyControl
              text={`# ${article.title}\n\n${sanitizedMarkdown(article.body)}`}
            />
          </div>
          {useCase ? (
            <p className="mb-8 text-[var(--fg-secondary)]">
              {t("campaign.partOf")}{" "}
              <Link
                to={sitePathForLocale(
                  `${USE_CASES_BASE}/${useCase.slug}`,
                  locale,
                )}
                className="campaign-inline-link text-[var(--docs-accent)]"
              >
                {useCase.title}
              </Link>
            </p>
          ) : null}
          <ArticleBody article={article} />
          {useCase || article.related_resources.length ? (
            <section className="docs-content my-12">
              <h2>{t("campaign.relatedResources")}</h2>
              <ul className="mt-6 list-disc space-y-3 ps-6">
                {useCase ? (
                  <li>
                    <Link
                      to={sitePathForLocale(
                        `${USE_CASES_BASE}/${useCase.slug}`,
                        locale,
                      )}
                      className="campaign-inline-link text-[var(--docs-accent)]"
                    >
                      {useCase.title}
                    </Link>
                  </li>
                ) : null}
                {article.related_resources.map((resource, i) => {
                  const href = safeHref(resource.url);
                  return (
                    <li key={i}>
                      {href ? (
                        href.startsWith("/") ? (
                          <Link
                            to={campaignHref(href, locale)}
                            className="campaign-inline-link text-[var(--docs-accent)]"
                          >
                            {resource.label}
                          </Link>
                        ) : (
                          <a
                            href={href}
                            className="campaign-inline-link text-[var(--docs-accent)]"
                          >
                            {resource.label}
                          </a>
                        )
                      ) : (
                        resource.label
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
      {more.length ? (
        <section className="border border-[var(--docs-border)]">
          <div className="campaign-section">
            <SectionHeader
              heading={
                more.some((item) => item.topic !== article.topic)
                  ? t("campaign.genericMore")
                  : t("campaign.moreOnTopic", {
                      topic: ARTICLE_TOPICS[article.topic].name,
                    })
              }
            />
          </div>
          <div className="grid gap-px bg-[var(--docs-border)] sm:grid-cols-2 lg:grid-cols-3">
            {more.map((item) => (
              <ContentCard
                key={item.slug}
                href={sitePathForLocale(
                  `${ARTICLES_BASE}/${item.slug}`,
                  locale,
                )}
                eyebrow={
                  <span className="campaign-label">
                    {ARTICLE_TOPICS[item.topic].name}
                  </span>
                }
                title={item.title}
                body={item.meta_description}
              />
            ))}
          </div>
        </section>
      ) : null}
      <CampaignBand item={article} />
    </TemplateLandingShell>
  );
}
