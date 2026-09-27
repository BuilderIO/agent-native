import { useT } from "@agent-native/core/client/i18n";
import { IconArrowUpRight } from "@tabler/icons-react";
import type { MouseEvent } from "react";

import { firstPartyAppUrl } from "../components/deployment-links";
import { applyFirstTouchAttributionToLink } from "../components/marketing-attribution";
import { TemplateHero } from "../components/template-landing";
import { SlidesBrandUpdateMock } from "../components/template-landing/SlidesBrandUpdateMock";
import { SlidesEditorMock } from "../components/template-landing/SlidesEditorMock";
import { SlidesPitchDeckMock } from "../components/template-landing/SlidesPitchDeckMock";
import { SlidesStrategyMock } from "../components/template-landing/SlidesStrategyMock";
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
        title: "Free AI Presentation Maker | Agent-Native Slides",
      },
      {
        name: "description",
        content:
          "Create presentations with your AI agent, apply your brand, and edit individual slides. Slides is a free, open-source AI presentation maker with PowerPoint export.",
      },
      {
        property: "og:title",
        content: "Free AI Presentation Maker | Agent-Native Slides",
      },
      {
        property: "og:description",
        content:
          "Create presentations with your AI agent, apply your brand, and edit individual slides. Slides is a free, open-source AI presentation maker with PowerPoint export.",
      },
      {
        name: "keywords",
        content:
          "AI presentation maker, AI slide generator, open source Google Slides alternative, Pitch alternative, AI PowerPoint, AI deck builder, agent-native slides, AI presentation tool, AI slide deck, prompt to presentation",
      },
    ],
    "Slides",
  );

const template = templates.find((t) => t.slug === "slides")!;

const USE_CASES = [
  {
    id: "sales-and-pitch-decks",
    titleKey: "useCase1Title",
    bodyKey: "useCase1Body",
    textLeft: true,
  },
  {
    id: "plans-and-strategies",
    titleKey: "useCase2Title",
    bodyKey: "useCase2Body",
    textLeft: false,
  },
  {
    id: "business-updates",
    titleKey: "useCase3Title",
    bodyKey: "useCase3Body",
    textLeft: true,
  },
] as const;

const KEY_FEATURES = [
  { id: "ai-generation", titleKey: "feature1Title", bodyKey: "feature1Body" },
  {
    id: "ai-visual-editing",
    titleKey: "feature2Title",
    bodyKey: "feature2Body",
  },
  { id: "brand-styles", titleKey: "feature3Title", bodyKey: "feature3Body" },
  {
    id: "images-and-logos",
    titleKey: "feature4Title",
    bodyKey: "feature4Body",
  },
  {
    id: "team-collaboration",
    titleKey: "feature5Title",
    bodyKey: "feature5Body",
  },
  {
    id: "presentation-and-export",
    titleKey: "feature6Title",
    bodyKey: "feature6Body",
  },
] as const;

const FAQ_ITEMS = [
  { id: "what-is-slides", question: "question1", answer: "answer1" },
  { id: "edit-after-generation", question: "question2", answer: "answer2" },
  { id: "create-from-existing", question: "question3", answer: "answer3" },
  { id: "brand-colors-fonts-logo", question: "question4", answer: "answer4" },
  { id: "powerpoint-google-slides", question: "question5", answer: "answer5" },
] as const;

const HERO_WRAPPER_CLASS =
  "template-detail-page mx-auto w-full max-w-site overflow-x-clip";

