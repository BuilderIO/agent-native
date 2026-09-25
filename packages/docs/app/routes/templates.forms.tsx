import { useT } from "@agent-native/core/client/i18n";
import { IconArrowUpRight } from "@tabler/icons-react";
import type { MouseEvent } from "react";

import { firstPartyAppUrl } from "../components/deployment-links";
import { applyFirstTouchAttributionToLink } from "../components/marketing-attribution";
import { TemplateHero } from "../components/template-landing";
import { FormsProductMock } from "../components/template-landing/FormsProductMock";
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
        title: "Free AI Form Builder | Agent-Native Forms",
      },
      {
        name: "description",
        content:
          "Create forms and surveys with your AI agent, edit questions yourself, and share a public link. Forms is a free and open-source AI form builder with response insights.",
      },
      {
        property: "og:title",
        content: "Free AI Form Builder | Agent-Native Forms",
      },
      {
        property: "og:description",
        content:
          "Create forms and surveys with your AI agent, edit questions yourself, and share a public link. Forms is a free and open-source AI form builder with response insights.",
      },
      {
        name: "keywords",
        content:
          "AI form builder, Typeform alternative, open source Google Forms alternative, AI survey tool, AI form generator, agent-native forms, prompt to form, form automation, form integrations, customizable form builder",
      },
    ],
    "Forms",
  );

const template = templates.find((t) => t.slug === "forms")!;

// Same no-imagery pattern Slides uses: plain ContentCards, no `image`/
// `imageLabel`, so this section reads as one system with the key-features
// grid below it instead of leaving placeholder boxes.
const USE_CASES = [
  {
    id: "customer-feedback",
    titleKey: "useCase1Title",
    bodyKey: "useCase1Body",
    textLeft: true,
  },
  {
    id: "signups-and-registrations",
    titleKey: "useCase2Title",
    bodyKey: "useCase2Body",
    textLeft: false,
  },
  {
    id: "project-requests",
    titleKey: "useCase3Title",
    bodyKey: "useCase3Body",
    textLeft: true,
  },
] as const;

const KEY_FEATURES = [
  {
    id: "ai-form-generation",
    titleKey: "feature1Title",
    bodyKey: "feature1Body",
  },
  {
    id: "visual-field-editing",
    titleKey: "feature2Title",
    bodyKey: "feature2Body",
  },
  {
    id: "conditional-questions",
    titleKey: "feature3Title",
    bodyKey: "feature3Body",
  },
  {
    id: "public-form-links",
    titleKey: "feature4Title",
    bodyKey: "feature4Body",
  },
  {
    id: "response-insights-and-exports",
    titleKey: "feature5Title",
    bodyKey: "feature5Body",
  },
  {
    id: "submission-integrations",
    titleKey: "feature6Title",
    bodyKey: "feature6Body",
  },
] as const;

const FAQ_ITEMS = [
  { id: "what-is-forms", question: "question1", answer: "answer1" },
  { id: "edit-after-generation", question: "question2", answer: "answer2" },
  { id: "account-required", question: "question3", answer: "answer3" },
  { id: "anonymous-feedback", question: "question4", answer: "answer4" },
  {
    id: "sheets-slack-integration",
    question: "question5",
    answer: "answer5",
  },
] as const;

// TemplateHero assumes an ancestor centers it at max-w-site with zero extra
// gutter — TemplateLandingShell used to be that ancestor. Every PageSection
// below draws its grid lines flush to that same max-w-site edge, so this
// wrapper must match exactly (no px-* here) or the hero's border-x box ends
// up narrower than the rest of the page.
const HERO_WRAPPER_CLASS =
  "template-detail-page mx-auto w-full max-w-site overflow-x-clip";

