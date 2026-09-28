import { useLocale, useT } from "@agent-native/core/client/i18n";
import type { LEGACY_TRACKING_EVENT_NAME_ALIASES } from "@agent-native/core/shared";
import { IconArrowUpRight } from "@tabler/icons-react";
import type { MouseEvent } from "react";

import { firstPartyAppUrl } from "../components/deployment-links";
import { sitePathForLocale } from "../components/docs-locale";
import { applyFirstTouchAttributionToLink } from "../components/marketing-attribution";
import { TemplateHero } from "../components/template-landing";
import { ChatLandingMock } from "../components/template-landing/ChatLandingMock";
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
const HOSTED_DEMO_EVENT =
  "open hosted demo" satisfies keyof typeof LEGACY_TRACKING_EVENT_NAME_ALIASES;

const USE_CASES = [
  {
    id: "internal-assistant",
    titleKey: "useCase1Title",
    bodyKey: "useCase1Body",
    textLeft: true,
  },
  {
    id: "prototype-agent-workflow",
    titleKey: "useCase2Title",
    bodyKey: "useCase2Body",
    textLeft: false,
  },
  {
    id: "interface-for-agent-work",
    titleKey: "useCase3Title",
    bodyKey: "useCase3Body",
    textLeft: true,
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

const HERO_WRAPPER_CLASS =
  "template-detail-page mx-auto w-full max-w-site overflow-x-clip";

export default function ChatTemplate() {
  const t = useT();
  const { locale } = useLocale();
  const docsHref = sitePathForLocale("/docs/template-chat", locale);

  return (
    <div className="builder-brand-tokens">
      {/* Hero */}
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
              <span className="font-sans text-[20px] font-bold tracking-tight">
                {t("templateLanding.chat.heroEyebrow")}
              </span>
              <AppStatusBadge appId="chat" />
            </span>
          }
          customizeTemplate={template}
          headingAction={
            <a
              href={firstPartyAppUrl(template.demoUrl)}
              target="_blank"
              rel="noopener noreferrer"
              className="primary-button"
              style={{ gap: "4px" }}
              onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                applyFirstTouchAttributionToLink(event.currentTarget);
                trackEvent(HOSTED_DEMO_EVENT, {
                  template: template.slug,
                  location: "landing_page_hero",
                });
              }}
            >
              {t("templateLanding.chat.heroSecondaryCta")}
              <IconArrowUpRight size={16} />
            </a>
          }
          description={<p>{t("templateLanding.chat.heroDescription")}</p>}
          descriptionPlacement="below-title"
          mediaOverlapsHeader
          media={
            <ChatLandingMock
              label={t("templateLanding.chat.s001")}
              className="h-[360px] sm:h-[520px] lg:h-[640px]"
            />
          }
        />
      </div>

      {/* Three concrete starting workflows */}
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
          <div className="flex flex-col border-t border-x border-solid border-[var(--b-border-subtle)]">
            {USE_CASES.map((useCase) => {
              const textBlock = (
                <div
                  key="text"
                  className="order-1 flex flex-col justify-center gap-[var(--spacing-3)] p-[var(--spacing-8)] lg:order-none lg:p-[var(--spacing-12)]"
                >
                  <h3 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-4)] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--b-text-primary)]">
                    {t(`templateLanding.chat.${useCase.titleKey}`)}
                  </h3>
                  <p className="m-0 max-w-[420px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
                    {t(`templateLanding.chat.${useCase.bodyKey}`)}
                  </p>
                </div>
              );
              const mediaBlock = (
                <div
                  key="media"
                  className="order-2 flex items-center justify-center p-[var(--spacing-8)] lg:order-none lg:p-[var(--spacing-12)]"
                >
                  <ChatLandingMock
                    variant={useCase.id}
                    label={t(`templateLanding.chat.${useCase.titleKey}`)}
                    sidebarCollapsed
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

      {/* Build CTA keeps the starter guide available after the live preview. */}
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
