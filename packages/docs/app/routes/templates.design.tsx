import { useT } from "@agent-native/core/client/i18n";
import { IconArrowUpRight } from "@tabler/icons-react";
import type { MouseEvent } from "react";

import { firstPartyAppUrl } from "../components/deployment-links";
import { applyFirstTouchAttributionToLink } from "../components/marketing-attribution";
import { TemplateHero } from "../components/template-landing";
import { DesignDashboardMock } from "../components/template-landing/DesignDashboardMock";
import { DesignFlowMock } from "../components/template-landing/DesignFlowMock";
import { DesignOverviewMock } from "../components/template-landing/DesignOverviewMock";
import { DesignVariantsMock } from "../components/template-landing/DesignVariantsMock";
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
        title: "Free AI Design & Prototyping Tool | Agent-Native Design",
      },
      {
        name: "description",
        content:
          "Create on-brand interfaces and interactive prototypes with your AI agent. Design is a free, open-source AI design and prototyping tool with visual editing.",
      },
      {
        property: "og:title",
        content: "Free AI Design & Prototyping Tool | Agent-Native Design",
      },
      {
        property: "og:description",
        content:
          "Create on-brand interfaces and interactive prototypes with your AI agent. Design is a free, open-source AI design and prototyping tool with visual editing.",
      },
      {
        name: "keywords",
        content:
          "AI design tool, AI prototyping tool, open source Figma alternative, AI UI generator, HTML prototype tool, agent-native design, prompt to prototype, AI interface design",
      },
    ],
    "Design",
  );

const template = templates.find((t) => t.slug === "design")!;

const USE_CASES = [
  {
    id: "landing-page-ideas",
    titleKey: "useCase1Title",
    bodyKey: "useCase1Body",
    textLeft: true,
  },
  {
    id: "product-flows",
    titleKey: "useCase2Title",
    bodyKey: "useCase2Body",
    textLeft: false,
  },
  {
    id: "dashboards-and-internal-tools",
    titleKey: "useCase3Title",
    bodyKey: "useCase3Body",
    textLeft: true,
  },
] as const;

const KEY_FEATURES = [
  {
    id: "interactive-prototypes",
    titleKey: "feature1Title",
    bodyKey: "feature1Body",
  },
  {
    id: "ai-visual-editing",
    titleKey: "feature2Title",
    bodyKey: "feature2Body",
  },
  {
    id: "design-variants",
    titleKey: "feature3Title",
    bodyKey: "feature3Body",
  },
  {
    id: "brand-styles",
    titleKey: "feature4Title",
    bodyKey: "feature4Body",
  },
  {
    id: "review-comments",
    titleKey: "feature5Title",
    bodyKey: "feature5Body",
  },
  {
    id: "export-and-handoff",
    titleKey: "feature6Title",
    bodyKey: "feature6Body",
  },
] as const;

const FAQ_ITEMS = [
  { id: "what-is-design", question: "question1", answer: "answer1" },
  { id: "edit-after-generation", question: "question2", answer: "answer2" },
  { id: "own-design-system", question: "question3", answer: "answer3" },
  { id: "figma-workflows", question: "question4", answer: "answer4" },
  { id: "export-and-finished-app", question: "question5", answer: "answer5" },
] as const;

const HERO_WRAPPER_CLASS =
  "template-detail-page mx-auto w-full max-w-site overflow-x-clip";

