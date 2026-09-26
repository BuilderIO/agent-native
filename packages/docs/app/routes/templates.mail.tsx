import { useT } from "@agent-native/core/client/i18n";
import { IconArrowUpRight } from "@tabler/icons-react";
import { useRef, type MouseEvent } from "react";

import { firstPartyAppUrl } from "../components/deployment-links";
import { applyFirstTouchAttributionToLink } from "../components/marketing-attribution";
import { TemplateHero } from "../components/template-landing";
import { MailProductMock } from "../components/template-landing/MailProductMock";
import { templates, trackEvent } from "../components/TemplateCard";
import { usePrefersReducedMotion } from "../components/use-prefers-reduced-motion";
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
        title: "Free AI Email Assistant for Gmail | Agent-Native Mail",
      },
      {
        name: "description",
        content:
          "Search Gmail, summarize threads, draft replies, and organize your inbox with your AI agent. Mail is a free and open-source email client for multiple Gmail accounts.",
      },
      {
        property: "og:title",
        content: "Free AI Email Assistant for Gmail | Agent-Native Mail",
      },
      {
        property: "og:description",
        content:
          "Search Gmail, summarize threads, draft replies, and organize your inbox with your AI agent. Mail is a free and open-source email client for multiple Gmail accounts.",
      },
      {
        name: "keywords",
        content:
          "AI email assistant, Gmail AI agent, open source email client, Gmail alternative, AI email drafting, inbox automation, multi-account Gmail search, agent-native mail, AI thread summaries, keyboard shortcuts email",
      },
    ],
    "Mail",
  );

const template = templates.find((t) => t.slug === "mail")!;

const USE_CASES = [
  {
    id: "priority-sorting",
    variant: "jev",
    titleKey: "useCase1Title",
    bodyKey: "useCase1Body",
    textLeft: true,
  },
  {
    id: "ai-labeling",
    variant: "labels",
    titleKey: "useCase2Title",
    bodyKey: "useCase2Body",
    textLeft: false,
  },
  {
    id: "background-automations",
    variant: "automations",
    titleKey: "useCase3Title",
    bodyKey: "useCase3Body",
    textLeft: true,
  },
] as const;

const KEY_FEATURES = [
  {
    id: "ai-thread-summaries",
    titleKey: "feature1Title",
    bodyKey: "feature1Body",
  },
  {
    id: "ai-email-drafting",
    titleKey: "feature2Title",
    bodyKey: "feature2Body",
  },
  {
    id: "multi-account-search",
    titleKey: "feature3Title",
    bodyKey: "feature3Body",
  },
  {
    id: "inbox-automations",
    titleKey: "feature4Title",
    bodyKey: "feature4Body",
  },
  {
    id: "keyboard-shortcuts",
    titleKey: "feature5Title",
    bodyKey: "feature5Body",
  },
  {
    id: "ai-spam-filter",
    titleKey: "feature6Title",
    bodyKey: "feature6Body",
  },
] as const;

const FAQ_ITEMS = [
  { id: "what-is-mail", question: "question1", answer: "answer1" },
  { id: "existing-gmail-account", question: "question2", answer: "answer2" },
  { id: "send-without-approval", question: "question3", answer: "answer3" },
  { id: "auto-organize-inbox", question: "question4", answer: "answer4" },
  { id: "teammate-prepare-email", question: "question5", answer: "answer5" },
] as const;

// TemplateHero assumes an ancestor centers it at max-w-site with zero extra
// gutter — TemplateLandingShell used to be that ancestor. Every PageSection
// below draws its grid lines flush to that same max-w-site edge, so this
// wrapper must match exactly (no px-* here) or the hero's border-x box ends
// up narrower than the rest of the page.
const HERO_WRAPPER_CLASS =
  "template-detail-page mx-auto w-full max-w-site overflow-x-clip";

