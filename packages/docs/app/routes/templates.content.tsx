import { useT } from "@agent-native/core/client/i18n";
import { IconArrowUpRight } from "@tabler/icons-react";
import type { MouseEvent } from "react";

import { BuilderImage } from "../components/builder-image";
import { firstPartyAppUrl } from "../components/deployment-links";
import { applyFirstTouchAttributionToLink } from "../components/marketing-attribution";
import { TemplateHero } from "../components/template-landing";
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

// Same no-imagery pattern Slides and Clips used before their use-case mocks
// existed: plain ContentCards, no `image`/`imageLabel`, so the section reads
// as one system with the key-features grid below it instead of leaving
// placeholder boxes.
const USE_CASES = [
  {
    id: "write-and-review-content",
    titleKey: "useCase1Title",
    bodyKey: "useCase1Body",
  },
  {
    id: "track-work-with-agents",
    titleKey: "useCase2Title",
    bodyKey: "useCase2Body",
  },
  {
    id: "collect-project-requests",
    titleKey: "useCase3Title",
    bodyKey: "useCase3Body",
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

// TemplateHero assumes an ancestor centers it at max-w-site with zero extra
// gutter — TemplateLandingShell used to be that ancestor. Every PageSection
// below draws its grid lines flush to that same max-w-site edge, so this
// wrapper must match exactly (no px-* here) or the hero's border-x box ends
// up narrower than the rest of the page.
const HERO_WRAPPER_CLASS =
  "template-detail-page mx-auto w-full max-w-site overflow-x-clip";

export default function ContentTemplate() {
  const t = useT();

  return (
    <div className="builder-brand-tokens">
      {/* Hero — copy and layout updated to match Slides; existing hero
          screenshot kept since there's no newer Content asset yet. */}
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
            <BuilderImage
              src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F68b5bbef2877492486232130fd297ecb"
              crossOrigin="anonymous"
              alt={t("templateLanding.content.s001")}
              loading="lazy"
              decoding="async"
              className="h-auto max-h-[640px] w-full object-cover object-top"
            />
          }
        />
      </div>

      {/* What can you do with Content? — three use-case cards */}
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
          <div className="grid grid-cols-3 gap-px border border-solid border-[var(--b-border-subtle)] bg-[var(--b-border-subtle)] mobile:grid-cols-1">
            {USE_CASES.map((useCase) => (
              <ContentCard
                key={useCase.id}
                title={t(`templateLanding.content.${useCase.titleKey}`)}
                body={t(`templateLanding.content.${useCase.bodyKey}`)}
              />
            ))}
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
            // The shared cta variant renders at 14px in sentence case, but
            // the hero's .primary-button (uppercase 12px mono, via the
            // .template-detail-page CSS rule) only applies inside the hero
            // wrapper. Match it explicitly here so both CTAs on the page
            // read as the same button style.
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
