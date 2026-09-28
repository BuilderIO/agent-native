import { useT } from "@agent-native/core/client/i18n";
import { IconArrowUpRight } from "@tabler/icons-react";
import type { MouseEvent } from "react";

import { firstPartyAppUrl } from "../components/deployment-links";
import { applyFirstTouchAttributionToLink } from "../components/marketing-attribution";
import { TemplateHero } from "../components/template-landing";
import { ContentLandingMock } from "../components/template-landing/ContentLandingMock";
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
        title: "Free AI Workspace for Docs & Tasks | Agent-Native Content",
      },
      {
        name: "description",
        content:
          "Write documents, track tasks, and collect requests with your AI agents. Content is a free and open-source workspace with collaborative editing and databases.",
      },
      {
        property: "og:title",
        content: "Free AI Workspace for Docs & Tasks | Agent-Native Content",
      },
      {
        property: "og:description",
        content:
          "Write documents, track tasks, and collect requests with your AI agents. Content is a free and open-source workspace with collaborative editing and databases.",
      },
      {
        name: "keywords",
        content:
          "AI workspace, AI document editor, open source Notion alternative, AI task tracker, AI database, agent-native content, collaborative documents, AI writing assistant",
      },
    ],
    "Content",
  );

const template = templates.find((t) => t.slug === "content")!;

const USE_CASES = [
  {
    id: "write-and-review-content",
    titleKey: "useCase1Title",
    bodyKey: "useCase1Body",
    textLeft: true,
  },
  {
    id: "track-work-with-agents",
    titleKey: "useCase2Title",
    bodyKey: "useCase2Body",
    textLeft: false,
  },
  {
    id: "collect-project-requests",
    titleKey: "useCase3Title",
    bodyKey: "useCase3Body",
    textLeft: true,
  },
] as const;

const KEY_FEATURES = [
  {
    id: "ai-writing-and-review",
    titleKey: "feature1Title",
    bodyKey: "feature1Body",
  },
  {
    id: "documents-and-nested-pages",
    titleKey: "feature2Title",
    bodyKey: "feature2Body",
  },
  {
    id: "databases-and-views",
    titleKey: "feature3Title",
    bodyKey: "feature3Body",
  },
  {
    id: "page-and-field-instructions",
    titleKey: "feature4Title",
    bodyKey: "feature4Body",
  },
  {
    id: "connected-ai-agents",
    titleKey: "feature5Title",
    bodyKey: "feature5Body",
  },
  {
    id: "team-collaboration",
    titleKey: "feature6Title",
    bodyKey: "feature6Body",
  },
] as const;

const FAQ_ITEMS = [
  { id: "what-is-content", question: "question1", answer: "answer1" },
  { id: "use-own-ai-agent", question: "question2", answer: "answer2" },
  {
    id: "review-without-rewriting",
    question: "question3",
    answer: "answer3",
  },
  {
    id: "track-tasks-collect-requests",
    question: "question4",
    answer: "answer4",
  },
  {
    id: "control-access-restore-version",
    question: "question5",
    answer: "answer5",
  },
] as const;

const HERO_WRAPPER_CLASS =
  "template-detail-page mx-auto w-full max-w-site overflow-x-clip";

