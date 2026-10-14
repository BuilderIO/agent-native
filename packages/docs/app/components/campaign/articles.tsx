import { useT } from "@agent-native/core/client/i18n";
import { Link } from "react-router";

import { TemplateLandingShell } from "../template-landing";
import { Button } from "../website-redesign/ds/button";
import { ContentCard } from "../website-redesign/ds/content-card";
import { SectionHeader } from "../website-redesign/ds/section-header";
import { ArticleBody, parseArticle, sanitizedMarkdown } from "./markdown";
import {
  appNames,
  categories,
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
  category,
  page,
  hasMore,
}: {
  articles: Article[];
  category?: string;
  page: number;
  hasMore: boolean;
}) {
  const t = useT();
  return (
    <TemplateLandingShell className="builder-brand-tokens pb-16">
      <div className="border-x border-[var(--docs-border)] px-6 py-16 sm:px-10">
        <SectionHeader
          eyebrow={t("campaign.articles")}
          as="h1"
          heading={category ? appNames[category] : t("campaign.articles")}
          subheading={category ? undefined : t("campaign.articlesIntro")}
        />
      </div>
      <div className="border border-[var(--docs-border)]">
        {articles.map((article) => (
          <article
            key={article.slug}
            className="border-t border-[var(--docs-border)] first:border-t-0"
          >
            <Link
              to={`/articles/${article.slug}`}
              className="grid gap-3 p-6 no-underline hover:bg-[var(--b-bg-raised)] sm:grid-cols-[12rem_7rem_1fr] sm:p-8"
            >
              <span className="text-sm text-[var(--fg-secondary)]">
                <CampaignDate date={article.published} />
              </span>
              <span className="font-mono text-sm text-[var(--fg-secondary)]">
                {appNames[article.category]}
              </span>
              <h2 className="m-0 text-xl font-medium">{article.title}</h2>
            </Link>
          </article>
        ))}
      </div>
      {hasMore ? (
        <div className="border-x border-b border-[var(--docs-border)] p-6 text-center">
          <Button variant="secondary" href={`/articles/page/${page + 1}`}>
            {t("campaign.showMore")}
          </Button>
        </div>
      ) : null}
      {!category ? (
        <section className="mt-16 border border-[var(--docs-border)]">
          <div className="p-6 sm:p-8">
            <SectionHeader heading={t("campaign.allTopics")} />
          </div>
          <div className="grid gap-px bg-[var(--docs-border)] sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((key) => (
              <ContentCard
                key={key}
                href={`/articles/category/${key}`}
                title={appNames[key]}
                body={t(`campaign.topics.${key}`)}
              />
            ))}
          </div>
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
    <TemplateLandingShell className="builder-brand-tokens">
      <CampaignView item={article} />
      <JsonLd
        value={{
          "@context": "https://schema.org",
          "@type": "Article",
          headline: article.title,
          description: article.meta_description,
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
      <div className="border-x border-[var(--docs-border)] px-6 py-12 sm:px-10">
        <div className="mx-auto max-w-[720px]">
          <nav
            aria-label={t("campaign.breadcrumb")}
            className="mb-8 flex flex-wrap items-center gap-2 text-sm text-[var(--fg-secondary)]"
          >
            <Link to="/articles">{t("campaign.articles")}</Link>
            <span aria-hidden="true">/</span>
            <Link to={`/articles/category/${article.category}`}>
              {appNames[article.category]}
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
              <CampaignDate date={article.published} />
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
              <Link to={`/use-cases/${useCase.slug}`}>{useCase.title}</Link>
            </p>
          ) : null}
          <ArticleBody article={article} />
          {article.related_resources.length ? (
            <section className="my-12">
              <SectionHeader heading={t("campaign.relatedResources")} />
              <ul className="mt-6 list-disc space-y-3 ps-6">
                {article.related_resources.map((resource, i) => {
                  const href = safeHref(resource.url);
                  return (
                    <li key={i}>
                      {href ? (
                        href.startsWith("/") ? (
                          <Link to={href}>{resource.label}</Link>
                        ) : (
                          <a href={href}>{resource.label}</a>
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
          <div className="p-6 sm:p-8">
            <SectionHeader
              heading={t("campaign.moreArticles", {
                category: appNames[article.category],
              })}
            />
          </div>
          <div className="grid gap-px bg-[var(--docs-border)] sm:grid-cols-2 lg:grid-cols-3">
            {more.map((item) => (
              <ContentCard
                key={item.slug}
                href={`/articles/${item.slug}`}
                title={item.title}
              />
            ))}
          </div>
        </section>
      ) : null}
      <CampaignBand item={article} />
    </TemplateLandingShell>
  );
}
