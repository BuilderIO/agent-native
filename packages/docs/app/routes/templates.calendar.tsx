import { useT } from "@agent-native/core/client/i18n";
import { IconArrowUpRight } from "@tabler/icons-react";
import type { MouseEvent } from "react";

import { firstPartyAppUrl } from "../components/deployment-links";
import { applyFirstTouchAttributionToLink } from "../components/marketing-attribution";
import { TemplateHero } from "../components/template-landing";
import {
  CalendarLandingMock,
  CalendarLandingMockStyles,
} from "../components/template-landing/CalendarLandingMock";
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
        title: "Free AI Scheduling Assistant | Agent-Native Calendar",
      },
      {
        name: "description",
        content:
          "Manage Google Calendar with your AI agent. Find meeting times, reschedule events, and share booking links with Calendar, a free and open-source scheduling app.",
      },
      {
        property: "og:title",
        content: "Free AI Scheduling Assistant | Agent-Native Calendar",
      },
      {
        property: "og:description",
        content:
          "Manage Google Calendar with your AI agent. Find meeting times, reschedule events, and share booking links with Calendar, a free and open-source scheduling app.",
      },
      {
        name: "keywords",
        content:
          "AI calendar, open source calendar, Google Calendar alternative, Calendly alternative, AI scheduling assistant, agent-native calendar, AI booking page, natural language scheduling",
      },
    ],
    "Calendar",
  );

const template = templates.find((t) => t.slug === "calendar")!;

const USE_CASES = [
  {
    id: "book-client-calls-and-demos",
    mode: "booking",
    textLeft: true,
    titleKey: "useCase1Title",
    bodyKey: "useCase1Body",
  },
  {
    id: "find-time-for-team-meetings",
    mode: "team",
    textLeft: false,
    titleKey: "useCase2Title",
    bodyKey: "useCase2Body",
  },
  {
    id: "adjust-your-day",
    mode: "reschedule",
    textLeft: true,
    titleKey: "useCase3Title",
    bodyKey: "useCase3Body",
  },
] as const;

const KEY_FEATURES = [
  { id: "ai-scheduling", titleKey: "feature1Title", bodyKey: "feature1Body" },
  {
    id: "multiple-calendar-accounts",
    titleKey: "feature2Title",
    bodyKey: "feature2Body",
  },
  {
    id: "customizable-booking-links",
    titleKey: "feature3Title",
    bodyKey: "feature3Body",
  },
  {
    id: "availability-controls",
    titleKey: "feature4Title",
    bodyKey: "feature4Body",
  },
  {
    id: "co-host-scheduling",
    titleKey: "feature5Title",
    bodyKey: "feature5Body",
  },
  {
    id: "video-meeting-links",
    titleKey: "feature6Title",
    bodyKey: "feature6Body",
  },
] as const;

const FAQ_ITEMS = [
  { id: "what-is-calendar", question: "question1", answer: "answer1" },
  {
    id: "which-calendars-can-connect",
    question: "question2",
    answer: "answer2",
  },
  { id: "what-can-the-agent-do", question: "question3", answer: "answer3" },
  { id: "booking-without-account", question: "question4", answer: "answer4" },
  { id: "multi-host-availability", question: "question5", answer: "answer5" },
] as const;

// TemplateHero assumes an ancestor centers it at max-w-site with zero extra
// gutter — TemplateLandingShell used to be that ancestor. Every PageSection
// below draws its grid lines flush to that same max-w-site edge, so this
// wrapper must match exactly (no px-* here) or the hero's border-x box ends
// up narrower than the rest of the page.
const HERO_WRAPPER_CLASS =
  "template-detail-page mx-auto w-full max-w-site overflow-x-clip";

