import { useT } from "@agent-native/core/client/i18n";
import { IconArrowUpRight } from "@tabler/icons-react";
import type { MouseEvent } from "react";

import { firstPartyAppUrl } from "../components/deployment-links";
import { applyFirstTouchAttributionToLink } from "../components/marketing-attribution";
import { TemplateHero } from "../components/template-landing";
import { ClipsActOnFeedbackMock } from "../components/template-landing/ClipsActOnFeedbackMock";
import { ClipsLibraryMock } from "../components/template-landing/ClipsLibraryMock";
import { templates, trackEvent } from "../components/TemplateCard";
import { Button } from "../components/website-redesign/ds/button";
import { ContentCard } from "../components/website-redesign/ds/content-card";
import { FaqAccordion } from "../components/website-redesign/ds/faq-accordion";
import { ImgPlaceholder } from "../components/website-redesign/ds/img-placeholder";
import {
  GridInner,
  PageSection,
} from "../components/website-redesign/page-grid";
import { withTemplateSocialImage } from "../seo";

export const meta = () =>
  withTemplateSocialImage(
    [
      {
        title: "Free Screen Recorder for AI Agents | Agent-Native Clips",
      },
      {
        name: "description",
        content:
          "Record bugs, feedback, and walkthroughs for your AI agent. Clips is a free, open-source screen recorder that shares transcripts and timestamped images.",
      },
      {
        property: "og:title",
        content: "Free Screen Recorder for AI Agents | Agent-Native Clips",
      },
      {
        property: "og:description",
        content:
          "Record bugs, feedback, and walkthroughs for your AI agent. Clips is a free, open-source screen recorder that shares transcripts and timestamped images.",
      },
      {
        name: "keywords",
        content:
          "screen recording, async video, open source screen recorder, bug reporting, browser debug logs, console logs, network requests, repro video, jam alternative, AI transcripts, AI video summaries, agent-readable video links, agent-friendly Loom, agent-native clips, meeting notes, meeting recorder, granola alternative, wisprflow alternative, loom alternative, voice dictation, voice to text, push to talk dictation, calendar sync, action items, transcription, video messaging, async communication, shareable video links",
      },
    ],
    "Clips",
  );

const template = templates.find((t) => t.slug === "clips")!;

// Each id/label pair below is a literal instruction from the copy doc for
// what the placeholder art should eventually show — kept here so whoever
// drops in the real asset knows which one without re-reading the doc.
const USE_CASES = [
  {
    id: "act-on-feedback",
    titleKey: "useCase1Title",
    bodyKey: "useCase1Body",
    imageLabel: "ASSET U1",
  },
  {
    id: "investigate-bug",
    titleKey: "useCase2Title",
    bodyKey: "useCase2Body",
    imageLabel: "ASSET U2",
  },
  {
    id: "create-from-brief",
    titleKey: "useCase3Title",
    bodyKey: "useCase3Body",
    imageLabel: "ASSET U3",
  },
] as const;

const KEY_FEATURES = [
  {
    id: "agent-readable",
    titleKey: "feature1Title",
    bodyKey: "feature1Body",
    imageLabel: "ASSET F1",
  },
  {
    id: "auto-transcripts",
    titleKey: "feature2Title",
    bodyKey: "feature2Body",
    imageLabel: "ASSET F2",
  },
  {
    id: "browser-debug-logs",
    titleKey: "feature3Title",
    bodyKey: "feature3Body",
    imageLabel: "ASSET F3",
  },
  {
    id: "built-in-agent",
    titleKey: "feature4Title",
    bodyKey: "feature4Body",
    imageLabel: "ASSET F4",
  },
  {
    id: "searchable-library",
    titleKey: "feature5Title",
    bodyKey: "feature5Body",
    imageLabel: "ASSET F5",
  },
  {
    id: "push-to-talk",
    titleKey: "feature6Title",
    bodyKey: "feature6Body",
    imageLabel: "ASSET F6",
  },
] as const;

const CLIP_PREVIEWS = [
  {
    title: "Introducing Agent-Native Clips",
    href: firstPartyAppUrl("https://clips.agent-native.com/share/B0AgxdvzuZ7H"),
    thumbnail: "/clips/B0AgxdvzuZ7H.jpg",
  },
  {
    title: "Show Claude how to perform a task",
    href: firstPartyAppUrl("https://clips.agent-native.com/share/U1f0uKYYKGF2"),
    thumbnail: "/clips/U1f0uKYYKGF2.jpg",
  },
  {
    title: "Record browser workflows with Clips",
    href: firstPartyAppUrl("https://clips.agent-native.com/share/1J2KR4ryo2Wg"),
    thumbnail: "/clips/1J2KR4ryo2Wg.jpg",
  },
] as const;