export default function SlidesTemplate() {
  const t = useT();

  return (
    <div className="builder-brand-tokens">
      {/* Hero — copy and layout match Clips; the media is a recreation of the
          deck editor rather than a screenshot, so it stays current and themes
          with the page. */}
      <div className={HERO_WRAPPER_CLASS}>
        <TemplateHero
          title={
            <span className="block max-w-[520px]">
              {t("templateLanding.slides.heroTitle")}
            </span>
          }
          eyebrow={
            <span className="inline-flex items-center gap-2 text-[var(--fg)]">
              <LogoMark className="size-6" />
              <span className="font-sans text-[20px] font-bold tracking-tight">
                {t("templateLanding.slides.heroEyebrow")}
              </span>
              <AppStatusBadge appId="slides" />
            </span>
          }
          customizeTemplate={template}
          headingAction={
            <a
              href={firstPartyAppUrl("https://slides.agent-native.com")}
              target="_blank"
              rel="noopener noreferrer"
              className="primary-button"
              style={{ gap: "4px" }}
              onClick={(event) => {
                applyFirstTouchAttributionToLink(event.currentTarget);
                trackEvent("generate deck", {
                  template: template.slug,
                  location: "landing_page_hero",
                });
              }}
            >
              {t("templateLanding.slides.heroCta")}
              <IconArrowUpRight size={16} />
            </a>
          }
          description={<p>{t("templateLanding.slides.heroDescription")}</p>}
          descriptionPlacement="below-title"
          mediaOverlapsHeader
          media={
            <SlidesEditorMock
              label={t("templateLanding.slides.s001")}
              className="h-[420px] sm:h-[620px] lg:h-[800px]"
            />
          }
        />
      </div>

      {/* What can you do with Slides? — three use-case rows */}
      <PageSection>
        <GridInner className="flex flex-col gap-[var(--spacing-6)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] pt-[var(--spacing-40)] pb-[var(--spacing-20)]">
          <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
            {t("templateLanding.slides.useCasesHeading")}
          </h2>
          <p className="m-0 max-w-[633px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
            {t("templateLanding.slides.useCasesBody")}
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
                    {t(`templateLanding.slides.${useCase.titleKey}`)}
                  </h3>
                  <p className="m-0 max-w-[420px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
                    {t(`templateLanding.slides.${useCase.bodyKey}`)}
                  </p>
                </div>
              );

              const mediaBlock = (
                <div
                  key="media"
                  className="order-2 flex items-center justify-center p-[var(--spacing-8)] lg:order-none lg:p-[var(--spacing-12)]"
                >
                  {useCase.id === "sales-and-pitch-decks" ? (
                    <SlidesPitchDeckMock
                      className="w-full max-w-[520px] lg:max-w-none"
                      label={t(`templateLanding.slides.${useCase.titleKey}`)}
                    />
                  ) : useCase.id === "plans-and-strategies" ? (
                    <SlidesStrategyMock
                      className="w-full max-w-[520px] lg:max-w-none"
                      label={t(`templateLanding.slides.${useCase.titleKey}`)}
                    />
                  ) : (
                    <SlidesBrandUpdateMock
                      className="w-full max-w-[520px] lg:max-w-none"
                      label={t(`templateLanding.slides.${useCase.titleKey}`)}
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
          and the Clips key-features grid, so both apps read as one system. */}
      <PageSection>
        <GridInner className="flex flex-col gap-[var(--spacing-6)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] pt-[var(--spacing-20)] pb-[var(--spacing-20)]">
          <p className="m-0 font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-1)] font-semibold uppercase tracking-[0.08em] text-[var(--b-text-secondary)]">
            {t("templateLanding.slides.keyFeaturesEyebrow")}
          </p>
          <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
            {t("templateLanding.slides.keyFeaturesHeading")}
          </h2>
        </GridInner>
      </PageSection>

      {/* The card grid draws its own dividers, so the decorative three-column
          overlay is off here; leaving it on would double every line. */}
      <PageSection showGrid={false}>
        <GridInner>
          <div className="grid grid-cols-3 gap-px border border-solid border-[var(--b-border-subtle)] bg-[var(--b-border-subtle)] mobile:grid-cols-2 narrow:grid-cols-1">
            {KEY_FEATURES.map((feature) => (
              <ContentCard
                key={feature.id}
                title={t(`templateLanding.slides.${feature.titleKey}`)}
                body={t(`templateLanding.slides.${feature.bodyKey}`)}
              />
            ))}
          </div>
        </GridInner>
      </PageSection>

      {/* FAQs — Clips gets this section's breathing room for free from its
          "See Clips in action" section in between; Slides has no such
          section, so add the same pt-20 rhythm directly here instead of
          landing the FAQ flush against the feature grid above it. The padding
          sits on the section so the border-t stays where Clips has it: right
          above the first FAQ row, which is that row's top border. */}
      <PageSection className="pt-[var(--spacing-20)]">
        <GridInner className="border-t border-solid border-[var(--b-border-default)]">
          <FaqAccordion
            idPrefix="slides-faq"
            eyebrow={t("templateLanding.faq.eyebrow")}
            title={t("templateLanding.faq.title")}
            items={FAQ_ITEMS.map((item) => ({
              id: item.id,
              question: t(`templateLanding.slides.faq.${item.question}`),
              answer: (
                <p className="m-0">
                  {t(`templateLanding.slides.faq.${item.answer}`)}
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
            {t("templateLanding.slides.finalCtaHeading")}
          </h2>
          <p className="m-0 max-w-[560px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
            {t("templateLanding.slides.finalCtaBody")}
          </p>
          <Button
            variant="cta"
            href={firstPartyAppUrl("https://slides.agent-native.com")}
            target="_blank"
            rel="noopener noreferrer"
            style={{ gap: "3px", fontSize: "12px", textTransform: "uppercase" }}
            onClick={(event: MouseEvent<HTMLAnchorElement>) => {
              applyFirstTouchAttributionToLink(event.currentTarget);
              trackEvent("generate deck", {
                template: template.slug,
                location: "landing_page_final_cta",
              });
            }}
          >
            {t("templateLanding.slides.finalCtaButton")}
          </Button>
        </GridInner>
      </PageSection>
    </div>
  );
}
