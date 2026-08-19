import { useLocale, useT } from "@agent-native/core/client/i18n";
import { IconCheck } from "@tabler/icons-react";
import { Link } from "react-router";

import { sitePathForLocale } from "../components/docs-locale";
import { SectionDivider } from "../components/SectionDivider";
import { SlidesTryNow } from "../components/SlidesTryNow";
import { TemplateDocsLink } from "../components/template-docs";
import {
  TemplateActivationFrame,
  TemplateCapabilityGrid,
  TemplateComparisonTable,
  TemplateFinalCta,
  TemplateHero,
  TemplateLandingFaq,
  TemplateLandingShell,
  TemplateSplitFeature,
  TemplateStatOrStepsGrid,
  TemplateStatOrStepsGridItem,
} from "../components/template-landing";
import { templates } from "../components/TemplateCard";
import { withTemplateSocialImage } from "../seo";

export const meta = () =>
  withTemplateSocialImage(
    [
      { title: "Agent-Native Slides — Open Source AI Presentation Builder" },
      {
        name: "description",
        content:
          "Generate and edit presentations with AI. Open source alternative to Google Slides and Pitch. Create slide decks via natural language with visual editing, 8 layouts, image generation, logo search, sharing, and presentation mode.",
      },
      {
        property: "og:title",
        content: "Agent-Native Slides — Open Source AI Presentation Builder",
      },
      {
        property: "og:description",
        content:
          "Generate and edit presentations with AI. Create slide decks via natural language.",
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

const COMPARISON_ROWS = [
  {
    feature: "Where you start",
    google: "Blank deck UI",
    gamma: "In-app prompt",
    slides: "In-app prompt.\nOr your own AI agent (Claude, GPT, etc)",
  },
  {
    feature: "Does it know your brand?",
    google: "No",
    gamma: "If you pay.",
    slides:
      "Yes. Import design systems.\nOr ask the agent to riff an old deck.",
  },
  {
    feature: "AI control",
    google: "Manual, start to finish",
    gamma: "Black box",
    slides: "Open-source, customizable",
  },
  {
    feature: "Integrations",
    google: "Only Google Suite",
    gamma: "Touchy and limited",
    slides: "Anything",
  },
];

export default function SlidesTemplate() {
  const t = useT();
  const { locale } = useLocale();
  const workflowSteps = [
    {
      title: t("templateLanding.slides.s002"),
      description: t("templateLanding.slides.howItWorksDescribe"),
    },
    {
      title: t("templateLanding.slides.s003"),
      description:
        "The agent builds a complete deck — structure, content, layouts, and image prompts.",
    },
    {
      title: t("templateLanding.slides.s004"),
      description:
        "Edit visually, conversationally, or in code. Changes appear through polling sync.",
    },
  ];
  const capabilities = [
    {
      title: t("templateLanding.slides.s012"),
      description: t("templateLanding.slides.s013"),
    },
    {
      title: t("templateLanding.slides.s014"),
      description: t("templateLanding.slides.s015"),
    },
    {
      title: t("templateLanding.slides.s016"),
      description: t("templateLanding.slides.s017"),
    },
    {
      title: t("templateLanding.slides.s018"),
      description: t("templateLanding.slides.s019"),
    },
    {
      title: t("templateLanding.slides.s020"),
      description: t("templateLanding.slides.s021"),
    },
    {
      title: t("templateLanding.slides.s022"),
      description: t("templateLanding.slides.s023"),
    },
  ];
  const faqItems = Array.from({ length: 5 }, (_, index) => {
    const itemNumber = index + 1;
    return {
      id: `slides-question-${itemNumber}`,
      question: t(`templateLanding.slides.faq.question${itemNumber}`),
      answer: (
        <p className="m-0">
          {t(`templateLanding.slides.faq.answer${itemNumber}`)}
        </p>
      ),
    };
  });

  return (
    <TemplateLandingShell>
      <TemplateHero
        eyebrow={
          <span style={{ color: template.color }}>
            Agent-Native {template.name}
          </span>
        }
        title={t("templateLanding.slides.s006")}
        description={<p className="m-0">{t("templateLanding.slides.s007")}</p>}
        media={
          <img
            src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F9124162c94584b5abceb95f662ac8704?format=webp&width=2200"
            crossOrigin="anonymous"
            alt={t("templateLanding.slides.s001")}
            loading="lazy"
            decoding="async"
            className="h-auto max-h-[640px] w-full object-cover object-top"
          />
        }
      />

      <TemplateActivationFrame
        id="build-now"
        className="scroll-mt-24"
        heading={
          <div className="flex flex-col gap-3">
            <h2 className="m-0 text-[1.75rem] font-medium leading-[1.15] tracking-[-0.56px] text-[var(--fg)]">
              {t("templateLanding.slides.s055")}
            </h2>
            <p className="m-0 text-lg leading-[1.3] text-[var(--fg-secondary)]">
              {t("templateLanding.slides.s056")}
            </p>
          </div>
        }
      >
        <SlidesTryNow />
      </TemplateActivationFrame>

      <SectionDivider />

      <section className="border-t border-[var(--docs-border)]">
        <div className="border-x border-[var(--docs-border)] px-6 pb-10 pt-16 sm:px-8 sm:pb-14 sm:pt-24">
          <h2 className="m-0 text-[1.75rem] font-medium leading-[1.05] tracking-[-0.56px] text-[var(--fg)] sm:text-4xl">
            {t("templateLanding.slides.s009")}
          </h2>
        </div>
        <TemplateStatOrStepsGrid>
          {workflowSteps.map((step, index) => (
            <TemplateStatOrStepsGridItem key={step.title}>
              <span
                aria-hidden="true"
                className="font-mono text-sm font-semibold uppercase tracking-[0.14em]"
                style={{ color: template.color }}
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="m-0 text-2xl font-medium leading-[1.15] tracking-tight text-[var(--fg)]">
                {step.title}
              </h3>
              <p className="m-0 text-base leading-[1.4] text-[var(--fg-secondary)]">
                {step.description}
              </p>
            </TemplateStatOrStepsGridItem>
          ))}
        </TemplateStatOrStepsGrid>
      </section>

      <SectionDivider />

      <TemplateCapabilityGrid
        intro={
          <>
            <h2 className="m-0 text-[1.75rem] font-medium leading-[1.15] tracking-[-0.56px] text-[var(--fg)]">
              {t("templateLanding.slides.s010")}
            </h2>
            <p className="m-0 max-w-[320px] text-lg leading-[1.3] text-[var(--fg-secondary)]">
              {t("templateLanding.slides.s011")}
            </p>
          </>
        }
      >
        {capabilities.map((capability) => (
          <article
            key={capability.title}
            className="flex min-h-[220px] flex-col gap-4 border-b border-[var(--docs-border)] p-6 last:border-b-0 sm:p-8 sm:odd:border-e sm:[&:nth-last-child(-n+2)]:border-b-0"
          >
            <div
              aria-hidden="true"
              className="h-1 w-10 rounded-full"
              style={{ backgroundColor: template.color }}
            />
            <h3 className="m-0 text-lg font-medium leading-[1.15] tracking-tight text-[var(--fg)]">
              {capability.title}
            </h3>
            <p className="m-0 text-base leading-[1.4] text-[var(--fg-secondary)]">
              {capability.description}
            </p>
          </article>
        ))}
      </TemplateCapabilityGrid>

      <SectionDivider />

      <TemplateSplitFeature
        leading={
          <article className="flex h-full flex-col gap-6 p-6 sm:p-8 lg:p-10">
            <div className="flex flex-col gap-3">
              <h2 className="m-0 text-[1.75rem] font-medium leading-[1.15] tracking-[-0.56px] text-[var(--fg)]">
                {t("templateLanding.slides.s024")}
              </h2>
              <p className="m-0 text-lg leading-[1.3] text-[var(--fg-secondary)]">
                {t("templateLanding.slides.s025")}
              </p>
            </div>
            <ul className="m-0 grid list-none gap-3 p-0 text-base text-[var(--fg-secondary)]">
              {[
                t("templateLanding.slides.s026"),
                t("templateLanding.slides.s027"),
                t("templateLanding.slides.s028"),
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <IconCheck
                    aria-hidden="true"
                    className="mt-0.5 size-5 shrink-0"
                    style={{ color: template.color }}
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </article>
        }
        trailing={
          <article className="flex h-full flex-col gap-6 p-6 sm:p-8 lg:p-10">
            <div className="flex flex-col gap-3">
              <h2 className="m-0 text-[1.75rem] font-medium leading-[1.15] tracking-[-0.56px] text-[var(--fg)]">
                {t("templateLanding.slides.s029")}
              </h2>
              <p className="m-0 text-lg leading-[1.3] text-[var(--fg-secondary)]">
                {t("templateLanding.slides.s030")}
              </p>
            </div>
            <ul className="m-0 grid list-none border-t border-[var(--docs-border)] p-0 font-mono text-sm leading-6 text-[var(--fg-secondary)]">
              {[
                t("templateLanding.slides.s031"),
                t("templateLanding.slides.s032"),
                t("templateLanding.slides.s033"),
                t("templateLanding.slides.s034"),
              ].map((example) => (
                <li
                  key={example}
                  className="border-b border-[var(--docs-border)] py-4"
                >
                  {example}
                </li>
              ))}
            </ul>
          </article>
        }
      />

      <SectionDivider />

      <section
        id="comparison"
        className="scroll-mt-24 border-t border-[var(--docs-border)]"
      >
        <div className="border-x border-[var(--docs-border)] px-6 pb-10 pt-16 sm:px-8 sm:pb-14 sm:pt-24">
          <h2 className="m-0 text-[1.75rem] font-medium leading-[1.05] tracking-[-0.56px] text-[var(--fg)] sm:text-4xl">
            {t("templateLanding.slides.s035")}
          </h2>
        </div>
        <TemplateComparisonTable
          caption={t("templateLanding.slides.s035")}
          featureHeader={t("templateLanding.slides.s035")}
          columns={[
            {
              id: "google",
              className: "w-[22%]",
              header: "Google Slides",
            },
            {
              id: "gamma",
              className: "w-[22%]",
              header: "Gamma, Tome",
            },
            {
              id: "slides",
              className: "w-[30%]",
              emphasized: true,
              agentNative: { color: template.color, name: template.name },
            },
          ]}
          rows={[
            ...COMPARISON_ROWS.map((row) => ({
              id: row.feature,
              label: row.feature,
              cells: {
                google: row.google,
                gamma: row.gamma,
                slides: (
                  <span className="whitespace-pre-line">{row.slides}</span>
                ),
              },
            })),
            {
              id: "pricing",
              label: t("templateLanding.slides.s051"),
              cells: {
                google: t("templateLanding.slides.s052"),
                gamma: t("templateLanding.slides.s053"),
                slides: t("templateLanding.slides.s054"),
              },
            },
          ]}
        />
      </section>

      <SectionDivider />

      <TemplateFinalCta
        className="[&>div:first-child]:py-10 sm:[&>div:first-child]:py-12 lg:[&>div:first-child]:py-16 [&>div:last-child]:gap-4 sm:[&>div:last-child]:gap-4"
        actions={
          <>
            <a
              href="https://slides.agent-native.com/_agent-native/sign-in"
              target="_blank"
              rel="noopener noreferrer"
              className="primary-button focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--docs-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
            >
              {t("templateLanding.slides.signIn")}
            </a>
            <TemplateDocsLink
              template={template}
              location="landing_page_cta"
              className="secondary-button focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--docs-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
            >
              {t("templateLanding.slides.s057")}
            </TemplateDocsLink>
            <Link
              data-an-prefetch="viewport"
              to={sitePathForLocale("/apps", locale)}
              className="secondary-button focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--docs-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
            >
              {t("templateLanding.slides.s058")}
            </Link>
          </>
        }
      />

      <SectionDivider />

      <TemplateLandingFaq
        idPrefix="slides-faq"
        eyebrow={
          <span style={{ color: template.color }}>
            {t("templateLanding.faq.eyebrow")}
          </span>
        }
        title={t("templateLanding.faq.title")}
        items={faqItems}
      />
    </TemplateLandingShell>
  );
}
