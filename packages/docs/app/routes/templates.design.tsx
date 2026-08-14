import { useLocale, useT } from "@agent-native/core/client/i18n";
import { IconCheck } from "@tabler/icons-react";
import { Link } from "react-router";

import { sitePathForLocale } from "../components/docs-locale";
import { applyFirstTouchAttributionToLink } from "../components/marketing-attribution";
import { SectionDivider } from "../components/SectionDivider";
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
import { templates, trackEvent } from "../components/TemplateCard";
import { withTemplateSocialImage } from "../seo";

export const meta = () =>
  withTemplateSocialImage(
    [
      {
        title: "Agent-Native Design — Open Source AI HTML Prototyping Tool",
      },
      {
        name: "description",
        content:
          "Create interactive HTML prototypes with AI. Generate Alpine/Tailwind designs from prompts, compare variants, refine with tweak controls, and export HTML, ZIP, or PDF.",
      },
      {
        property: "og:title",
        content: "Agent-Native Design — Open Source AI HTML Prototyping Tool",
      },
      {
        property: "og:description",
        content:
          "Generate, refine, preview, and export interactive HTML prototypes — built on an agent you own.",
      },
      {
        name: "keywords",
        content:
          "AI design tool, AI HTML prototype, open source design tool, AI UI generator, Alpine Tailwind prototype, agent-native design, prompt to HTML, generative design",
      },
    ],
    "Design",
  );

const template = templates.find((t) => t.slug === "design")!;