export default function DesignTemplate() {
  const t = useT();

  return (
    <div className="builder-brand-tokens">
      {/* Hero — copy and layout updated to match Slides; existing hero mock
          kept since there's no newer Design screenshot asset yet. */}
      <div className={HERO_WRAPPER_CLASS}>
        <TemplateHero
          title={t("templateLanding.design.heroTitle")}
          eyebrow={
            <span className="inline-flex items-center gap-2 text-[var(--fg)]">
              <LogoMark className="size-6" />
              <span className="font-sans text-[20px] font-bold tracking-tight">
                {t("templateLanding.design.heroEyebrow")}
              </span>
              <AppStatusBadge appId="design" />
            </span>
          }
          customizeTemplate={template}
          headingAction={
            <a
              href={firstPartyAppUrl("https://design.agent-native.com")}
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
              {t("templateLanding.design.heroCta")}
              <IconArrowUpRight size={16} />
            </a>
          }
          description={<p>{t("templateLanding.design.heroDescription")}</p>}
          descriptionPlacement="below-title"
          mediaOverlapsHeader
          media={
            <DesignOverviewMock
              label={t("templateLanding.design.s001")}
              className="h-[340px] sm:h-[540px] lg:h-[640px]"
            />
          }
        />
      </div>

      {/* What can you do with Design? — three use-case rows */}
      <PageSection>
        <GridInner className="flex flex-col gap-[var(--spacing-6)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] pt-[var(--spacing-40)] pb-[var(--spacing-20)]">
          <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
            {t("templateLanding.design.useCasesHeading")}
          </h2>
          <p className="m-0 max-w-[633px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
            {t("templateLanding.design.useCasesBody")}
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
                    {t(`templateLanding.design.${useCase.titleKey}`)}
                  </h3>
                  <p className="m-0 max-w-[420px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
                    {t(`templateLanding.design.${useCase.bodyKey}`)}
                  </p>
                </div>
              );

              const mediaBlock = (
                <div
                  key="media"
                  className="order-2 flex items-center justify-center p-[var(--spacing-8)] lg:order-none lg:p-[var(--spacing-12)]"
                >
                  {useCase.id === "landing-page-ideas" ? (
                    <DesignVariantsMock
                      className="w-full max-w-[520px] lg:max-w-none"
                      label={t(`templateLanding.design.${useCase.titleKey}`)}
                    />
                  ) : useCase.id === "product-flows" ? (
                    <DesignFlowMock
                      className="w-full max-w-[520px] lg:max-w-none"
                      label={t(`templateLanding.design.${useCase.titleKey}`)}
                    />
                  ) : (
                    <DesignDashboardMock
                      className="w-full max-w-[520px] lg:max-w-none"
                      label={t(`templateLanding.design.${useCase.titleKey}`)}
                    />
                  )}
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
          and the Slides/Clips key-features grid, so all apps read as one
          system. */}
      <PageSection>
        <GridInner className="flex flex-col gap-[var(--spacing-6)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] pt-[var(--spacing-20)] pb-[var(--spacing-20)]">
          <p className="m-0 font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-1)] font-semibold uppercase tracking-[0.08em] text-[var(--b-text-secondary)]">
            {t("templateLanding.design.keyFeaturesEyebrow")}
          </p>
          <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
            {t("templateLanding.design.keyFeaturesHeading")}
          </h2>
        </GridInner>

        <GridInner>
          <div className="grid grid-cols-3 gap-px border border-solid border-[var(--b-border-subtle)] bg-[var(--b-border-subtle)] mobile:grid-cols-2 narrow:grid-cols-1">
            {KEY_FEATURES.map((feature) => (
              <ContentCard
                key={feature.id}
                title={t(`templateLanding.design.${feature.titleKey}`)}
                body={t(`templateLanding.design.${feature.bodyKey}`)}
              />
            ))}
          </div>
        </GridInner>
      </PageSection>

      {/* FAQs — Clips gets this section's breathing room for free from its
          "See Clips in action" section in between; Design has no such
          section, so add the same pt-20 rhythm directly here instead of
          landing the FAQ flush against the feature grid above it. */}
      <PageSection>
        <GridInner className="border-t border-solid border-[var(--b-border-default)] pt-[var(--spacing-20)]">
          <FaqAccordion
            idPrefix="design-faq"
            eyebrow={t("templateLanding.faq.eyebrow")}
            title={t("templateLanding.faq.title")}
            items={FAQ_ITEMS.map((item) => ({
              id: item.id,
              question: t(`templateLanding.design.faq.${item.question}`),
              answer: (
                <p className="m-0">
                  {t(`templateLanding.design.faq.${item.answer}`)}
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
            {t("templateLanding.design.finalCtaHeading")}
          </h2>
          <p className="m-0 max-w-[560px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
            {t("templateLanding.design.finalCtaBody")}
          </p>
          <Button
            variant="cta"
            href={firstPartyAppUrl("https://design.agent-native.com")}
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
            {t("templateLanding.design.finalCtaButton")}
          </Button>
        </GridInner>
      </PageSection>
    </div>
  );
}