export default function MailTemplate() {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const prefersReducedMotion = usePrefersReducedMotion(videoRef);
  const shouldAutoplay = prefersReducedMotion === false;

  return (
    <div className="builder-brand-tokens">
      {/* Lead with Jev's inbox cleanup story, then show the recreated app below. */}
      <div className={HERO_WRAPPER_CLASS}>
        <TemplateHero
          title={t("templateLanding.mail.heroTitle")}
          eyebrow={
            <span className="inline-flex items-center gap-2 text-[var(--fg)]">
              <LogoMark className="size-6" />
              <span className="font-sans text-[20px] font-bold tracking-tight">
                {t("templateLanding.mail.heroEyebrow")}
              </span>
              <AppStatusBadge appId="mail" />
            </span>
          }
          customizeTemplate={template}
          headingAction={
            <a
              href={firstPartyAppUrl("https://mail.agent-native.com")}
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
              {t("templateLanding.mail.heroCta")}
              <IconArrowUpRight size={16} />
            </a>
          }
          description={<p>{t("templateLanding.mail.heroDescription")}</p>}
          descriptionPlacement="below-title"
          mediaOverlapsHeader
          media={
            <div className="mx-6 sm:mx-10">
              <div className="aspect-video overflow-hidden rounded-2xl border border-[var(--docs-border)] bg-black">
                <video
                  ref={videoRef}
                  src="/videos/mail-jev-story.mp4"
                  poster="/videos/mail-jev-story-poster.jpg"
                  aria-label={t("templateLanding.mail.heroDescription")}
                  autoPlay={shouldAutoplay}
                  muted
                  loop
                  playsInline
                  controls
                  preload="metadata"
                  className="block h-full w-full object-cover"
                />
              </div>
            </div>
          }
        />
      </div>

      {/* What can you do with Mail? — inbox, reply, and triage workflows */}
      <PageSection>
        <GridInner className="flex flex-col gap-[var(--spacing-6)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] pt-[var(--spacing-40)] pb-[var(--spacing-20)]">
          <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
            {t("templateLanding.mail.useCasesHeading")}
          </h2>
          <p className="m-0 max-w-[633px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
            {t("templateLanding.mail.useCasesBody")}
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
                    {t(`templateLanding.mail.${useCase.titleKey}`)}
                  </h3>
                  <p className="m-0 max-w-[420px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
                    {t(`templateLanding.mail.${useCase.bodyKey}`)}
                  </p>
                </div>
              );

              const mediaBlock = (
                <div
                  key="media"
                  className="order-2 flex items-center justify-center p-[var(--spacing-8)] lg:order-none lg:p-[var(--spacing-12)]"
                >
                  <MailProductMock
                    variant={useCase.variant}
                    className={
                      useCase.variant === "jev"
                        ? "h-[380px] w-full max-w-[540px] lg:h-[480px] lg:max-w-none mm-jev-art"
                        : "h-[300px] w-full max-w-[540px] lg:h-[390px] lg:max-w-none"
                    }
                    label={t(`templateLanding.mail.${useCase.titleKey}`)}
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
          and the Slides/Clips key-features grid, so all three apps read as
          one system. */}
      <PageSection>
        <GridInner className="flex flex-col gap-[var(--spacing-6)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] pt-[var(--spacing-20)] pb-[var(--spacing-20)]">
          <p className="m-0 font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-1)] font-semibold uppercase tracking-[0.08em] text-[var(--b-text-secondary)]">
            {t("templateLanding.mail.keyFeaturesEyebrow")}
          </p>
          <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
            {t("templateLanding.mail.keyFeaturesHeading")}
          </h2>
        </GridInner>

        <GridInner>
          <div className="grid grid-cols-3 gap-px border border-solid border-[var(--b-border-subtle)] bg-[var(--b-border-subtle)] mobile:grid-cols-2 narrow:grid-cols-1">
            {KEY_FEATURES.map((feature) => (
              <ContentCard
                key={feature.id}
                title={t(`templateLanding.mail.${feature.titleKey}`)}
                body={t(`templateLanding.mail.${feature.bodyKey}`)}
              />
            ))}
          </div>
        </GridInner>
      </PageSection>

      {/* FAQs — Mail has no "see it in action" section in between, so add the
          same pt-20 rhythm directly here instead of landing the FAQ flush
          against the feature grid above it. */}
      <PageSection>
        <GridInner className="border-t border-solid border-[var(--b-border-default)] pt-[var(--spacing-20)]">
          <FaqAccordion
            idPrefix="mail-faq"
            eyebrow={t("templateLanding.faq.eyebrow")}
            title={t("templateLanding.faq.title")}
            items={FAQ_ITEMS.map((item) => ({
              id: item.id,
              question: t(`templateLanding.mail.faq.${item.question}`),
              answer: (
                <p className="m-0">
                  {t(`templateLanding.mail.faq.${item.answer}`)}
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
            {t("templateLanding.mail.finalCtaHeading")}
          </h2>
          <p className="m-0 max-w-[560px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
            {t("templateLanding.mail.finalCtaBody")}
          </p>
          <Button
            variant="cta"
            href={firstPartyAppUrl("https://mail.agent-native.com")}
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
            {t("templateLanding.mail.finalCtaButton")}
          </Button>
        </GridInner>
      </PageSection>
    </div>
  );
}
