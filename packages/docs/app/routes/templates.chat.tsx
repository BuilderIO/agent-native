import { useLocale, useT } from "@agent-native/core/client/i18n";
import { IconArrowUpRight } from "@tabler/icons-react";
import type { MouseEvent } from "react";
import { Link } from "react-router";

import { BuilderImage } from "../components/builder-image";
import { CustomizeTemplatePopover } from "../components/CustomizeTemplatePopover";
import { firstPartyAppUrl } from "../components/deployment-links";
import { sitePathForLocale } from "../components/docs-locale";
import { applyFirstTouchAttributionToLink } from "../components/marketing-attribution";
import { TemplateHero } from "../components/template-landing";
import { templates, trackEvent } from "../components/TemplateCard";
import { Button } from "../components/website-redesign/ds/button";
import { CodeBlock } from "../components/website-redesign/ds/code-block";
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
        title: "Free AI Chat App Starter | Agent-Native Chat",
      },
      {
        name: "description",
        content:
          "Build an AI chat app with saved conversations, authentication, shared actions, and live sync. Chat is a free and open-source starter you can extend with your own tools.",
      },
      {
        property: "og:title",
        content: "Free AI Chat App Starter | Agent-Native Chat",
      },
      {
        property: "og:description",
        content:
          "Build an AI chat app with saved conversations, authentication, shared actions, and live sync. Chat is a free and open-source starter you can extend with your own tools.",
      },
    ],
    "Chat",
  );

const template = templates.find((t) => t.slug === "chat")!;

// Reuses the generic template page's hero screenshot -- there's no dedicated
// Chat asset yet. Keep this in sync with `templates.$slug.tsx` if a real
// screenshot ever replaces it there (the generic page's copy no longer needs
// its own entry once this dedicated page exists, so it was removed from
// `genericHeroScreenshots`).
const HERO_IMAGE_SRC =
  "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fc6afb337a30240e19f1e0523aaef6865";

// Literal shell command, not translated copy -- kept out of i18n so no
// locale catalog can drift from the real CLI invocation.
const INSTALL_COMMAND =
  "npx @agent-native/core@latest create my-app --standalone --template chat";

const USE_CASES = [
  {
    id: "internal-assistant",
    titleKey: "useCase1Title",
    bodyKey: "useCase1Body",
  },
  {
    id: "prototype-agent-workflow",
    titleKey: "useCase2Title",
    bodyKey: "useCase2Body",
  },
  {
    id: "interface-for-agent-work",
    titleKey: "useCase3Title",
    bodyKey: "useCase3Body",
  },
] as const;

const KEY_FEATURES = [
  {
    id: "saved-conversations",
    titleKey: "feature1Title",
    bodyKey: "feature1Body",
  },
  {
    id: "built-in-agent-chat",
    titleKey: "feature2Title",
    bodyKey: "feature2Body",
  },
  {
    id: "authentication-and-sessions",
    titleKey: "feature3Title",
    bodyKey: "feature3Body",
  },
  { id: "shared-actions", titleKey: "feature4Title", bodyKey: "feature4Body" },
  { id: "live-data-sync", titleKey: "feature5Title", bodyKey: "feature5Body" },
  {
    id: "database-and-run-inspection",
    titleKey: "feature6Title",
    bodyKey: "feature6Body",
  },
] as const;

const FAQ_ITEMS = [
  { id: "what-is-chat", question: "question1", answer: "answer1" },
  { id: "is-chat-finished", question: "question2", answer: "answer2" },
  { id: "add-screens", question: "question3", answer: "answer3" },
  { id: "business-tool-connections", question: "question4", answer: "answer4" },
  { id: "customize-and-deploy", question: "question5", answer: "answer5" },
] as const;

// TemplateHero assumes an ancestor centers it at max-w-site with zero extra
// gutter -- TemplateLandingShell used to be that ancestor. Every PageSection
// below draws its grid lines flush to that same max-w-site edge, so this
// wrapper must match exactly (no px-* here) or the hero's border-x box ends
// up narrower than the rest of the page.
const HERO_WRAPPER_CLASS =
  "template-detail-page mx-auto w-full max-w-site overflow-x-clip";