const FAQ_ITEMS = [
  { id: "free", question: "question1", answer: "answer1" },
  { id: "agent-readable", question: "question2", answer: "answer2" },
  { id: "chrome-extension", question: "question3", answer: "answer3" },
  { id: "ai-watch", question: "question4", answer: "answer4" },
  { id: "who-can-access", question: "question5", answer: "answer5" },
] as const;

// TemplateHero assumes an ancestor centers it at max-w-site with zero extra
// gutter — TemplateLandingShell used to be that ancestor. Every PageSection
// below draws its grid lines flush to that same max-w-site edge, so this
// wrapper must match exactly (no px-* here) or the hero's border-x box ends
// up narrower than the rest of the page.
const HERO_WRAPPER_CLASS =
  "template-detail-page mx-auto w-full max-w-site overflow-x-clip";

export default function ClipsTemplate() {
  const t = useT();

  return (
    <div className="builder-brand-tokens">
      {/* Hero — copy and layout updated, existing hero visual kept as-is */}
      <div className={HERO_WRAPPER_CLASS}>
        <TemplateHero
          title={t("templateLanding.clips.heroTitle")}
          eyebrow={
            <span className="text-[var(--fg-secondary)]">
              {t("templateLanding.clips.heroEyebrow")}
            </span>
          }
          customizeTemplate={template}
          headingAction={
            <a
              href={firstPartyAppUrl("https://clips.agent-native.com")}
              target="_blank"
              rel="noopener noreferrer"
              className="primary-button"
              // The diagonal arrow's ink sits toward its own top-right corner,
              // so the button's symmetric 8px gap still reads as extra space
              // after the icon. Tightening just the gap (not the padding)
              // corrects that without touching the shared .primary-button rule.
              style={{ gap: "4px" }}
              onClick={(event) => {
                applyFirstTouchAttributionToLink(event.currentTarget);
                trackEvent("try live demo", {
                  template: template.slug,
                  location: "landing_page_hero",
                });
              }}
            >
              {t("templateLanding.clips.heroCta")}
              <IconArrowUpRight size={16} />
            </a>
          }
          description={<p>{t("templateLanding.clips.heroDescription")}</p>}
          descriptionPlacement="below-title"
          mediaOverlapsHeader
          media={
            <ClipsLibraryMock
              label={t("templateLanding.clips.s001")}
              className="h-[420px] sm:h-[620px] lg:h-[800px]"
            />
          }
        />
      </div>

      {/* What can you do with Clips? — three use-case cards */}
      <PageSection>
        <GridInner className="flex flex-col gap-[var(--spacing-6)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] pt-[var(--spacing-40)] pb-[var(--spacing-20)]">
          <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
            {t("templateLanding.clips.useCasesHeading")}
          </h2>
          <p className="m-0 max-w-[633px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
            {t("templateLanding.clips.useCasesBody")}
          </p>
        </GridInner>

        <GridInner>
          <div className="flex flex-col border border-solid border-[var(--b-border-subtle)]">
            {USE_CASES.map((useCase, index) => {
              // Alternate which side carries the text vs. the media on every
              // row so the section doesn't read as one long repeated pattern.
              const textLeft = index % 2 === 0;

              const textBlock = (
                <div
                  key="text"
                  className="order-1 flex flex-col justify-center gap-[var(--spacing-3)] p-[var(--spacing-8)] lg:order-none lg:p-[var(--spacing-12)]"
                >
                  <h3 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-4)] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--b-text-primary)]">
                    {t(`templateLanding.clips.${useCase.titleKey}`)}
                  </h3>
                  <p className="m-0 max-w-[420px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
                    {t(`templateLanding.clips.${useCase.bodyKey}`)}
                  </p>
                </div>
              );

              const mediaBlock = (
                <div
                  key="media"
                  className={`order-2 flex items-center justify-center p-[var(--spacing-8)] lg:order-none lg:p-[var(--spacing-12)] ${
                    useCase.id === "act-on-feedback"
                      ? ""
                      : "bg-[var(--b-bg-raised)]"
                  }`}
                >
                  {useCase.id === "act-on-feedback" ? (
                    <ClipsActOnFeedbackMock className="w-full" />
                  ) : (
                    <ImgPlaceholder
                      aspectRatio="4 / 3"
                      label={useCase.imageLabel}
                      rounded={false}
                      background="transparent"
                      bordered={false}
                    />
                  )}
                </div>
              );

              return (
                <div
                  key={useCase.id}
                  className="grid border-t border-solid border-[var(--b-border-subtle)] bg-[#0a0a0a] first:border-t-0 lg:grid-cols-[1fr_1.25fr]"
                >
                  {textLeft ? (
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

      {/* Key features — six cards, same layout as builder.io/platform/code */}
      <PageSection>
        <GridInner className="flex flex-col gap-[var(--spacing-6)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] pt-[var(--spacing-20)] pb-[var(--spacing-20)]">
          <p className="m-0 font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-1)] font-semibold uppercase tracking-[0.08em] text-[var(--b-text-secondary)]">
            {t("templateLanding.clips.keyFeaturesEyebrow")}
          </p>
          <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
            {t("templateLanding.clips.keyFeaturesHeading")}
          </h2>
        </GridInner>

        <GridInner>
          <div className="grid grid-cols-3 gap-px border border-solid border-[var(--b-border-subtle)] bg-[var(--b-border-subtle)] mobile:grid-cols-2 narrow:grid-cols-1">
            {KEY_FEATURES.map((feature) => (
              <ContentCard
                key={feature.id}
                title={t(`templateLanding.clips.${feature.titleKey}`)}
                body={t(`templateLanding.clips.${feature.bodyKey}`)}
              />
            ))}
          </div>
        </GridInner>
      </PageSection>

      {/* See Clips in action — three video cards, same card component */}
      <PageSection>
        <GridInner className="flex flex-col gap-[var(--spacing-6)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] pt-[var(--spacing-20)] pb-[var(--spacing-20)]">
          <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
            {t("templateLanding.clips.seeInActionHeading")}
          </h2>
          <p className="m-0 max-w-[633px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
            {t("templateLanding.clips.seeInActionBody")}
          </p>
        </GridInner>

        <GridInner>
          <div className="grid grid-cols-3 gap-px border border-solid border-[var(--b-border-subtle)] bg-[var(--b-border-subtle)] mobile:grid-cols-1">
            {CLIP_PREVIEWS.map((clip) => (
              <ContentCard
                key={clip.href}
                title={clip.title}
                body={t("templateLanding.clips.watchClipLabel")}
                image={{ src: clip.thumbnail, alt: clip.title }}
                imageAspect="16 / 9"
                imageObjectPosition="bottom"
                imagePosition="top"
                href={clip.href}
                onClick={() =>
                  trackEvent("view clip preview", {
                    clip: clip.href,
                    location: "landing_page_see_in_action",
                  })
                }
              />
            ))}
          </div>
        </GridInner>
      </PageSection>

      {/* FAQs */}
      <PageSection>
        <GridInner className="border-t border-solid border-[var(--b-border-default)]">
          <FaqAccordion
            idPrefix="clips-faq"
            eyebrow={t("templateLanding.faq.eyebrow")}
            title={t("templateLanding.faq.title")}
            items={FAQ_ITEMS.map((item) => ({
              id: item.id,
              question: t(`templateLanding.clips.faq.${item.question}`),
              answer: (
                <p className="m-0">
                  {t(`templateLanding.clips.faq.${item.answer}`)}
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
            {t("templateLanding.clips.finalCtaHeading")}
          </h2>
          <p className="m-0 max-w-[560px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
            {t("templateLanding.clips.finalCtaBody")}
          </p>
          <Button
            variant="cta"
            href={firstPartyAppUrl("https://clips.agent-native.com")}
            target="_blank"
            rel="noopener noreferrer"
            // Same optical fix as the hero CTA: the trailing arrow's ink
            // sits top-right in its box, so the default 6px gap still reads
            // as extra space after the icon.
            style={{ gap: "3px" }}
            onClick={(event: MouseEvent<HTMLAnchorElement>) => {
              applyFirstTouchAttributionToLink(event.currentTarget);
              trackEvent("try live demo", {
                template: template.slug,
                location: "landing_page_final_cta",
              });
            }}
          >
            {t("templateLanding.clips.finalCtaButton")}
          </Button>
        </GridInner>
      </PageSection>
    </div>
  );
}
