import { trackEvent } from "@agent-native/core/client/analytics";
import { useT, useFormatters, useLocale } from "@agent-native/core/client/i18n";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";

import {
  ARTICLES_BASE,
  USE_CASES_BASE,
  CATEGORY_NAMES,
} from "../../../lib/campaign-content";
import CodeBlock from "../CodeBlock";
import { sitePathForLocale } from "../docs-locale";
import {
  TemplateHero,
  TemplateLandingFaq,
  TemplateLandingShell,
  TemplateSplitFeature,
} from "../template-landing";
import { AppStatusBadge } from "../website-redesign/ds/app-status-badge";
import { Button } from "../website-redesign/ds/button";
import { ContentCard } from "../website-redesign/ds/content-card";
import { FormSelect } from "../website-redesign/ds/form-select";
import { SectionHeader } from "../website-redesign/ds/section-header";
import { type UseCase, type Article } from "./public-content";
import {
  CampaignBand,
  CampaignCta,
  CampaignFrequencyTag,
  CampaignScreenshot,
  CampaignView,
  JsonLd,
  faqSchema,
} from "./shared";

const roleFilters = [
  ["", "campaign.filterAll"],
  ["engineering", "campaign.filterEngineering"],
  ["product", "campaign.filterProduct"],
  ["design", "campaign.filterDesign"],
  ["marketing", "campaign.filterMarketing"],
  ["revops", "campaign.filterRevops"],
  ["sales", "campaign.filterSales"],
  ["founders", "campaign.filterFounders"],
  ["finance", "campaign.filterFinance"],
] as const;

const oftenFilters = [
  ["", "campaign.filterAny"],
  ["daily", "campaign.filterDaily"],
  ["weekly", "campaign.filterWeekly"],
  ["per-project", "campaign.filterPerProject"],
  ["occasional", "campaign.filterOccasional"],
] as const;

export function UseCasesIndex({ items }: { items: UseCase[] }) {
  const t = useT();
  const { locale } = useLocale();
  const [searchParams, setSearchParams] = useSearchParams();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const role =
    roleFilters.find(([value]) => value === searchParams.get("role"))?.[0] ??
    "";
  const often =
    oftenFilters.find(([value]) => value === searchParams.get("often"))?.[0] ??
    "";
  const matches = (item: UseCase) =>
    !hydrated ||
    ((!role ||
      item.roles?.includes("everyone") ||
      item.roles?.some((candidate) => candidate === role)) &&
      (!often || item.frequency === often));
  const clearParams = new URLSearchParams(searchParams);
  clearParams.delete("role");
  clearParams.delete("often");
  function changeFilters(nextRole: string, nextOften: string) {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (nextRole) next.set("role", nextRole);
      else next.delete("role");
      if (nextOften) next.set("often", nextOften);
      else next.delete("often");
      return next;
    });
    trackEvent("index_filter", { role: nextRole, often: nextOften });
  }
  const apps = [...new Set(items.map((item) => item.app))];
  const [beforeArticles, afterArticles] = t("campaign.useCasesIntro", {
    articles: "<articles>",
  }).split("<articles>");
  return (
    <TemplateLandingShell className="builder-brand-tokens campaign-page pb-16">
      <div className="campaign-section border-x border-[var(--docs-border)]">
        <SectionHeader
          eyebrow={t("campaign.useCases")}
          as="h1"
          heading={t("campaign.useCasesTitle")}
          subheading={
            <>
              {beforeArticles}
              <Link
                to={sitePathForLocale(ARTICLES_BASE, locale)}
                className="campaign-inline-link text-[var(--docs-accent)]"
              >
                {t("campaign.articlesLink")}
              </Link>
              {afterArticles}
            </>
          }
        />
        <div className="mt-6 flex min-w-0 flex-wrap gap-6">
          <FormSelect
            label={t("campaign.filterRole")}
            options={roleFilters.map(([value, key]) => ({
              value,
              label: t(key),
            }))}
            value={role}
            onChange={(value) => changeFilters(value, often)}
          />
          <FormSelect
            label={t("campaign.filterOften")}
            options={oftenFilters.map(([value, key]) => ({
              value,
              label: t(key),
            }))}
            value={often}
            onChange={(value) => changeFilters(role, value)}
          />
        </div>
      </div>
      {hydrated && !items.some(matches) ? (
        <div className="space-y-3 border-x border-b border-[var(--docs-border)] p-6 sm:p-8">
          <p className="m-0" role="status">
            {t("campaign.filterEmpty")}
          </p>
          <Link
            to={`?${clearParams.toString()}`}
            className="campaign-inline-link text-[var(--docs-accent)]"
            onClick={() => trackEvent("index_filter", { role: "", often: "" })}
          >
            {t("campaign.filterClear")}
          </Link>
        </div>
      ) : null}
      {apps.map((app) => (
        <section
          key={app}
          hidden={!items.some((item) => item.app === app && matches(item))}
          className="border border-[var(--docs-border)]"
        >
          <div className="campaign-section">
            <SectionHeader heading={CATEGORY_NAMES[app]} />
          </div>
          <div className="grid gap-px bg-[var(--docs-border)] sm:grid-cols-2 lg:grid-cols-3">
            {items
              .filter((item) => item.app === app)
              .map((item) => (
                <div
                  key={item.slug}
                  hidden={!matches(item)}
                  className="min-w-0"
                >
                  <ContentCard
                    href={sitePathForLocale(
                      `${USE_CASES_BASE}/${item.slug}`,
                      locale,
                    )}
                    title={item.title}
                    eyebrow={
                      item.how_often_label ? (
                        <CampaignFrequencyTag text={item.how_often_label} />
                      ) : undefined
                    }
                    body={item.subhead}
                  />
                </div>
              ))}
          </div>
        </section>
      ))}
    </TemplateLandingShell>
  );
}

