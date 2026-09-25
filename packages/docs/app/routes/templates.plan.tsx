import { useT } from "@agent-native/core/client/i18n";
import { IconArrowUpRight } from "@tabler/icons-react";
import { Link } from "react-router";

import { CustomizeTemplatePopover } from "../components/CustomizeTemplatePopover";
import { firstPartyAppUrl } from "../components/deployment-links";
import { applyFirstTouchAttributionToLink } from "../components/marketing-attribution";
import { TemplateHero } from "../components/template-landing";
import { PlansProductMock } from "../components/template-landing/PlansProductMock";
import { templates, trackEvent } from "../components/TemplateCard";
import { AppStatusBadge } from "../components/website-redesign/ds/app-status-badge";
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
        title: "Free Visual Planning for AI Coding | Agent-Native Plans",
      },
      {
        name: "description",
        content:
          "Review your coding agent's approach with diagrams, wireframes, and comments. Plans is free and open source, with visual recaps for completed code changes.",
      },
      {
        property: "og:title",
        content: "Free Visual Planning for AI Coding | Agent-Native Plans",
      },
      {
        property: "og:description",
        content:
          "Review your coding agent's approach with diagrams, wireframes, and comments. Plans is free and open source, with visual recaps for completed code changes.",
      },
      {
        name: "keywords",
        content:
          "AI coding agent plans, visual planning, Claude Code plans, Codex visual plan, architecture diagrams, wireframes, annotated code review, visual recap, agent-native plans",
      },
    ],
    "Plans",
  );

const template = templates.find((t) => t.slug === "plan")!;

// The docs page walking through installing the skill/connector — the
// primary hero and final-CTA action, per the copy. Same-origin route, so it
// stays a plain path rather than an absolute agent-native.com URL.
const PLAN_PLUGIN_DOCS_PATH = "/docs/plan-plugin";

const USE_CASES = [
  {
    id: "review-architecture",
    titleKey: "useCase1Title",
    bodyKey: "useCase1Body",
    textLeft: true,
  },
  {
    id: "work-through-interface",
    titleKey: "useCase2Title",
    bodyKey: "useCase2Body",
    textLeft: false,
  },
  {
    id: "understand-completed-changes",
    titleKey: "useCase3Title",
    bodyKey: "useCase3Body",
    textLeft: true,
  },
] as const;

const KEY_FEATURES = [
  {
    id: "architecture-diagrams",
    titleKey: "feature1Title",
    bodyKey: "feature1Body",
  },
  {
    id: "wireframes-and-prototypes",
    titleKey: "feature2Title",
    bodyKey: "feature2Body",
  },
  {
    id: "annotated-code-walkthroughs",
    titleKey: "feature3Title",
    bodyKey: "feature3Body",
  },
  {
    id: "comments-and-annotations",
    titleKey: "feature4Title",
    bodyKey: "feature4Body",
  },
  {
    id: "visual-code-recaps",
    titleKey: "feature5Title",
    bodyKey: "feature5Body",
  },
  {
    id: "sharing-and-exports",
    titleKey: "feature6Title",
    bodyKey: "feature6Body",
  },
] as const;

// The publishable copy has five Q&A pairs, not six — implemented as given
// rather than padded to match the older six-item FAQ this replaces.
const FAQ_ITEMS = [
  { id: "what-is-plans", question: "question1", answer: "answer1" },
  { id: "use-with-coding-agent", question: "question2", answer: "answer2" },
  { id: "revise-from-comments", question: "question3", answer: "answer3" },
  { id: "review-existing-code", question: "question4", answer: "answer4" },
  { id: "where-plans-are-saved", question: "question5", answer: "answer5" },
] as const;

// TemplateHero assumes an ancestor centers it at max-w-site with zero extra
// gutter — TemplateLandingShell used to be that ancestor. Every PageSection
// below draws its grid lines flush to that same max-w-site edge, so this
// wrapper must match exactly (no px-* here) or the hero's border-x box ends
// up narrower than the rest of the page.
const HERO_WRAPPER_CLASS =
  "template-detail-page mx-auto w-full max-w-site overflow-x-clip";