export default function CalendarTemplate() {
  const t = useT();

  return (
    <div className="builder-brand-tokens">
      <CalendarLandingMockStyles />
      {/* The hero pairs the real week-calendar surface with its contextual
          scheduling assistant. */}
      <div className={HERO_WRAPPER_CLASS}>
        <TemplateHero
          title={
            <span className="block max-w-[520px]">
              {t("templateLanding.calendar.heroTitle")}
            </span>
          }
          eyebrow={
            <span className="inline-flex items-center gap-2 text-[var(--fg)]">
              <LogoMark className="size-6" />
              <span className="font-sans text-[20px] font-bold tracking-tight">
                {t("templateLanding.calendar.heroEyebrow")}
              </span>
              <AppStatusBadge appId="calendar" />
            </span>
          }
          customizeTemplate={template}
          headingAction={
            <a
              href={firstPartyAppUrl("https://calendar.agent-native.com")}
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
              {t("templateLanding.calendar.heroCta")}
              <IconArrowUpRight size={16} />
            </a>
          }
          description={<p>{t("templateLanding.calendar.heroDescription")}</p>}
          descriptionPlacement="below-title"
          mediaOverlapsHeader
          media={
            <CalendarLandingMock
              mode="week"
              label={t("templateLanding.calendar.s001")}
              className="h-[420px] sm:h-[620px] lg:h-[800px]"
            />
          }
        />
      </div>

      {/* Use-case stories pair the existing translated copy with a concrete
          Calendar surface. */}
      <PageSection>
        <GridInner className="flex flex-col gap-[var(--spacing-6)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] pt-[var(--spacing-40)] pb-[var(--spacing-20)]">
          <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
            {t("templateLanding.calendar.useCasesHeading")}
          </h2>
          <p className="m-0 max-w-[633px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
            {t("templateLanding.calendar.useCasesBody")}
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
                    {t(`templateLanding.calendar.${useCase.titleKey}`)}
                  </h3>
                  <p className="m-0 max-w-[420px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
                    {t(`templateLanding.calendar.${useCase.bodyKey}`)}
                  </p>
                </div>
              );
              const mediaBlock = (
                <div
                  key="media"
                  className="order-2 flex items-center justify-center p-[var(--spacing-8)] lg:order-none lg:p-[var(--spacing-12)]"
                >
                  <CalendarLandingMock
                    mode={useCase.mode}
                    label={t(`templateLanding.calendar.${useCase.titleKey}`)}
                    className="h-[290px] min-h-[290px] w-full"
                    showSidebar={false}
                    showAgent={false}
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
          and the Slides/Clips key-features grids, so all three apps read as
          one system. */}
      <PageSection>
        <GridInner className="flex flex-col gap-[var(--spacing-6)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] pt-[var(--spacing-20)] pb-[var(--spacing-20)]">
          <p className="m-0 font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-1)] font-semibold uppercase tracking-[0.08em] text-[var(--b-text-secondary)]">
            {t("templateLanding.calendar.keyFeaturesEyebrow")}
          </p>
          <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
            {t("templateLanding.calendar.keyFeaturesHeading")}
          </h2>
        </GridInner>

        <GridInner>
          <div className="grid grid-cols-3 gap-px border border-solid border-[var(--b-border-subtle)] bg-[var(--b-border-subtle)] mobile:grid-cols-2 narrow:grid-cols-1">
            {KEY_FEATURES.map((feature) => (
              <ContentCard
                key={feature.id}
                title={t(`templateLanding.calendar.${feature.titleKey}`)}
                body={t(`templateLanding.calendar.${feature.bodyKey}`)}
              />
            ))}
          </div>
        </GridInner>
      </PageSection>

      {/* FAQs — Clips gets this section's breathing room for free from its
          "See Clips in action" section in between; Calendar has no such
          section, so add the same pt-20 rhythm directly here instead of
          landing the FAQ flush against the feature grid above it. */}
      <PageSection>
        <GridInner className="border-t border-solid border-[var(--b-border-default)] pt-[var(--spacing-20)]">
          <FaqAccordion
            idPrefix="calendar-faq"
            eyebrow={t("templateLanding.faq.eyebrow")}
            title={t("templateLanding.faq.title")}
            items={FAQ_ITEMS.map((item) => ({
              id: item.id,
              question: t(`templateLanding.calendar.faq.${item.question}`),
              answer: (
                <p className="m-0">
                  {t(`templateLanding.calendar.faq.${item.answer}`)}
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
            {t("templateLanding.calendar.finalCtaHeading")}
          </h2>
          <p className="m-0 max-w-[560px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
            {t("templateLanding.calendar.finalCtaBody")}
          </p>
          <Button
            variant="cta"
            href={firstPartyAppUrl("https://calendar.agent-native.com")}
            target="_blank"
            rel="noopener noreferrer"
            // The shared cta variant renders at 14px in sentence case, but
            // the hero's .primary-button (uppercase 12px mono, via the
            // .template-detail-page CSS rule) only applies inside the hero
            // wrapper. Match it explicitly here so both CTAs on the page
            // read as the same button style.
            style={{
              gap: "3px",
              fontSize: "12px",
              textTransform: "uppercase",
            }}
            onClick={(event: MouseEvent<HTMLAnchorElement>) => {
              applyFirstTouchAttributionToLink(event.currentTarget);
              trackEvent("try live demo", {
                template: template.slug,
                location: "landing_page_final_cta",
              });
            }}
          >
            {t("templateLanding.calendar.finalCtaButton")}
          </Button>
        </GridInner>
      </PageSection>
    </div>
  );
}
