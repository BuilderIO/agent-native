import { useLocale, useT } from "@agent-native/core/client/i18n";
import {
  IconCheck,
  IconMessage,
  IconPencil,
  IconUpload,
} from "@tabler/icons-react";
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
        title: "Agent-Native Content — Open Source Obsidian for MDX",
      },
      {
        name: "description",
        content:
          "Edit local Markdown/MDX files like Obsidian, generate rich interactive custom MDX blocks, and write with an AI agent that knows your docs.",
      },
      {
        property: "og:title",
        content: "Agent-Native Content — Open Source Obsidian for MDX",
      },
      {
        property: "og:description",
        content:
          "Local MDX editing, custom interactive blocks, and agent-assisted docs.",
      },
      {
        name: "keywords",
        content:
          "Obsidian for MDX, open source Obsidian alternative, MDX editor, local Markdown editor, AI content editor, open source Notion alternative, Google Docs alternative, AI writing tool, agent-native content, AI-powered CMS, AI document editor, custom MDX blocks",
      },
    ],
    "Content",
  );

const template = templates.find((t) => t.slug === "content")!;

export default function ContentTemplate() {
  const t = useT();
  const { locale } = useLocale();
  const capabilities = [
    {
      title: t("templateLanding.content.s014"),
      body: t("templateLanding.content.s015"),
    },
    {
      title: t("templateLanding.content.s016"),
      body: t("templateLanding.content.s017"),
    },
    {
      title: "Notion Import/Export",
      body: t("templateLanding.content.s018"),
    },
    {
      title: t("templateLanding.content.s019"),
      body: t("templateLanding.content.s020"),
    },
    {
      title: t("templateLanding.content.s021"),
      body: t("templateLanding.content.s022"),
    },
    {
      title: t("templateLanding.content.s023"),
      body: t("templateLanding.content.s024"),
    },
    {
      title: t("templateLanding.content.s025"),
      body: t("templateLanding.content.s026"),
    },
  ];
  const faqItems = Array.from({ length: 5 }, (_, index) => {
    const itemNumber = index + 1;
    return {
      id: `content-question-${itemNumber}`,
      question: t(`templateLanding.content.faq.question${itemNumber}`),
      answer: (
        <p className="m-0">
          {t(`templateLanding.content.faq.answer${itemNumber}`)}
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
        title={t("templateLanding.content.s003")}
        description={<p className="m-0">{t("templateLanding.content.s004")}</p>}
        mediaClassName="bg-[var(--bg-secondary)]"
        media={
          <img
            src={template.screenshot}
            alt={t("templateLanding.content.s001")}
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
              href="https://content.agent-native.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[var(--fg)] px-5 py-3 text-sm font-medium text-[var(--bg)] no-underline transition-[opacity] hover:opacity-90 hover:no-underline"
              onClick={(event) => {
                applyFirstTouchAttributionToLink(event.currentTarget);
                trackEvent("try live demo", {
                  template: "content",
                  location: "landing_page",
                });
              }}
            >
              {t("templateLanding.content.s005")}
            </a>
            <TemplateDocsLink
              template={template}
              location="landing_page"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[var(--docs-border)] px-5 py-3 text-sm font-medium text-[var(--fg)] no-underline transition-[border-color] hover:border-[var(--fg-secondary)] hover:no-underline"
            />
          </div>
        </div>
      </TemplateActivationFrame>

      <SectionDivider showOnSmallScreens={false} />

      <TemplateStatOrStepsGrid>
        {[
          {
            id: "write",
            icon: IconPencil,
            title: t("templateLanding.content.s006"),
            body: t("templateLanding.content.s007"),
          },
          {
            id: "agent",
            icon: IconMessage,
            title: t("templateLanding.content.s008"),
            body: t("templateLanding.content.s009"),
          },
          {
            id: "publish",
            icon: IconUpload,
            title: t("templateLanding.content.s010"),
            body: t("templateLanding.content.s011"),
          },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <TemplateStatOrStepsGridItem key={item.id}>
              <Icon
                aria-hidden="true"
                size={24}
                stroke={1.5}
                style={{ color: template.color }}
              />
              <h3 className="m-0 text-xl font-medium leading-tight text-[var(--fg)]">
                {item.title}
              </h3>
              <p className="m-0 text-base leading-6 text-[var(--fg-secondary)]">
                {item.body}
              </p>
            </TemplateStatOrStepsGridItem>
          );
        })}
      </TemplateStatOrStepsGrid>

      <SectionDivider showOnSmallScreens={false} />

      <TemplateCapabilityGrid
        intro={
          <>
            <h2 className="m-0 text-[1.75rem] font-medium leading-[1.15] tracking-tight text-[var(--fg)]">
              {t("templateLanding.content.s012")}
            </h2>
            <p className="m-0 text-lg leading-[1.3] text-[var(--fg-secondary)]">
              {t("templateLanding.content.s013")}
            </p>
          </>
        }
      >
        {capabilities.map((capability, index) => (
          <div
            key={capability.title}
            className={`flex min-h-[180px] flex-col justify-center gap-2 border-b border-[var(--docs-border)] p-6 last:border-b-0 sm:odd:border-e sm:last:col-span-2 sm:last:border-e-0 sm:[&:nth-last-child(-n+2)]:border-b-0 sm:p-8 ${index === 5 ? "!border !border-[var(--docs-border)] sm:!border" : ""}`}
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
            <h2 className="m-0 text-[1.75rem] font-medium leading-tight text-[var(--fg)]">
              {t("templateLanding.content.s027")}
            </h2>
            <p className="m-0 text-base leading-6 text-[var(--fg-secondary)]">
              {t("templateLanding.content.s028")}
            </p>
            <ul className="m-0 flex list-none flex-col gap-3 p-0 text-base text-[var(--fg-secondary)]">
              {[
                "WordPress, Contentful, Builder, or any CMS",
                t("templateLanding.content.s029"),
                t("templateLanding.content.s030"),
                t("templateLanding.content.s031"),
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
          <div className="flex h-full items-center p-6 sm:p-8 lg:p-10">
            <div className="flex w-full flex-col gap-3 border border-[var(--docs-border)] bg-[var(--bg)] p-5 font-mono text-sm">
              <div className="text-[var(--fg-secondary)]">
                {"// Agent publishing workflow"}
              </div>
              {[
                t("templateLanding.content.s032"),
                t("templateLanding.content.s033"),
                t("templateLanding.content.s034"),
                t("templateLanding.content.s035"),
              ].map((step, index) => (
                <div key={step} className="flex gap-2 text-[var(--fg)]">
                  <span style={{ color: template.color }}>{index + 1}.</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>
        }
      />

      <SectionDivider showOnSmallScreens={false} />

      <section className="border-t border-[var(--docs-border)]">
        <div className="border-x border-[var(--docs-border)] px-6 pb-8 pt-12 sm:px-8 sm:pt-16">
          <h2 className="m-0 text-[1.75rem] font-medium leading-[1.15] tracking-tight text-[var(--fg)]">
            {t("templateLanding.content.s036")}
          </h2>
        </div>
        <TemplateComparisonTable
          caption={t("templateLanding.content.s036")}
          featureHeader={t("templateLanding.content.s036")}
          columns={[
            {
              id: "editors",
              header: "Obsidian / Notion / Google Docs",
            },
            {
              id: "ai",
              header: "ChatGPT / Claude",
            },
            {
              id: "content",
              header: "Agent-Native Content",
              emphasized: true,
            },
          ]}
          rows={[
            {
              id: "file-format",
              label: t("templateLanding.content.s037"),
              cells: {
                editors: t("templateLanding.content.s038"),
                ai: t("templateLanding.content.s039"),
                content: t("templateLanding.content.s040"),
              },
            },
            {
              id: "custom-blocks",
              label: t("templateLanding.content.s041"),
              cells: {
                editors: "None",
                ai: t("templateLanding.content.s042"),
                content: t("templateLanding.content.s043"),
              },
            },
            {
              id: "agent-context",
              label: t("templateLanding.content.s044"),
              cells: {
                editors: t("templateLanding.content.s045"),
                ai: t("templateLanding.content.s046"),
                content: t("templateLanding.content.s047"),
              },
            },
            {
              id: "publishing",
              label: t("templateLanding.content.s048"),
              cells: {
                editors: t("templateLanding.content.s049"),
                ai: t("templateLanding.content.s046"),
                content: t("templateLanding.content.s050"),
              },
            },
            {
              id: "storage",
              label: t("templateLanding.content.s051"),
              cells: {
                editors: t("templateLanding.content.s052"),
                ai: t("templateLanding.content.s053"),
                content: t("templateLanding.content.s054"),
              },
            },
            {
              id: "ownership",
              label: t("templateLanding.content.s055"),
              cells: {
                editors: t("templateLanding.content.s056"),
                ai: t("templateLanding.content.s057"),
                content: t("templateLanding.content.s058"),
              },
            },
          ]}
        />
      </section>

      <SectionDivider showOnSmallScreens={false} />

      <TemplateFinalCta
        title={t("templateLanding.content.s059")}
        actions={
          <>
            <a
              href={`${template.demoUrl}/_agent-native/sign-in`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-[var(--fg)] px-5 py-3 text-sm font-medium text-[var(--bg)] no-underline transition-[opacity] hover:opacity-90 hover:no-underline"
            >
              {t("common.signIn")}
            </a>
            <Link
              data-an-prefetch="viewport"
              to={sitePathForLocale("/apps", locale)}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-[var(--docs-border)] px-5 py-3 text-sm font-medium text-[var(--fg)] no-underline transition-[border-color] hover:border-[var(--fg-secondary)] hover:no-underline"
            >
              View more apps
            </Link>
          </>
        }
      >
        <p className="m-0 max-w-2xl px-6 text-lg leading-[1.4] text-[var(--fg-secondary)] sm:px-8">
          {t("templateLanding.content.s060")}
        </p>
      </TemplateFinalCta>

      <TemplateLandingFaq
        idPrefix="content-faq"
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