export default function PlanTemplate() {
  const t = useT();

  return (
    <div className="builder-brand-tokens">
      {/* Hero — the editor recreation shows the plan and review thread as one
          working surface while retaining the existing setup actions. */}
      <div className={HERO_WRAPPER_CLASS}>
        <TemplateHero
          title={
            <span className="block max-w-[560px]">
              {t("templateLanding.plan.heroTitle")}
            </span>
          }
          eyebrow={
            <span className="inline-flex items-center gap-2 text-[var(--fg)]">
              <LogoMark className="size-6" />
              <span className="font-sans text-[20px] font-bold tracking-tight">
                {t("templateLanding.plan.heroEyebrow")}
              </span>
              <AppStatusBadge appId="plan" />
            </span>
          }
          headingAction={
            <div className="flex w-full min-w-0 flex-col items-start gap-4">
              <div className="flex w-full min-w-0 flex-wrap items-center gap-3">
                <Link
                  to={PLAN_PLUGIN_DOCS_PATH}
                  className="primary-button"
                  style={{ gap: "4px" }}
                  onClick={() =>
                    trackEvent("click add to agent", {
                      template: template.slug,
                      location: "landing_page_hero",
                    })
                  }
                >
                  {t("templateLanding.plan.heroCta")}
                  <IconArrowUpRight size={16} />
                </Link>
                <a
                  href={firstPartyAppUrl(template.demoUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="secondary-button whitespace-nowrap"
                  onClick={(event) => {
                    applyFirstTouchAttributionToLink(event.currentTarget);
                    trackEvent("try live demo", {
                      template: template.slug,
                      location: "landing_page_hero",
                    });
                  }}
                >
                  {t("templateLanding.plan.heroSecondaryCta")}
                </a>
                {/* Rendered inline with the button row instead of via
                    TemplateHero's `customizeTemplate` prop -- that prop places
                    the popover as a flex-wrap sibling of the whole
                    `headingAction` block, which here is a two-row stack
                    (buttons + code block), so it would force onto its own row
                    below instead of sitting next to the buttons. */}
                <CustomizeTemplatePopover template={template} />
              </div>
              <div className="w-full max-w-[420px]">
                <CodeBlock code={template.cliCommand} language="bash" />
              </div>
            </div>
          }
          description={<p>{t("templateLanding.plan.heroDescription")}</p>}
          descriptionPlacement="below-title"
          mediaOverlapsHeader
          media={
            <PlansProductMock
              label={t("templateLanding.plan.s001")}
              className="h-[420px] sm:h-[620px] lg:h-[760px]"
            />
          }
        />
      </div>

      {/* What can you do with Plans? — plan, interface, and recap workflows */}
      <PageSection>
        <GridInner className="flex flex-col gap-[var(--spacing-6)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] pt-[var(--spacing-40)] pb-[var(--spacing-20)]">
          <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
            {t("templateLanding.plan.useCasesHeading")}
          </h2>
          <p className="m-0 max-w-[633px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
            {t("templateLanding.plan.useCasesBody")}
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
                    {t(`templateLanding.plan.${useCase.titleKey}`)}
                  </h3>
                  <p className="m-0 max-w-[420px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
                    {t(`templateLanding.plan.${useCase.bodyKey}`)}
                  </p>
                </div>
              );

              const variant =
                useCase.id === "review-architecture"
                  ? "architecture"
                  : useCase.id === "work-through-interface"
                    ? "interface"
                    : "recap";
              const mediaBlock = (
                <div
                  key="media"
                  className="order-2 flex items-center justify-center p-[var(--spacing-8)] lg:order-none lg:p-[var(--spacing-12)]"
                >
                  <PlansProductMock
                    variant={variant}
                    className="h-[300px] w-full max-w-[540px] lg:h-[390px] lg:max-w-none"
                    label={t(`templateLanding.plan.${useCase.titleKey}`)}
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
          and the Clips/Slides key-features grids, so every app reads as one
          system. */}
      <PageSection>
        <GridInner className="flex flex-col gap-[var(--spacing-6)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] pt-[var(--spacing-20)] pb-[var(--spacing-20)]">
          <p className="m-0 font-[family-name:var(--b-font-mono)] text-[length:var(--b-t-label-1)] font-semibold uppercase tracking-[0.08em] text-[var(--b-text-secondary)]">
            {t("templateLanding.plan.keyFeaturesEyebrow")}
          </p>
          <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
            {t("templateLanding.plan.keyFeaturesHeading")}
          </h2>
        </GridInner>

        <GridInner>
          <div className="grid grid-cols-3 gap-px border border-solid border-[var(--b-border-subtle)] bg-[var(--b-border-subtle)] mobile:grid-cols-2 narrow:grid-cols-1">
            {KEY_FEATURES.map((feature) => (
              <ContentCard
                key={feature.id}
                title={t(`templateLanding.plan.${feature.titleKey}`)}
                body={t(`templateLanding.plan.${feature.bodyKey}`)}
              />
            ))}
          </div>
        </GridInner>
      </PageSection>

      {/* FAQs — same pt-20 rhythm Slides added here since neither app has a
          "see it in action" section between the feature grid and the FAQ. */}
      <PageSection>
        <GridInner className="border-t border-solid border-[var(--b-border-default)] pt-[var(--spacing-20)]">
          <FaqAccordion
            idPrefix="plan-faq"
            eyebrow={t("templateLanding.faq.eyebrow")}
            title={t("templateLanding.faq.title")}
            items={FAQ_ITEMS.map((item) => ({
              id: item.id,
              question: t(`templateLanding.plan.faq.${item.question}`),
              answer: (
                <p className="m-0">
                  {t(`templateLanding.plan.faq.${item.answer}`)}
                </p>
              ),
            }))}
          />
        </GridInner>
      </PageSection>

      {/* Final CTA — repeats only the primary docs link, not the install
          command, per the copy. */}
      <PageSection>
        <GridInner className="flex flex-col items-center gap-[var(--spacing-6)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] py-[var(--spacing-40)] text-center">
          <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
            {t("templateLanding.plan.finalCtaHeading")}
          </h2>
          <p className="m-0 max-w-[560px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
            {t("templateLanding.plan.finalCtaBody")}
          </p>
          <Button
            variant="cta"
            href={PLAN_PLUGIN_DOCS_PATH}
            // The shared cta variant renders at 14px in sentence case, but the
            // hero's .primary-button (uppercase 12px mono, via the
            // .template-detail-page CSS rule) only applies inside the hero
            // wrapper. Match it explicitly here so both CTAs on the page read
            // as the same button style.
            style={{ gap: "3px", fontSize: "12px", textTransform: "uppercase" }}
            onClick={() =>
              trackEvent("click add to agent", {
                template: template.slug,
                location: "landing_page_final_cta",
              })
            }
          >
            {t("templateLanding.plan.finalCtaButton")}
          </Button>
        </GridInner>
      </PageSection>
    </div>
  );
}