export function UseCasePage({
  item,
  articles,
  useCases = [],
}: {
  item: UseCase;
  articles: Article[];
  useCases?: UseCase[];
}) {
  const t = useT();
  const { locale } = useLocale();
  const format = useFormatters();
  const [searchParams] = useSearchParams();
  const angle = item.angles?.find(
    (candidate) => candidate.id === searchParams.get("angle"),
  );
  const nextJobs = (item.next_jobs ?? []).flatMap((id) => {
    const next = useCases.find((candidate) => candidate.slug === id);
    return next ? [next] : [];
  });
  const names = (value: string | string[]) =>
    typeof value === "string"
      ? value
      : format.formatList(value, { type: "conjunction" });
  return (
    <TemplateLandingShell className="builder-brand-tokens campaign-page">
      <CampaignView item={item} />
      <JsonLd
        value={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: item.title,
          description: item.meta_description,
          dateModified: item.updated,
        }}
      />
      {item.faqs.length ? <JsonLd value={faqSchema(item.faqs)} /> : null}
      <TemplateHero
        title={angle?.title ?? item.title}
        description={angle?.subhead ?? item.subhead}
        descriptionPlacement="below-title"
        eyebrow={
          <span className="inline-flex flex-wrap items-center gap-2">
            {CATEGORY_NAMES[item.app]}
            <AppStatusBadge appId={item.app === "plans" ? "plan" : item.app} />
            {item.how_often_label ? (
              <CampaignFrequencyTag text={item.how_often_label} />
            ) : null}
          </span>
        }
        headingAction={
          <>
            <CampaignCta item={item} location="hero" />
            <Button
              variant="secondary"
              href="#how-it-works"
              className="max-w-full whitespace-normal"
            >
              {item.secondary_cta_label}
            </Button>
          </>
        }
        media={
          <div className="px-6 pb-8 sm:px-10">
            <CampaignScreenshot item={item} />
          </div>
        }
      />
      <TemplateSplitFeature
        leading={
          <div className="campaign-section flex flex-col gap-[var(--spacing-6)]">
            <SectionHeader
              eyebrow={t("campaign.oldWay")}
              heading={item.old_way.heading}
            />
            <p className="campaign-body m-0 whitespace-pre-line">
              {angle?.old_way_body ?? item.old_way.body}
            </p>
            {item.replaces?.length ? (
              <p className="campaign-body m-0">
                {t("campaign.alternative", { names: names(item.replaces) })}
              </p>
            ) : null}
          </div>
        }
        trailing={
          <div
            id="how-it-works"
            className="campaign-section flex scroll-mt-24 flex-col gap-[var(--spacing-6)]"
          >
            <SectionHeader
              eyebrow={t("campaign.newWay")}
              heading={item.new_way.heading}
            />
            <ol className="campaign-body m-0 list-decimal space-y-[var(--spacing-4)] ps-6">
              {item.new_way.steps.map((step, i) => (
                <li key={i} className="ps-2 whitespace-pre-line">
                  {step}
                </li>
              ))}
            </ol>
            {item.connects_to?.length ? (
              <p className="campaign-body m-0">
                {t("campaign.worksWith")} {item.connects_to.join(", ")}
              </p>
            ) : null}
          </div>
        }
      />
      {item.todays_stack ? (
        <section className="campaign-section min-w-0 space-y-[var(--spacing-6)] border-x border-b border-[var(--docs-border)]">
          <SectionHeader
            eyebrow={t("campaign.whatItReplaces")}
            heading={item.todays_stack.heading}
          />
          <ul className="campaign-body m-0 list-disc space-y-[var(--spacing-4)] ps-6">
            {item.todays_stack.items.map(({ text }, index) => (
              <li key={index}>
                {text.split(/(\*\*[^*]+\*\*)/g).map((part, partIndex) =>
                  part.startsWith("**") && part.endsWith("**") ? (
                    <strong key={partIndex}>{part.slice(2, -2)}</strong>
                  ) : part,
                )}
              </li>
            ))}
          </ul>
          <p className="campaign-body m-0">{item.todays_stack.in_app}</p>
        </section>
      ) : null}
      {item.recipes?.length ? (
        <section className="border-x border-b border-[var(--docs-border)]">
          <div className="campaign-section">
            <SectionHeader
              eyebrow={t("campaign.recipes")}
              heading={t("campaign.waysToUse")}
            />
          </div>
          <div className="campaign-recipes-grid grid gap-px border-t border-[var(--docs-border)] bg-[var(--docs-border)] md:grid-cols-2 lg:grid-cols-3">
            {item.recipes.map((recipe) => (
              <article key={recipe.id} className="campaign-recipe-card min-w-0 bg-[var(--b-bg-page)]">
                <div><CampaignFrequencyTag text={recipe.how_often} /></div>
                <h3 className="campaign-card-title">{recipe.title}</h3>
                <p className="campaign-body m-0 whitespace-pre-line">{recipe.when}</p>
                <dl className="m-0 space-y-[var(--spacing-2)]">
                  <dt className="campaign-label">{t("campaign.recipeDo")}</dt>
                  <dd className="campaign-body m-0 whitespace-pre-line">{recipe.do}</dd>
                </dl>
                <div
                  className={`min-w-0 max-w-full overflow-x-auto${recipe.prompt ? "" : " campaign-recipe-empty"}`}
                  aria-hidden={recipe.prompt ? undefined : true}
                >
                  {recipe.prompt ? <CodeBlock
                    code={recipe.prompt}
                    lang="text"
                    className="m-0"
                    onCopySuccess={() => trackEvent("recipe_copy", {
                      slug: item.slug,
                      job_id: item.job_id,
                      recipe_id: recipe.id,
                    })}
                  /> : null}
                </div>
                <dl className="m-0 space-y-[var(--spacing-2)]">
                  <dt className="campaign-label">{t("campaign.recipeYouGet")}</dt>
                  <dd className="campaign-body m-0 whitespace-pre-line">{recipe.you_get}</dd>
                </dl>
                {recipe.save ? (
                  <dl className="campaign-recipe-footer m-0 space-y-[var(--spacing-2)] border-t border-[var(--docs-border)] bg-[var(--b-bg-raised)]">
                    <dt className="campaign-label">{t("campaign.recipeSave")}</dt>
                    <dd className="campaign-body m-0 whitespace-pre-line">{recipe.save}</dd>
                  </dl>
                ) : <div className="campaign-recipe-empty" aria-hidden="true" />}
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {item.story ? (
        <figure className="campaign-section m-0 space-y-[var(--spacing-6)] border-x border-[var(--docs-border)]">
          <blockquote className="m-0 whitespace-pre-line text-2xl">
            {item.story.quote}
          </blockquote>
          <figcaption>
            <p className="m-0 font-semibold">{item.story.name}</p>
            <p className="m-0 text-[var(--fg-secondary)]">{item.story.role}</p>
            <p className="mt-3 text-[var(--fg-secondary)]">
              {t("campaign.usedBefore", {
                names: names(item.story.used_before),
              })}
            </p>
          </figcaption>
        </figure>
      ) : null}
      {item.faqs.length ? (
        <TemplateLandingFaq
          className="campaign-faq"
          eyebrow={t("campaign.faqs")}
          title={t("campaign.faqTitle")}
          idPrefix="use-case-faq"
          items={item.faqs.map((faq, i) => ({
            id: `question-${i + 1}`,
            question: faq.q,
            answer: <p className="m-0 whitespace-pre-line">{faq.a}</p>,
          }))}
        />
      ) : null}
      {nextJobs.length ? (
        <section className="border border-[var(--docs-border)]">
          <div className="campaign-section">
            <SectionHeader
              eyebrow={t("campaign.nextEyebrow")}
              heading={t("campaign.nextJobs")}
            />
          </div>
          <div className="grid gap-px bg-[var(--docs-border)] sm:grid-cols-2 lg:grid-cols-3">
            {nextJobs.map((next) => (
              <ContentCard
                key={next.slug}
                href={sitePathForLocale(
                  `${USE_CASES_BASE}/${next.slug}`,
                  locale,
                )}
                title={next.title}
                body={next.subhead}
                onClick={() =>
                  trackEvent("next_job_click", {
                    from_slug: item.slug,
                    to_slug: next.slug,
                  })
                }
              />
            ))}
          </div>
        </section>
      ) : null}
      {articles.length ? (
        <section className="border border-[var(--docs-border)]">
          <div className="campaign-section">
            <SectionHeader
              eyebrow={t("campaign.articles")}
              heading={t("campaign.goDeeper")}
            />
          </div>
          <div className="grid gap-px bg-[var(--docs-border)] sm:grid-cols-2 lg:grid-cols-3">
            {articles.map((article) => (
              <ContentCard
                key={article.slug}
                href={sitePathForLocale(
                  `${ARTICLES_BASE}/${article.slug}`,
                  locale,
                )}
                title={article.title}
                body={article.meta_description}
              />
            ))}
          </div>
        </section>
      ) : null}
      <CampaignBand item={item} />
    </TemplateLandingShell>
  );
}
