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
        title:
          "Agent-Native Forms — Open Source AI Form Builder & Typeform Alternative",
      },
      {
        name: "description",
        content:
          "Build, edit, and manage forms with AI. Open source alternative to Typeform and Google Forms. Generate forms from a prompt, customize visually, and route submissions to Slack, Discord, Google Sheets, or webhooks.",
      },
      {
        property: "og:title",
        content:
          "Agent-Native Forms — Open Source AI Form Builder & Typeform Alternative",
      },
      {
        property: "og:description",
        content:
          "Build forms with AI. Generate, customize, publish, and route submissions — built on an agent you own.",
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

export default function FormsTemplate() {
  const t = useT();
  const { locale } = useLocale();
  const capabilities = [
    {
      title: t("templateLanding.forms.s012"),
      body: t("templateLanding.forms.s013"),
    },
    {
      title: t("templateLanding.forms.s014"),
      body: t("templateLanding.forms.s015"),
    },
    {
      title: t("templateLanding.forms.s016"),
      body: t("templateLanding.forms.s017"),
    },
    {
      title: t("templateLanding.forms.s018"),
      body: t("templateLanding.forms.s019"),
    },
    {
      title: t("templateLanding.forms.s020"),
      body: t("templateLanding.forms.s021"),
    },
    {
      title: t("templateLanding.forms.s022"),
      body: t("templateLanding.forms.s023"),
    },
  ];
  const faqItems = Array.from({ length: 5 }, (_, index) => {
    const itemNumber = index + 1;
    return {
      id: `forms-question-${itemNumber}`,
      question: t(`templateLanding.forms.faq.question${itemNumber}`),
      answer: (
        <p className="m-0">
          {t(`templateLanding.forms.faq.answer${itemNumber}`)}
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
        title={t("templateLanding.forms.s006")}
        description={<p className="m-0">{t("templateLanding.forms.s007")}</p>}
        media={
          <img
            src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fdaf28ec63fc94830b6994fb4e5170551?format=webp&width=800&height=1200"
            crossOrigin="anonymous"
            alt={t("templateLanding.forms.s001")}
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
              href="https://forms.agent-native.com"
              target="_blank"
              rel="noopener noreferrer"
              className="primary-button"
              onClick={(event) => {
                applyFirstTouchAttributionToLink(event.currentTarget);
                trackEvent("try live demo", {
                  template: "forms",
                  location: "landing_page",
                });
              }}
            >
              {t("templateLanding.forms.s008")}
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
            {t("templateLanding.forms.s009")}
          </h2>
        </div>
        <TemplateStatOrStepsGrid>
          {[
            {
              step: "1",
              title: t("templateLanding.forms.s002"),
              desc: "Tell the agent what you're collecting — RSVPs, leads, feedback, applications.",
            },
            {
              step: "2",
              title: t("templateLanding.forms.s003"),
              desc: "The agent builds the form — fields, validation, options, and a public page.",
            },
            {
              step: "3",
              title: t("templateLanding.forms.s004"),
              desc: "Submissions flow into SQL and can be sent to Slack, Discord, Google Sheets, or a webhook.",
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
              {t("templateLanding.forms.s010")}
            </h2>
            <p className="m-0 text-lg leading-[1.3] text-[var(--fg-secondary)]">
              {t("templateLanding.forms.s011")}
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
              {t("templateLanding.forms.s024")}
            </h3>
            <p className="m-0 text-base leading-6 text-[var(--fg-secondary)]">
              {t("templateLanding.forms.s025")}
            </p>
            <ul className="m-0 flex list-none flex-col gap-3 p-0 text-base text-[var(--fg-secondary)]">
              {[
                t("templateLanding.forms.s026"),
                t("templateLanding.forms.s027"),
                t("templateLanding.forms.s028"),
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
              {t("templateLanding.forms.s029")}
            </h3>
            <p className="m-0 text-base leading-6 text-[var(--fg-secondary)]">
              {t("templateLanding.forms.s030")}
            </p>
            <div className="flex flex-col gap-3 border border-[var(--docs-border)] bg-[var(--bg)] p-4 font-mono text-sm text-[var(--fg-secondary)]">
              <div>{t("templateLanding.forms.s031")}</div>
              <div>{t("templateLanding.forms.s032")}</div>
              <div>{t("templateLanding.forms.s033")}</div>
              <div>{t("templateLanding.forms.s034")}</div>
            </div>
          </div>
        }
      />

      <SectionDivider showOnSmallScreens={false} />

      <section className="border-t border-[var(--docs-border)]">
        <div className="border-x border-[var(--docs-border)] px-6 pb-8 pt-12 sm:px-8 sm:pt-16">
          <h2 className="m-0 text-[1.75rem] font-medium leading-[1.15] tracking-tight text-[var(--fg)]">
            {t("templateLanding.forms.s035")}
          </h2>
        </div>
        <TemplateComparisonTable
          caption={t("templateLanding.forms.s035")}
          featureHeader={t("templateLanding.forms.s035")}
          columns={[
            {
              id: "typeform",
              header: "Typeform / Google Forms",
            },
            {
              id: "ai",
              header: t("templateLanding.forms.s036"),
            },
            {
              id: "forms",
              agentNative: { color: template.color, name: template.name },
              emphasized: true,
            },
          ]}
          rows={[
            {
              id: "form-creation",
              label: t("templateLanding.forms.s037"),
              cells: {
                typeform: t("templateLanding.forms.s038"),
                ai: t("templateLanding.forms.s039"),
                forms: t("templateLanding.forms.s040"),
              },
            },
            {
              id: "customization",
              label: t("templateLanding.forms.s041"),
              cells: {
                typeform: t("templateLanding.forms.s042"),
                ai: t("templateLanding.forms.s043"),
                forms: t("templateLanding.forms.s044"),
              },
            },
            {
              id: "integrations",
              label: t("templateLanding.forms.s045"),
              cells: {
                typeform: t("templateLanding.forms.s046"),
                ai: t("templateLanding.forms.s047"),
                forms: "Slack, Discord, Sheets, webhooks",
              },
            },
            {
              id: "data",
              label: t("templateLanding.forms.s048"),
              cells: {
                typeform: t("templateLanding.forms.s049"),
                ai: t("templateLanding.forms.s050"),
                forms: t("templateLanding.forms.s051"),
              },
            },
            {
              id: "pricing",
              label: t("templateLanding.forms.s052"),
              cells: {
                typeform: t("templateLanding.forms.s053"),
                ai: t("templateLanding.forms.s054"),
                forms: t("templateLanding.forms.s055"),
              },
            },
          ]}
        />
      </section>

      <SectionDivider showOnSmallScreens={false} />

      <TemplateFinalCta
        title={t("templateLanding.forms.s056")}
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
          {t("templateLanding.forms.s057")}
        </p>
      </TemplateFinalCta>

      <TemplateLandingFaq
        idPrefix="forms-faq"
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