export default function ContentTemplate() {
  const t = useT();

  return (
    <div className="builder-brand-tokens">
      {/* Hero */}
      <div className={HERO_WRAPPER_CLASS}>
        <TemplateHero
          title={
            <span className="block max-w-[560px]">
              {t("templateLanding.content.heroTitle")}
            </span>
          }
          eyebrow={
            <span className="inline-flex items-center gap-2 text-[var(--fg)]">
              <LogoMark className="size-6" />
              <span className="font-sans text-[20px] font-bold tracking-tight">
                {t("templateLanding.content.heroEyebrow")}
              </span>
              <AppStatusBadge appId="content" />
            </span>
          }
          customizeTemplate={template}
          headingAction={
            <a
              href={firstPartyAppUrl("https://content.agent-native.com")}
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
              {t("templateLanding.content.heroCta")}
              <IconArrowUpRight size={16} />
            </a>
          }
          description={<p>{t("templateLanding.content.heroDescription")}</p>}
          descriptionPlacement="below-title"
          mediaOverlapsHeader
          media={
            <ContentLandingMock
              label={t("templateLanding.content.s001")}
              className="h-[360px] sm:h-[520px] lg:h-[640px]"
            />
          }
        />
      </div>

      {/* Three concrete starting workflows */}
      <PageSection>
        <GridInner className="flex flex-col gap-[var(--spacing-6)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] pt-[var(--spacing-40)] pb-[var(--spacing-20)]">
          <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
            {t("templateLanding.content.useCasesHeading")}
          </h2>
          <p className="m-0 max-w-[633px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
            {t("templateLanding.content.useCasesBody")}
          </p>
        </GridInner>

        <GridInner>
          <div className="flex flex-col border-t border-x border-solid border-[var(--b-border-subtle)]">
            {USE_CASES.map((useCase) => {
              const textBlock = (
                <div
                  key="text"
                  className="order-1 flex flex-col justify-center gap-[var(--spacing-3)] p-[var(--spacing-8)] lg:order-none lg:p-[var(--spacing-12)]"
                >
                  <h3 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-4)] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--b-text-primary)]">
                    {t(`templateLanding.content.${useCase.titleKey}`)}
                  </h3>
                  <p className="m-0 max-w-[420px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
                    {t(`templateLanding.content.${useCase.bodyKey}`)}
                  </p>
                </div>
              );
              const mediaBlock = (
                <div
                  key="media"
                  className="order-2 flex items-center justify-center p-[var(--spacing-8)] lg:order-none lg:p-[var(--spacing-12)]"
                >
                  <ContentLandingMock
                    variant={useCase.id}
                    sidebarCollapsed
                    label={t(`templateLanding.content.${useCase.titleKey}`)}
                    className="h-[320px] w-full max-w-[620px] lg:h-[380px] lg:max-w-none"
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
            {t("templateLanding.content.keyFeaturesEyebrow")}
          </p>
          <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
            {t("templateLanding.content.keyFeaturesHeading")}
          </h2>
        </GridInner>

        <GridInner>
          <div className="grid grid-cols-3 gap-px border border-solid border-[var(--b-border-subtle)] bg-[var(--b-border-subtle)] mobile:grid-cols-2 narrow:grid-cols-1">
            {KEY_FEATURES.map((feature) => (
              <ContentCard
                key={feature.id}
                title={t(`templateLanding.content.${feature.titleKey}`)}
                body={t(`templateLanding.content.${feature.bodyKey}`)}
              />
            ))}
          </div>
        </GridInner>
      </PageSection>

      {/* FAQs — Clips gets this section's breathing room for free from its
          "See Clips in action" section in between; Content has no such
          section, so add the same pt-20 rhythm directly here instead of
          landing the FAQ flush against the feature grid above it. */}
      <PageSection>
        <GridInner className="border-t border-solid border-[var(--b-border-default)] pt-[var(--spacing-20)]">
          <FaqAccordion
            idPrefix="content-faq"
            eyebrow={t("templateLanding.faq.eyebrow")}
            title={t("templateLanding.faq.title")}
            items={FAQ_ITEMS.map((item) => ({
              id: item.id,
              question: t(`templateLanding.content.faq.${item.question}`),
              answer: (
                <p className="m-0">
                  {t(`templateLanding.content.faq.${item.answer}`)}
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
            {t("templateLanding.content.finalCtaHeading")}
          </h2>
          <p className="m-0 max-w-[560px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
            {t("templateLanding.content.finalCtaBody")}
          </p>
          <Button
            variant="cta"
            href={firstPartyAppUrl("https://content.agent-native.com")}
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
            {t("templateLanding.content.finalCtaButton")}
          </Button>
        </GridInner>
      </PageSection>
    </div>
  );
}