export default function FormsTemplate() {
  const t = useT();

  return (
    <div className="builder-brand-tokens">
      {/* Hero — a builder recreation keeps the generated form and agent in one
          view, matching the product's visual and conversational workflows. */}
      <div className={HERO_WRAPPER_CLASS}>
        <TemplateHero
          title={
            <span className="block max-w-[520px]">
              {t("templateLanding.forms.heroTitle")}
            </span>
          }
          eyebrow={
            <span className="inline-flex items-center gap-2 text-[var(--fg)]">
              <LogoMark className="size-6" />
              <span className="font-sans text-[20px] font-bold tracking-tight">
                {t("templateLanding.forms.heroEyebrow")}
              </span>
              <AppStatusBadge appId="forms" />
            </span>
          }
          customizeTemplate={template}
          headingAction={
            <a
              href={firstPartyAppUrl("https://forms.agent-native.com")}
              target="_blank"
              rel="noopener noreferrer"
              className="primary-button"
              style={{ gap: "4px" }}
              onClick={(event) => {
                applyFirstTouchAttributionToLink(event.currentTarget);
                trackEvent("create form", {
                  template: template.slug,
                  location: "landing_page_hero",
                });
              }}
            >
              {t("templateLanding.forms.heroCta")}
              <IconArrowUpRight size={16} />
            </a>
          }
          description={<p>{t("templateLanding.forms.heroDescription")}</p>}
          descriptionPlacement="below-title"
          mediaOverlapsHeader
          media={
            <div className="mx-6 sm:mx-10">
              <FormsProductMock
                label={t("templateLanding.forms.s001")}
                className="h-[420px] sm:h-[620px] lg:h-[760px]"
              />
            </div>
          }
        />
      </div>

      {/* What can you do with Forms? — concrete form and response workflows */}
      <PageSection>
        <GridInner className="flex flex-col gap-[var(--spacing-6)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] pt-[var(--spacing-40)] pb-[var(--spacing-20)]">
          <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
            {t("templateLanding.forms.useCasesHeading")}
          </h2>
          <p className="m-0 max-w-[633px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
            {t("templateLanding.forms.useCasesBody")}
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
                    {t(`templateLanding.forms.${useCase.titleKey}`)}
                  </h3>
                  <p className="m-0 max-w-[420px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
                    {t(`templateLanding.forms.${useCase.bodyKey}`)}
                  </p>
                </div>
              );

              const variant =
                useCase.id === "customer-feedback"
                  ? "feedback"
                  : useCase.id === "signups-and-registrations"
                    ? "registration"
                    : "request";
              const mediaBlock = (
                <div
                  key="media"
                  className="order-2 flex items-center justify-center p-[var(--spacing-8)] lg:order-none lg:p-[var(--spacing-12)]"
                >
                  <FormsProductMock
                    variant={variant}
                    sidebarCollapsed
                    className="h-[300px] w-full max-w-[520px] lg:h-[390px] lg:max-w-none"
                    label={t(`templateLanding.forms.${useCase.titleKey}`)}
                  />
                </div>
              );

              return (
                <div
                  key={useCase.id}
                  className="grid border-t border-solid border-[var(--b-border-subtle)] bg-[var(--b-bg-page)] first:border-t-0 lg:grid-cols-[1fr_1.25fr]"
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
          and the Slides key-features grid, so both apps read as one system. */}
      <PageSection>
        <GridInner className="flex flex-col gap-[var(--spacing-6)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] pt-[var(--spacing-20)] pb-[var(--spacing-20)]">
          <p className="m-0 font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-1)] font-semibold uppercase tracking-[0.08em] text-[var(--b-text-secondary)]">
            {t("templateLanding.forms.keyFeaturesEyebrow")}
          </p>
          <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
            {t("templateLanding.forms.keyFeaturesHeading")}
          </h2>
        </GridInner>

        <GridInner>
          <div className="grid grid-cols-3 gap-px border border-solid border-[var(--b-border-subtle)] bg-[var(--b-border-subtle)] mobile:grid-cols-2 narrow:grid-cols-1">
            {KEY_FEATURES.map((feature) => (
              <ContentCard
                key={feature.id}
                title={t(`templateLanding.forms.${feature.titleKey}`)}
                body={t(`templateLanding.forms.${feature.bodyKey}`)}
              />
            ))}
          </div>
        </GridInner>
      </PageSection>

      {/* FAQs — Slides gets this section's pt-20 rhythm directly here (no
          intervening section), so match that instead of landing the FAQ
          flush against the feature grid above it. */}
      <PageSection>
        <GridInner className="border-t border-solid border-[var(--b-border-default)] pt-[var(--spacing-20)]">
          <FaqAccordion
            idPrefix="forms-faq"
            eyebrow={t("templateLanding.faq.eyebrow")}
            title={t("templateLanding.faq.title")}
            items={FAQ_ITEMS.map((item) => ({
              id: item.id,
              question: t(`templateLanding.forms.faq.${item.question}`),
              answer: (
                <p className="m-0">
                  {t(`templateLanding.forms.faq.${item.answer}`)}
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
            {t("templateLanding.forms.finalCtaHeading")}
          </h2>
          <p className="m-0 max-w-[560px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
            {t("templateLanding.forms.finalCtaBody")}
          </p>
          <Button
            variant="cta"
            href={firstPartyAppUrl("https://forms.agent-native.com")}
            target="_blank"
            rel="noopener noreferrer"
            // The shared cta variant renders at 14px in sentence case, but
            // the hero's .primary-button (uppercase 12px mono, via the
            // .template-detail-page CSS rule) only applies inside the hero
            // wrapper. Match it explicitly here so both CTAs on the page
            // read as the same button style.
            style={{ gap: "3px", fontSize: "12px", textTransform: "uppercase" }}
            onClick={(event: MouseEvent<HTMLAnchorElement>) => {
              applyFirstTouchAttributionToLink(event.currentTarget);
              trackEvent("create form", {
                template: template.slug,
                location: "landing_page_final_cta",
              });
            }}
          >
            {t("templateLanding.forms.finalCtaButton")}
          </Button>
        </GridInner>
      </PageSection>
    </div>
  );
}
