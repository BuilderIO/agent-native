import { useT } from "@agent-native/core/client/i18n";
import { IconArrowUpRight } from "@tabler/icons-react";
import type { MouseEvent } from "react";

import { BuilderImage } from "../components/builder-image";
import { firstPartyAppUrl } from "../components/deployment-links";
import { applyFirstTouchAttributionToLink } from "../components/marketing-attribution";
import { TemplateHero } from "../components/template-landing";
import { templates, trackEvent } from "../components/TemplateCard";
import { Button } from "../components/website-redesign/ds/button";
import { ContentCard } from "../components/website-redesign/ds/content-card";
import { FaqAccordion } from "../components/website-redesign/ds/faq-accordion";
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

// Same no-imagery pattern Clips used before its use-case mocks existed: plain
// ContentCards, no `image`/`imageLabel`, so the section reads as one system
// with the key-features grid below it instead of leaving placeholder boxes.
const USE_CASES = [
  {
    id: "sales-and-pitch-decks",
    titleKey: "useCase1Title",
    bodyKey: "useCase1Body",
  },
  {
    id: "plans-and-strategies",
    titleKey: "useCase2Title",
    bodyKey: "useCase2Body",
  },
  {
    id: "business-updates",
    titleKey: "useCase3Title",
    bodyKey: "useCase3Body",
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

// TemplateHero assumes an ancestor centers it at max-w-site with zero extra
// gutter — TemplateLandingShell used to be that ancestor. Every PageSection
// below draws its grid lines flush to that same max-w-site edge, so this
// wrapper must match exactly (no px-* here) or the hero's border-x box ends
// up narrower than the rest of the page.
const HERO_WRAPPER_CLASS =
  "template-detail-page mx-auto w-full max-w-site overflow-x-clip";

export default function SlidesTemplate() {
  const t = useT();

  return (
    <div className="builder-brand-tokens">
      {/* Hero — copy and layout updated to match Clips; existing hero
          screenshot kept since there's no newer Slides asset yet. */}
      <div className={HERO_WRAPPER_CLASS}>
        <TemplateHero
          title={t("templateLanding.slides.heroTitle")}
          eyebrow={
            <span className="text-[var(--fg-secondary)]">
              {t("templateLanding.slides.heroEyebrow")}
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
            <BuilderImage
              src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F3723b83883aa4df7b1c53011d2f7ce2c"
              crossOrigin="anonymous"
              alt={t("templateLanding.slides.s001")}
              loading="lazy"
              decoding="async"
              className="h-auto max-h-[640px] w-full object-cover object-top"
            />
          }
        />
      </div>

      {/* What can you do with Slides? — three use-case cards */}
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
          <div className="grid grid-cols-3 gap-px border border-solid border-[var(--b-border-subtle)] bg-[var(--b-border-subtle)] mobile:grid-cols-1">
            {USE_CASES.map((useCase) => (
              <ContentCard
                key={useCase.id}
                title={t(`templateLanding.slides.${useCase.titleKey}`)}
                body={t(`templateLanding.slides.${useCase.bodyKey}`)}
              />
            ))}
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

      {/* FAQs */}
      <PageSection>
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
            style={{ gap: "3px" }}
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