export default function DesignTemplate() {
  const t = useT();
  const { locale } = useLocale();
  const capabilities = [
    {
      title: t("templateLanding.design.s012"),
      body: t("templateLanding.design.s013"),
    },
    {
      title: t("templateLanding.design.s014"),
      body: t("templateLanding.design.s015"),
    },
    {
      title: t("templateLanding.design.s016"),
      body: t("templateLanding.design.s017"),
    },
    {
      title: t("templateLanding.design.s018"),
      body: t("templateLanding.design.s019"),
    },
    {
      title: t("templateLanding.design.s020"),
      body: t("templateLanding.design.s021"),
    },
    {
      title: t("templateLanding.design.s022"),
      body: t("templateLanding.design.s023"),
    },
  ];
  const faqItems = Array.from({ length: 5 }, (_, index) => {
    const itemNumber = index + 1;
    return {
      id: `design-question-${itemNumber}`,
      question: t(`templateLanding.design.faq.question${itemNumber}`),
      answer: (
        <p className="m-0">
          {t(`templateLanding.design.faq.answer${itemNumber}`)}
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
        title={t("templateLanding.design.s006")}
        description={<p className="m-0">{t("templateLanding.design.s007")}</p>}
        mediaClassName="bg-[var(--bg-secondary)]"
        media={
          <img
            src={template.screenshot}
            crossOrigin="anonymous"
            alt={t("templateLanding.design.s001")}
            loading="lazy"
            decoding="async"
            className="h-auto max-h-[640px] w-full object-cover object-top"
          />
        }
      />

      <TemplateActivationFrame
        heading={
          <h2 className="m-0 text-2xl font-medium leading-tight tracking-tight text-[var(--fg)]">
            Agent-Native {template.name}
          </h2>
        }
      >
        <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-center sm:gap-[120px]">
          <div className="template-detail-actions contents">
            <a
              href="https://design.agent-native.com"
              target="_blank"
              rel="noopener noreferrer"
              className="primary-button"
              onClick={(event) => {
                applyFirstTouchAttributionToLink(event.currentTarget);
                trackEvent("try live demo", {
                  template: "design",
                  location: "landing_page",
                });
              }}
            >
              {t("templateLanding.design.s008")}
            </a>
            <TemplateDocsLink
              template={template}
              location="landing_page"
              className="secondary-button"
            />
          </div>
        </div>
      </TemplateActivationFrame>

      <SectionDivider showOnSmallScreens={false} />

      <section className="border-t border-[var(--docs-border)]">
        <div className="border-x border-[var(--docs-border)] px-6 pb-8 pt-12 sm:px-8 sm:pt-16">
          <h2 className="m-0 text-[1.75rem] font-medium leading-[1.15] tracking-tight text-[var(--fg)]">
            {t("templateLanding.design.s009")}
          </h2>
        </div>
        <TemplateStatOrStepsGrid>
          {[
            {
              step: "1",
              title: t("templateLanding.design.s002"),
              desc: "Tell the agent what you're making — a landing page, product UI, brand direction, or interactive prototype.",
            },
            {
              step: "2",
              title: t("templateLanding.design.s003"),
              desc: "The agent creates complete self-contained HTML with Tailwind styling and Alpine interactions.",
            },
            {
              step: "3",
              title: t("templateLanding.design.s004"),
              desc: "Pick a variant, adjust tweak controls, or ask the agent for copy, layout, color, and interaction changes.",
            },
          ].map((item) => (
            <TemplateStatOrStepsGridItem key={item.step}>
              <div
                className="font-mono text-sm font-semibold"
                style={{ color: template.color }}
              >
                {item.step}
              </div>
              <h3 className="m-0 text-xl font-medium leading-tight text-[var(--fg)]">
                {item.title}
              </h3>
              <p className="m-0 text-base leading-6 text-[var(--fg-secondary)]">
                {item.desc}
              </p>
            </TemplateStatOrStepsGridItem>
          ))}
        </TemplateStatOrStepsGrid>
      </section>

      <SectionDivider showOnSmallScreens={false} />

      <TemplateCapabilityGrid
        intro={
          <>
            <h2 className="m-0 text-[1.75rem] font-medium leading-[1.15] tracking-tight text-[var(--fg)]">
              {t("templateLanding.design.s010")}
            </h2>
            <p className="m-0 text-lg leading-[1.3] text-[var(--fg-secondary)]">
              {t("templateLanding.design.s011")}
            </p>
          </>
        }
      >
        {capabilities.map((capability) => (
          <div
            key={capability.title}
            className="flex min-h-[180px] flex-col justify-center gap-2 border-b border-[var(--docs-border)] p-6 last:border-b-0 sm:odd:border-e sm:[&:nth-last-child(-n+2)]:border-b-0 sm:p-8"
          >
            <h3 className="m-0 text-lg font-medium leading-tight text-[var(--fg)]">
              {capability.title}
            </h3>
            <p className="m-0 text-base leading-6 text-[var(--fg-secondary)]">
              {capability.body}
            </p>
          </div>
        ))}
      </TemplateCapabilityGrid>

      <SectionDivider showOnSmallScreens={false} />

      <TemplateSplitFeature
        leading={
          <div className="flex h-full flex-col gap-4 p-6 sm:p-8 lg:p-10">
            <h3 className="m-0 text-[1.75rem] font-medium leading-tight text-[var(--fg)]">
              {t("templateLanding.design.s024")}
            </h3>
            <p className="m-0 text-base leading-6 text-[var(--fg-secondary)]">
              {t("templateLanding.design.s025")}
            </p>
            <ul className="m-0 flex list-none flex-col gap-3 p-0 text-base text-[var(--fg-secondary)]">
              {[
                t("templateLanding.design.s026"),
                t("templateLanding.design.s027"),
                "SQL-backed design records you can customize and extend",
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <IconCheck
                    aria-hidden="true"
                    size={18}
                    className="mt-0.5 shrink-0"
                    style={{ color: template.color }}
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        }
        trailing={
          <div className="flex h-full flex-col gap-4 p-6 sm:p-8 lg:p-10">
            <h3 className="m-0 text-[1.75rem] font-medium leading-tight text-[var(--fg)]">
              {t("templateLanding.design.s028")}
            </h3>
            <p className="m-0 text-base leading-6 text-[var(--fg-secondary)]">
              {t("templateLanding.design.s029")}
            </p>
            <div className="flex flex-col gap-3 border border-[var(--docs-border)] bg-[var(--bg)] p-4 font-mono text-sm text-[var(--fg-secondary)]">
              <div>{t("templateLanding.design.s030")}</div>
              <div>{t("templateLanding.design.s031")}</div>
              <div>{t("templateLanding.design.s032")}</div>
              <div>{t("templateLanding.design.s033")}</div>
            </div>
          </div>
        }
      />

      <SectionDivider showOnSmallScreens={false} />

      <section className="border-t border-[var(--docs-border)]">
        <div className="border-x border-[var(--docs-border)] px-6 pb-8 pt-12 sm:px-8 sm:pt-16">
          <h2 className="m-0 text-[1.75rem] font-medium leading-[1.15] tracking-tight text-[var(--fg)]">
            {t("templateLanding.design.s034")}
          </h2>
        </div>
        <TemplateComparisonTable
          caption={t("templateLanding.design.s034")}
          featureHeader={t("templateLanding.design.s034")}
          columns={[
            {
              id: "traditional",
              header: t("templateLanding.design.s035"),
            },
            {
              id: "ai",
              header: t("templateLanding.design.s036"),
            },
            {
              id: "design",
              agentNative: { color: template.color, name: template.name },
              emphasized: true,
            },
          ]}
          rows={[
            {
              id: "generation",
              label: t("templateLanding.design.s037"),
              cells: {
                traditional: t("templateLanding.design.s038"),
                ai: t("templateLanding.design.s039"),
                design: t("templateLanding.design.s040"),
              },
            },
            {
              id: "interactivity",
              label: t("templateLanding.design.s041"),
              cells: {
                traditional: t("templateLanding.design.s042"),
                ai: t("templateLanding.design.s043"),
                design: t("templateLanding.design.s044"),
              },
            },
            {
              id: "refinement",
              label: t("templateLanding.design.s045"),
              cells: {
                traditional: t("templateLanding.design.s046"),
                ai: t("templateLanding.design.s047"),
                design: t("templateLanding.design.s048"),
              },
            },
            {
              id: "export",
              label: t("templateLanding.design.s049"),
              cells: {
                traditional: t("templateLanding.design.s050"),
                ai: t("templateLanding.design.s051"),
                design: t("templateLanding.design.s052"),
              },
            },
            {
              id: "ownership",
              label: t("templateLanding.design.s053"),
              cells: {
                traditional: t("templateLanding.design.s054"),
                ai: t("templateLanding.design.s055"),
                design: t("templateLanding.design.s056"),
              },
            },
          ]}
        />
      </section>

      <SectionDivider showOnSmallScreens={false} />

      <TemplateFinalCta
        title={t("templateLanding.design.s057")}
        actions={
          <>
            <a
              href={`${template.demoUrl}/_agent-native/sign-in`}
              target="_blank"
              rel="noopener noreferrer"
              className="primary-button"
            >
              {t("common.signIn")}
            </a>
            <Link
              data-an-prefetch="viewport"
              to={sitePathForLocale("/apps", locale)}
              className="secondary-button"
            >
              View more apps
            </Link>
          </>
        }
      >
        <p className="m-0 max-w-2xl px-6 text-lg leading-[1.4] text-[var(--fg-secondary)] sm:px-8">
          {t("templateLanding.design.s058")}
        </p>
      </TemplateFinalCta>

      <TemplateLandingFaq
        idPrefix="design-faq"
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