export default function ChatTemplate() {
  const t = useT();
  const { locale } = useLocale();
  const docsHref = sitePathForLocale("/docs/template-chat", locale);

  return (
    <div className="builder-brand-tokens">
      {/* Hero -- three actions instead of Slides' single CTA: a primary link
          into the setup guide, a copyable scaffold command, and a secondary
          link to the hosted demo. Stacked in a column so the code block
          doesn't fight the buttons for a single row inside the hero grid. */}
      <div className={HERO_WRAPPER_CLASS}>
        <TemplateHero
          title={
            <span className="block max-w-[520px]">
              {t("templateLanding.chat.heroTitle")}
            </span>
          }
          eyebrow={
            <span className="inline-flex items-center gap-2 text-[var(--fg)]">
              <LogoMark className="size-6" />
              <span className="font-sans text-2xl font-bold tracking-tight">
                {t("templateLanding.chat.heroEyebrow")}
              </span>
            </span>
          }
          headingAction={
            <div className="flex flex-col items-start gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  data-an-prefetch="viewport"
                  to={docsHref}
                  className="primary-button"
                  style={{ gap: "4px" }}
                  onClick={() =>
                    trackEvent("build your app", {
                      template: template.slug,
                      location: "landing_page_hero",
                    })
                  }
                >
                  {t("templateLanding.chat.heroCta")}
                  <IconArrowUpRight size={16} />
                </Link>
                <a
                  href={firstPartyAppUrl(template.demoUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="secondary-button"
                  onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                    applyFirstTouchAttributionToLink(event.currentTarget);
                    trackEvent("open hosted demo", {
                      template: template.slug,
                      location: "landing_page_hero",
                    });
                  }}
                >
                  {t("templateLanding.chat.heroSecondaryCta")}
                </a>
                {/* Rendered inline with the button row instead of via
                    TemplateHero's `customizeTemplate` prop -- that prop places
                    the popover as a flex-wrap sibling of the whole
                    `headingAction` block, which here is a two-row stack
                    (buttons + code block), so it would vertically center
                    against the tall stack instead of sitting next to the
                    buttons. */}
                <CustomizeTemplatePopover template={template} />
              </div>
              <div className="w-full max-w-[420px]">
                <CodeBlock code={INSTALL_COMMAND} language="bash" />
              </div>
            </div>
          }
          description={<p>{t("templateLanding.chat.heroDescription")}</p>}
          descriptionPlacement="below-title"
          mediaOverlapsHeader
          media={
            <BuilderImage
              src={HERO_IMAGE_SRC}
              crossOrigin="anonymous"
              alt={t("templateLanding.chat.s001")}
              loading="lazy"
              decoding="async"
              className="h-auto max-h-[640px] w-full object-cover object-top"
            />
          }
        />
      </div>

      {/* What can you build with Chat? -- three use-case cards */}
      <PageSection>
        <GridInner className="flex flex-col gap-[var(--spacing-6)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] pt-[var(--spacing-40)] pb-[var(--spacing-20)]">
          <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
            {t("templateLanding.chat.useCasesHeading")}
          </h2>
          <p className="m-0 max-w-[633px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
            {t("templateLanding.chat.useCasesBody")}
          </p>
        </GridInner>

        <GridInner>
          <div className="grid grid-cols-3 gap-px border border-solid border-[var(--b-border-subtle)] bg-[var(--b-border-subtle)] mobile:grid-cols-1">
            {USE_CASES.map((useCase) => (
              <ContentCard
                key={useCase.id}
                title={t(`templateLanding.chat.${useCase.titleKey}`)}
                body={t(`templateLanding.chat.${useCase.bodyKey}`)}
              />
            ))}
          </div>
        </GridInner>
      </PageSection>

      {/* Key features -- six cards, same layout as builder.io/platform/code
          and the Slides/Clips key-features grids, so every app reads as one
          system. */}
      <PageSection>
        <GridInner className="flex flex-col gap-[var(--spacing-6)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] pt-[var(--spacing-20)] pb-[var(--spacing-20)]">
          <p className="m-0 font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-1)] font-semibold uppercase tracking-[0.08em] text-[var(--b-text-secondary)]">
            {t("templateLanding.chat.keyFeaturesEyebrow")}
          </p>
          <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
            {t("templateLanding.chat.keyFeaturesHeading")}
          </h2>
        </GridInner>

        <GridInner>
          <div className="grid grid-cols-3 gap-px border border-solid border-[var(--b-border-subtle)] bg-[var(--b-border-subtle)] mobile:grid-cols-2 narrow:grid-cols-1">
            {KEY_FEATURES.map((feature) => (
              <ContentCard
                key={feature.id}
                title={t(`templateLanding.chat.${feature.titleKey}`)}
                body={t(`templateLanding.chat.${feature.bodyKey}`)}
              />
            ))}
          </div>
        </GridInner>
      </PageSection>

      {/* FAQs -- Slides has no section between the feature grid and its FAQ
          either, so carry the same pt-20 rhythm directly here. */}
      <PageSection>
        <GridInner className="border-t border-solid border-[var(--b-border-default)] pt-[var(--spacing-20)]">
          <FaqAccordion
            idPrefix="chat-faq"
            eyebrow={t("templateLanding.faq.eyebrow")}
            title={t("templateLanding.faq.title")}
            items={FAQ_ITEMS.map((item) => ({
              id: item.id,
              question: t(`templateLanding.chat.faq.${item.question}`),
              answer: (
                <p className="m-0">
                  {t(`templateLanding.chat.faq.${item.answer}`)}
                </p>
              ),
            }))}
          />
        </GridInner>
      </PageSection>

      {/* Final CTA -- repeats the primary "Build your app" link only, no
          code block. */}
      <PageSection>
        <GridInner className="flex flex-col items-center gap-[var(--spacing-6)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] py-[var(--spacing-40)] text-center">
          <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
            {t("templateLanding.chat.finalCtaHeading")}
          </h2>
          <p className="m-0 max-w-[560px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
            {t("templateLanding.chat.finalCtaBody")}
          </p>
          <Button
            variant="cta"
            href={docsHref}
            // The shared cta variant renders at 14px in sentence case, but
            // the hero's .primary-button (uppercase 12px mono, via the
            // .template-detail-page CSS rule) only applies inside the hero
            // wrapper. Match it explicitly here so both CTAs on the page
            // read as the same button style.
            style={{ gap: "3px", fontSize: "12px", textTransform: "uppercase" }}
            onClick={() =>
              trackEvent("build your app", {
                template: template.slug,
                location: "landing_page_final_cta",
              })
            }
          >
            {t("templateLanding.chat.finalCtaButton")}
          </Button>
        </GridInner>
      </PageSection>
    </div>
  );
}
