import { useT } from "@agent-native/core/client/i18n";
import { IconArrowUpRight } from "@tabler/icons-react";
import type { MouseEvent } from "react";

import { firstPartyAppUrl } from "../components/deployment-links";
import { applyFirstTouchAttributionToLink } from "../components/marketing-attribution";
import { TemplateHero } from "../components/template-landing";
import {
  AnalyticsLandingMock,
  AnalyticsLandingMockStyles,
} from "../components/template-landing/AnalyticsLandingMock";
import { templates, trackEvent } from "../components/TemplateCard";
import { AppStatusBadge } from "../components/website-redesign/ds/app-status-badge";
import { Button } from "../components/website-redesign/ds/button";
import { ContentCard } from "../components/website-redesign/ds/content-card";
import { FaqAccordion } from "../components/website-redesign/ds/faq-accordion";
import { LogoMark } from "../components/website-redesign/ds/logo-mark";
import {
  GridInner,
  PageSection,
} from "../components/website-redesign/page-grid";
import { withTemplateSocialImage } from "../seo";

export const meta = () =>
  withTemplateSocialImage(
    [
      {
        title: "Free AI Analytics Tool | Agent-Native Analytics",
      },
      {
        name: "description",
        content:
          "Ask questions about your data, inspect SQL, and build dashboards with your AI agent. Analytics is a free and open-source analytics tool with session replay.",
      },
      {
        property: "og:title",
        content: "Free AI Analytics Tool | Agent-Native Analytics",
      },
      {
        property: "og:description",
        content:
          "Ask questions about your data, inspect SQL, and build dashboards with your AI agent. Analytics is a free and open-source analytics tool with session replay.",
      },
      {
        name: "keywords",
        content:
          "AI analytics tool, open source analytics, Amplitude alternative, FullStory alternative, Mixpanel alternative, AI dashboard builder, natural language SQL, session replay, agent-native analytics",
      },
    ],
    "Analytics",
  );

const template = templates.find((t) => t.slug === "analytics")!;

const USE_CASES = [
  {
    id: "track-product-growth",
    mode: "growth",
    textLeft: true,
    titleKey: "useCase1Title",
    bodyKey: "useCase1Body",
  },
  {
    id: "report-on-business-performance",
    mode: "report",
    textLeft: false,
    titleKey: "useCase2Title",
    bodyKey: "useCase2Body",
  },
  {
    id: "investigate-user-issues",
    mode: "replay",
    textLeft: true,
    titleKey: "useCase3Title",
    bodyKey: "useCase3Body",
  },
] as const;

const KEY_FEATURES = [
  {
    id: "natural-language-queries",
    titleKey: "feature1Title",
    bodyKey: "feature1Body",
  },
  {
    id: "reusable-dashboards",
    titleKey: "feature2Title",
    bodyKey: "feature2Body",
  },
  {
    id: "sql-query-explorer",
    titleKey: "feature3Title",
    bodyKey: "feature3Body",
  },
  {
    id: "data-source-connections",
    titleKey: "feature4Title",
    bodyKey: "feature4Body",
  },
  { id: "data-dictionary", titleKey: "feature5Title", bodyKey: "feature5Body" },
  { id: "session-replay", titleKey: "feature6Title", bodyKey: "feature6Body" },
] as const;

const FAQ_ITEMS = [
  { id: "what-is-analytics", question: "question1", answer: "answer1" },
  { id: "sql-knowledge-required", question: "question2", answer: "answer2" },
  { id: "supported-data-sources", question: "question3", answer: "answer3" },
  {
    id: "custom-metric-definitions",
    question: "question4",
    answer: "answer4",
  },
  {
    id: "sharing-and-scheduling",
    question: "question5",
    answer: "answer5",
  },
] as const;

const HERO_WRAPPER_CLASS =
  "template-detail-page mx-auto w-full max-w-site overflow-x-clip";

