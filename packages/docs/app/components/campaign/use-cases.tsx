import { useT, useFormatters, useLocale } from "@agent-native/core/client/i18n";

import {
  ARTICLES_BASE,
  USE_CASES_BASE,
  CATEGORY_NAMES,
} from "../../../lib/campaign-content";
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
import { SectionHeader } from "../website-redesign/ds/section-header";
import { type UseCase, type Article } from "./public-content";
import {
  CampaignBand,
  CampaignCta,
  CampaignScreenshot,
  CampaignView,
  JsonLd,
  faqSchema,
} from "./shared";

export function UseCasesIndex({ items }: { items: UseCase[] }) {
  const t = useT();
  const { locale } = useLocale();
  const apps = [...new Set(items.map((item) => item.app))];
  return (
    <TemplateLandingShell className="builder-brand-tokens pb-16">
      <div className="border-x border-[var(--docs-border)] px-6 py-16 sm:px-10">
        <SectionHeader
          eyebrow={t("campaign.useCases")}
          as="h1"
          heading={t("campaign.useCasesTitle")}
          subheading={t("campaign.useCasesIntro")}
        />
      </div>
      {apps.map((app) => (
        <section key={app} className="border border-[var(--docs-border)]">
          <div className="p-6 sm:p-8">
            <SectionHeader heading={CATEGORY_NAMES[app]} />
          </div>
          <div className="grid gap-px bg-[var(--docs-border)] sm:grid-cols-2 lg:grid-cols-3">
            {items
              .filter((item) => item.app === app)
              .map((item) => (
                <ContentCard
                  key={item.slug}
                  href={sitePathForLocale(
                    `${USE_CASES_BASE}/${item.slug}`,
                    locale,
                  )}
                  title={item.title}
                  body={item.subhead}
                />
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
}: {
  item: UseCase;
  articles: Article[];
}) {
  const t = useT();
  const { locale } = useLocale();
  const format = useFormatters();
  const names = (value: string | string[]) =>
    typeof value === "string"
      ? value
      : format.formatList(value, { type: "conjunction" });
  return (
    <TemplateLandingShell className="builder-brand-tokens">
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
        title={item.title}
        description={item.subhead}
        descriptionPlacement="below-title"
        eyebrow={
          <span className="inline-flex items-center gap-2">
            {CATEGORY_NAMES[item.app]}
            <AppStatusBadge appId={item.app === "plans" ? "plan" : item.app} />
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
          <div className="space-y-6 p-6 sm:p-8">
            <SectionHeader
              eyebrow={t("campaign.oldWay")}
              heading={item.old_way.heading}
            />
            <p className="whitespace-pre-line text-lg text-[var(--fg-secondary)]">
              {item.old_way.body}
            </p>
            {item.replaces?.length ? (
              <p className="text-[var(--fg-secondary)]">
                {t("campaign.alternative", { names: names(item.replaces) })}
              </p>
            ) : null}
          </div>
        }
        trailing={
          <div id="how-it-works" className="scroll-mt-24 space-y-6 p-6 sm:p-8">
            <SectionHeader
              eyebrow={t("campaign.newWay")}
              heading={item.new_way.heading}
            />
            <ol className="list-decimal space-y-4 ps-6 text-lg text-[var(--fg-secondary)]">
              {item.new_way.steps.map((step, i) => (
                <li key={i} className="ps-2 whitespace-pre-line">
                  {step}
                </li>
              ))}
            </ol>
          </div>
        }
      />
      {item.story ? (
        <figure className="m-0 space-y-6 border-x border-[var(--docs-border)] p-6 py-12 sm:p-10">
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
      {articles.length ? (
        <section className="border border-[var(--docs-border)]">
          <div className="p-6 sm:p-8">
            <SectionHeader heading={t("campaign.goDeeper")} />
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
              />
            ))}
          </div>
        </section>
      ) : null}
      <CampaignBand item={item} />
    </TemplateLandingShell>
  );
}