export default function AnalyticsTemplate() {
  const t = useT();

  return (
    <div className="builder-brand-tokens">
      <AnalyticsLandingMockStyles />
      {/* Hero keeps the shared landing-page frame while showing the app's
          dashboard and contextual agent together. */}
      <div className={HERO_WRAPPER_CLASS}>
        <TemplateHero
          title={
            <span className="block max-w-[520px]">
              {t("templateLanding.analytics.heroTitle")}
            </span>
          }
          eyebrow={
            <span className="inline-flex items-center gap-2 text-[var(--fg)]">
              <LogoMark className="size-6" />
              <span className="font-sans text-[20px] font-bold tracking-tight">
                {t("templateLanding.analytics.heroEyebrow")}
              </span>
              <AppStatusBadge appId="analytics" />
            </span>
          }
          customizeTemplate={template}
          headingAction={
            <a
              href={firstPartyAppUrl("https://analytics.agent-native.com")}
              target="_blank"
              rel="noopener noreferrer"
              className="primary-button"
              style={{ gap: "4px" }}
              onClick={(event) => {
                applyFirstTouchAttributionToLink(event.currentTarget);
                trackEvent("try live demo", {
                  template: template.slug,
                  location: "landing_page_hero",
                });
              }}
            >
              {t("templateLanding.analytics.heroCta")}
              <IconArrowUpRight size={16} />
            </a>
          }
          description={<p>{t("templateLanding.analytics.heroDescription")}</p>}
          descriptionPlacement="below-title"
          mediaOverlapsHeader
          media={
            <AnalyticsLandingMock
              mode="dashboard"
              label={t("templateLanding.analytics.s001")}
              className="h-[420px] sm:h-[620px] lg:h-[800px]"
            />
          }
        />
      </div>

      {/* Use-case stories pair the existing translated copy with a concrete
          Analytics surface. */}
      <PageSection>
        <GridInner className="flex flex-col gap-[var(--spacing-6)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] pt-[var(--spacing-40)] pb-[var(--spacing-20)]">
          <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
            {t("templateLanding.analytics.useCasesHeading")}
          </h2>
          <p className="m-0 max-w-[633px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
            {t("templateLanding.analytics.useCasesBody")}
          </p>
        </GridInner>

        <GridInner>
          <div className="flex flex-col border-x border-t border-solid border-[var(--b-border-subtle)]">
            {USE_CASES.map((useCase) => {
              const textBlock = (
                <div
                  key="text"
                  className="order-1 flex flex-col justify-center gap-[var(--spacing-3)] p-[var(--spacing-8)] lg:order-none lg:p-[var(--spacing-12)]"
                >
                  <h3 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-4)] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--b-text-primary)]">
                    {t(`templateLanding.analytics.${useCase.titleKey}`)}
                  </h3>
                  <p className="m-0 max-w-[420px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
                    {t(`templateLanding.analytics.${useCase.bodyKey}`)}
                  </p>
                </div>
              );
              const mediaBlock = (
                <div
                  key="media"
                  className="order-2 flex items-center justify-center p-[var(--spacing-8)] lg:order-none lg:p-[var(--spacing-12)]"
                >
                  <AnalyticsLandingMock
                    mode={useCase.mode}
                    label={t(`templateLanding.analytics.${useCase.titleKey}`)}
                    className="h-[290px] min-h-[290px] w-full"
                    showSidebar={false}
                    showAgent={useCase.mode === "growth"}
                  />
                </div>
              );
              return (
                <div
                  key={useCase.id}
                  className={`grid border-t border-solid border-[var(--b-border-subtle)] bg-[var(--b-bg-page)] first:border-t-0 ${
                    useCase.textLeft
                      ? "lg:grid-cols-[1fr_1.25fr]"
                      : "lg:grid-cols-[1.25fr_1fr]"
                  }`}
                >
                  {useCase.textLeft ? (
                    <>
                      {textBlock}
                      {mediaBlock}
                    </>
                  ) : (
                    <>
                      {mediaBlock}
                      {textBlock}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </GridInner>
      </PageSection>

      {/* Key features — six cards, same layout as builder.io/platform/code
          and the Slides/Clips key-features grids, so every app reads as one
          system. */}
      <PageSection>
        <GridInner className="flex flex-col gap-[var(--spacing-6)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] pt-[var(--spacing-20)] pb-[var(--spacing-20)]">
          <p className="m-0 font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-1)] font-semibold uppercase tracking-[0.08em] text-[var(--b-text-secondary)]">
            {t("templateLanding.analytics.keyFeaturesEyebrow")}
          </p>
          <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
            {t("templateLanding.analytics.keyFeaturesHeading")}
          </h2>
        </GridInner>

        <GridInner>
          <div className="grid grid-cols-3 gap-px border border-solid border-[var(--b-border-subtle)] bg-[var(--b-border-subtle)] mobile:grid-cols-2 narrow:grid-cols-1">
            {KEY_FEATURES.map((feature) => (
              <ContentCard
                key={feature.id}
                title={t(`templateLanding.analytics.${feature.titleKey}`)}
                body={t(`templateLanding.analytics.${feature.bodyKey}`)}
              />
            ))}
          </div>
        </GridInner>
      </PageSection>

      {/* FAQs — Slides has no "see it in action" section either, so add the
          same pt-20 rhythm directly here instead of landing the FAQ flush
          against the feature grid above it. */}
      <PageSection>
        <GridInner className="border-t border-solid border-[var(--b-border-default)] pt-[var(--spacing-20)]">
          <FaqAccordion
            idPrefix="analytics-faq"
            eyebrow={t("templateLanding.faq.eyebrow")}
            title={t("templateLanding.faq.title")}
            items={FAQ_ITEMS.map((item) => ({
              id: item.id,
              question: t(`templateLanding.analytics.faq.${item.question}`),
              answer: (
                <p className="m-0">
                  {t(`templateLanding.analytics.faq.${item.answer}`)}
                </p>
              ),
            }))}
          />
        </GridInner>
      </PageSection>

      {/* Final CTA */}
      <PageSection>
        <GridInner className="flex flex-col items-center gap-[var(--spacing-6)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] py-[var(--spacing-40)] text-center">
          <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
            {t("templateLanding.analytics.finalCtaHeading")}
          </h2>
          <p className="m-0 max-w-[560px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
            {t("templateLanding.analytics.finalCtaBody")}
          </p>
          <Button
            variant="cta"
            href={firstPartyAppUrl("https://analytics.agent-native.com")}
            target="_blank"
            rel="noopener noreferrer"
            style={{ gap: "3px", fontSize: "12px", textTransform: "uppercase" }}
            onClick={(event: MouseEvent<HTMLAnchorElement>) => {
              applyFirstTouchAttributionToLink(event.currentTarget);
              trackEvent("try live demo", {
                template: template.slug,
                location: "landing_page_final_cta",
              });
            }}
          >
            {t("templateLanding.analytics.finalCtaButton")}
          </Button>
        </GridInner>
      </PageSection>
    </div>
  );
}
