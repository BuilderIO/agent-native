import { useLocale, useT } from "@agent-native/core/client/i18n";
import {
  IconArrowUpRight,
  IconBrandVisualStudio,
  IconBraces,
  IconCheck,
  IconCopy,
  IconFolders,
  IconHierarchy,
  IconLayoutKanban,
  IconLink,
} from "@tabler/icons-react";
import { useState } from "react";
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
          "Agent-Native Plans — Visual Planning for Codex, Claude Code & Coding Agents",
      },
      {
        name: "description",
        content:
          "Give your coding agent a visual plan surface. Wireframes, diagrams, annotated code, prototypes, and shareable review links — installed in seconds as a skill for Codex, Claude Code, and any coding agent.",
      },
      {
        property: "og:title",
        content:
          "Agent-Native Plans — Visual Planning for Codex, Claude Code & Coding Agents",
      },
      {
        property: "og:description",
        content:
          "Give your coding agent a visual plan surface. Wireframes, diagrams, annotated code, and shareable review links.",
      },
      {
        name: "keywords",
        content:
          "AI coding agent plans, visual planning, Codex visual plan, Claude Code plans, coding agent wireframe, agent plan skill, visual plan mode, AI diagram generator, agent-native plans, annotated code review, shareable agent plans",
      },
    ],
    "Plans",
  );

const template = templates.find((t) => t.slug === "plan")!;

function CliCopy() {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(template.cliCommand);
    setCopied(true);
    trackEvent("copy cli command", {
      template: template.slug,
      location: "landing_page",
    });
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      data-template-cli-copy
      className="group flex min-h-11 w-full min-w-0 items-center gap-3 rounded-md border border-[var(--code-border)] bg-[var(--code-bg)] px-4 py-3 font-mono text-sm transition-colors hover:border-[var(--fg-secondary)] sm:max-w-[36rem] sm:px-5"
    >
      <span className="shrink-0 text-[var(--fg-secondary)]">$</span>
      <span
        data-template-cli-copy-text
        className="min-w-0 truncate text-[var(--fg)]"
      >
        {template.cliCommand}
      </span>
      <span className="ms-auto inline-flex size-5 shrink-0 items-center justify-center text-[var(--fg-secondary)]">
        {copied ? (
          <IconCheck aria-hidden="true" className="size-4" stroke={2} />
        ) : (
          <IconCopy aria-hidden="true" className="size-4" stroke={2} />
        )}
      </span>
    </button>
  );
}

const activationLinkClassName =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[var(--docs-border)] px-5 py-3 text-sm font-medium text-[var(--fg)] no-underline transition-colors hover:border-[var(--fg-secondary)] hover:no-underline";

const primaryLinkClassName =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[var(--fg)] px-5 py-3 text-sm font-medium text-[var(--bg)] no-underline transition-opacity hover:opacity-90 hover:no-underline";

export default function PlanTemplate() {
  const t = useT();
  const { locale } = useLocale();
  const capabilities = [
    {
      icon: IconLayoutKanban,
      title: t("templateLanding.plan.s020"),
      body: t("templateLanding.plan.s021"),
    },
    {
      icon: IconHierarchy,
      title: t("templateLanding.plan.s022"),
      body: t("templateLanding.plan.s023"),
    },
    {
      icon: IconBraces,
      title: t("templateLanding.plan.s024"),
      body: t("templateLanding.plan.s025"),
    },
    {
      icon: IconLink,
      title: t("templateLanding.plan.s026"),
      body: t("templateLanding.plan.s027"),
    },
    {
      icon: IconFolders,
      title: t("templateLanding.plan.s028"),
      body: t("templateLanding.plan.s029"),
    },
  ];
  const workflowSteps = [
    {
      step: "1",
      title: t("templateLanding.plan.s006"),
      body: t("templateLanding.plan.s007"),
    },
    {
      step: "2",
      title: t("templateLanding.plan.s008"),
      body: t("templateLanding.plan.s009"),
    },
    {
      step: "3",
      title: t("templateLanding.plan.s010"),
      body: t("templateLanding.plan.s011"),
    },
    {
      step: "4",
      title: t("templateLanding.plan.s012"),
      body: t("templateLanding.plan.s013"),
    },
  ];
  const faqItems = Array.from({ length: 6 }, (_, index) => {
    const itemNumber = index + 1;
    return {
      id: `plan-question-${itemNumber}`,
      question: t(`templateLanding.plan.faq.question${itemNumber}`),
      answer: (
        <p className="m-0">
          {t(`templateLanding.plan.faq.answer${itemNumber}`)}
        </p>
      ),
    };
  });

  return (
    <TemplateLandingShell>
      <TemplateHero
        eyebrow={
          <span style={{ color: template.color }}>
            {t("templateDetail.badge", { name: template.name })}
          </span>
        }
        title={t("templateLanding.plan.s015")}
        description={<p className="m-0">{t("templateLanding.plan.s016")}</p>}
        mediaClassName="bg-[var(--bg-secondary)]"
        media={
          <img
            src={template.screenshot}
            alt={t("templateLanding.plan.s001")}
            loading="lazy"
            decoding="async"
            className="h-auto max-h-[536px] w-full object-cover object-top"
          />
        }
      />

      <TemplateActivationFrame
        heading={
          <div>
            <h2 className="m-0 text-2xl font-medium leading-[1.15] tracking-tight text-[var(--fg)]">
              {t("templateLanding.plan.s006")}
            </h2>
            <p className="m-0 mt-3 text-base leading-[1.4] text-[var(--fg-secondary)]">
              {t("templateLanding.plan.s007")}
            </p>
          </div>
        }
      >
        <div className="grid w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
          <a
            href="https://plan.agent-native.com"
            target="_blank"
            rel="noopener noreferrer"
            className={primaryLinkClassName}
            onClick={(event) => {
              applyFirstTouchAttributionToLink(event.currentTarget);
              trackEvent("try live demo", {
                template: "plan",
                location: "landing_page",
              });
            }}
          >
            {t("templateLanding.plan.s017")}
            <IconArrowUpRight
              aria-hidden="true"
              className="size-4"
              stroke={2}
            />
          </a>
          <TemplateDocsLink
            template={template}
            location="landing_page"
            className={activationLinkClassName}
          />
          <div className="col-span-full min-w-0 lg:basis-full">
            <CliCopy />
          </div>
        </div>
      </TemplateActivationFrame>

      <SectionDivider showOnSmallScreens={false} />

      <section className="border-t border-[var(--docs-border)]">
        <TemplateStatOrStepsGrid className="sm:!grid-cols-4">
          {[
            { number: "10+", label: t("templateLanding.plan.s002") },
            { number: "3", label: t("templateLanding.plan.s003") },
            { number: "Live", label: t("templateLanding.plan.s004") },
            { number: "AI", label: t("templateLanding.plan.s005") },
          ].map((stat) => (
            <TemplateStatOrStepsGridItem key={stat.label}>
              <div
                className="text-3xl font-medium tracking-tight sm:text-4xl"
                style={{ color: template.color }}
              >
                {stat.number}
              </div>
              <div className="text-lg text-[var(--fg-secondary)] sm:text-xl">
                {stat.label}
              </div>
            </TemplateStatOrStepsGridItem>
          ))}
        </TemplateStatOrStepsGrid>
      </section>

      <SectionDivider showOnSmallScreens={false} />

      <TemplateCapabilityGrid
        intro={
          <>
            <h2 className="m-0 text-[1.75rem] font-medium leading-[1.15] tracking-tight text-[var(--fg)]">
              {t("templateLanding.plan.s018")}
            </h2>
            <p className="m-0 max-w-[320px] text-lg leading-[1.3] text-[var(--fg-secondary)]">
              {t("templateLanding.plan.s019")}
            </p>
          </>
        }
      >
        {capabilities.map(({ icon: Icon, title, body }) => (
          <div
            key={title}
            className="flex flex-col gap-6 border-b border-[var(--docs-border)] p-6 sm:border-e sm:p-8 sm:even:border-e-0 sm:[&:nth-child(5)]:border-b-0 sm:[&:nth-child(6)]:border-b-0"
          >
            <div
              className="inline-flex size-9 items-center justify-center rounded-md border border-[var(--docs-border)]"
              style={{ color: template.color }}
            >
              <Icon aria-hidden="true" className="size-[18px]" stroke={1.75} />
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="m-0 text-lg font-medium leading-[1.15] text-[var(--fg)]">
                {title}
              </h3>
              <p className="m-0 text-base leading-[1.4] text-[var(--fg-secondary)]">
                {body}
              </p>
            </div>
          </div>
        ))}
        <div className="flex flex-col gap-6 border-b border-[var(--docs-border)] p-6 sm:border-e sm:p-8 sm:even:border-e-0 sm:[&:nth-child(5)]:border-b-0 sm:[&:nth-child(6)]:border-b-0">
          <div
            className="inline-flex size-9 items-center justify-center rounded-md border border-[var(--docs-border)]"
            style={{ color: template.color }}
          >
            <IconBrandVisualStudio
              aria-hidden="true"
              className="size-[18px]"
              stroke={1.75}
            />
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="m-0 text-lg font-medium leading-[1.15] text-[var(--fg)]">
              {t("templateLanding.plan.s061")}
            </h3>
            <p className="m-0 text-base leading-[1.4] text-[var(--fg-secondary)]">
              {t("templateLanding.plan.s062")}{" "}
              <a
                href="https://marketplace.visualstudio.com/items?itemName=Builder.agent-native"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--fg)] underline underline-offset-2"
              >
                {t("templateLanding.plan.s063")}
              </a>
              {t("templateLanding.plan.s030")}
            </p>
          </div>
        </div>
      </TemplateCapabilityGrid>

      <SectionDivider showOnSmallScreens={false} />

      <section className="border-t border-[var(--docs-border)]">
        <div className="border-x border-[var(--docs-border)] px-6 pb-10 pt-16 sm:px-8 sm:pb-14 sm:pt-20">
          <h2 className="m-0 text-[1.75rem] font-medium leading-[1.05] tracking-tight text-[var(--fg)] sm:text-4xl">
            {t("templateLanding.plan.s031")}
          </h2>
          <p className="m-0 mt-4 max-w-2xl text-lg leading-[1.4] text-[var(--fg-secondary)]">
            {t("templateLanding.plan.s032")}
          </p>
        </div>
        <TemplateStatOrStepsGrid className="sm:!grid-cols-2 lg:!grid-cols-4">
          {workflowSteps.map((item, index) => (
            <TemplateStatOrStepsGridItem
              key={item.step}
              className={`${index > 1 ? "sm:!border-t" : "sm:!border-t-0"} ${
                index % 2 === 0 ? "sm:!border-s-0" : "sm:!border-s"
              } ${
                index > 0 ? "lg:!border-s" : "lg:!border-s-0"
              } lg:!border-t-0`}
            >
              <div
                className="font-mono text-sm font-semibold uppercase tracking-[0.14em]"
                style={{ color: template.color }}
              >
                {item.step}
              </div>
              <h3 className="m-0 text-xl font-medium leading-[1.15] text-[var(--fg)]">
                {item.title}
              </h3>
              <p className="m-0 text-base leading-[1.4] text-[var(--fg-secondary)]">
                {item.body}
              </p>
            </TemplateStatOrStepsGridItem>
          ))}
        </TemplateStatOrStepsGrid>
      </section>

      <SectionDivider showOnSmallScreens={false} />

      <TemplateSplitFeature
        leading={
          <div className="flex h-full flex-col px-6 py-10 sm:px-8 lg:px-10 lg:py-16">
            <h2 className="m-0 text-[1.75rem] font-medium leading-[1.15] text-[var(--fg)]">
              {t("templateLanding.plan.s033")}
            </h2>
            <p className="m-0 pt-5 text-lg leading-[1.3] text-[var(--fg-secondary)]">
              {t("templateLanding.plan.s034")}
            </p>
            <ul className="m-0 mt-6 list-none p-0 text-base leading-[1.4] text-[var(--fg-secondary)]">
              {[
                "s064",
                "s065",
                "s066",
                "s067",
                "s068",
                "s069",
                "s070",
                "s071",
              ].map((key) => (
                <li key={key} className="flex items-start gap-3 py-2">
                  <IconCheck
                    aria-hidden="true"
                    className="mt-0.5 size-5 shrink-0"
                    stroke={2}
                    style={{ color: template.color }}
                  />
                  {t(`templateLanding.plan.${key}`)}
                </li>
              ))}
            </ul>
          </div>
        }
        trailing={
          <div className="flex h-full items-center p-6 sm:p-8 lg:p-10">
            <div className="w-full overflow-x-auto border border-[var(--code-border)] bg-[var(--code-bg)] p-6 font-mono text-sm">
              <div className="mb-4 text-[var(--fg-secondary)]">
                {t("templateLanding.plan.s072")}
              </div>
              <div className="grid min-w-[24rem] gap-3 text-[var(--fg)]">
                <div>
                  <span style={{ color: template.color }}>type:</span>{" "}
                  {t("templateLanding.plan.s035")}
                </div>
                <div>
                  <span style={{ color: template.color }}>file:</span>{" "}
                  src/actions/create-post.ts
                </div>
                <div>
                  <span style={{ color: template.color }}>annotations:</span>
                </div>
                <div className="ps-4">
                  <span style={{ color: template.color }}>line 12:</span>{" "}
                  {t("templateLanding.plan.s036")}
                </div>
                <div className="ps-4">
                  <span style={{ color: template.color }}>line 24:</span>{" "}
                  {t("templateLanding.plan.s037")}
                </div>
                <div>
                  <span style={{ color: template.color }}>change:</span>{" "}
                  {t("templateLanding.plan.s038")}
                </div>
              </div>
            </div>
          </div>
        }
      />

      <SectionDivider showOnSmallScreens={false} />

      <section className="border-t border-[var(--docs-border)]">
        <div className="border-x border-[var(--docs-border)] px-6 pb-10 pt-16 sm:px-8 sm:pb-14 sm:pt-24 lg:pb-20 lg:pt-32">
          <h2 className="m-0 text-[1.75rem] font-medium leading-[1.05] tracking-tight text-[var(--fg)] sm:text-4xl lg:text-[2.875rem]">
            {t("templateLanding.plan.s039")}
          </h2>
        </div>
        <TemplateComparisonTable
          caption={t("templateLanding.plan.s039")}
          featureHeader={t("templateLanding.plan.s039")}
          columns={[
            {
              id: "markdown",
              header: t("templateLanding.plan.s040"),
            },
            {
              id: "canvas",
              header: t("templateLanding.plan.s073"),
            },
            {
              id: "agent-native",
              emphasized: true,
              header: (
                <span style={{ color: template.color }}>
                  Agent-Native Plans
                </span>
              ),
            },
          ]}
          rows={[
            {
              id: "visual-rendering",
              label: t("templateLanding.plan.s041"),
              cells: {
                markdown: t("templateLanding.plan.s042"),
                canvas: t("templateLanding.plan.s043"),
                "agent-native": t("templateLanding.plan.s044"),
              },
            },
            {
              id: "agent-update",
              label: t("templateLanding.plan.s045"),
              cells: {
                markdown: t("templateLanding.plan.s046"),
                canvas: t("templateLanding.plan.s047"),
                "agent-native": t("templateLanding.plan.s048"),
              },
            },
            {
              id: "shareable-link",
              label: t("templateLanding.plan.s049"),
              cells: {
                markdown: t("templateLanding.plan.s042"),
                canvas: t("templateLanding.plan.s050"),
                "agent-native": t("templateLanding.plan.s051"),
              },
            },
            {
              id: "prototype-runner",
              label: t("templateLanding.plan.s005"),
              cells: {
                markdown: t("templateLanding.plan.s042"),
                canvas: t("templateLanding.plan.s042"),
                "agent-native": t("templateLanding.plan.s052"),
              },
            },
            {
              id: "agent-integrations",
              label: t("templateLanding.plan.s053"),
              cells: {
                markdown: t("templateLanding.plan.s050"),
                canvas: t("templateLanding.plan.s042"),
                "agent-native": t("templateLanding.plan.s054"),
              },
            },
            {
              id: "open-source",
              label: t("templateLanding.plan.s055"),
              cells: {
                markdown: t("templateLanding.plan.s074"),
                canvas: t("templateLanding.plan.s042"),
                "agent-native": t("templateLanding.plan.s056"),
              },
            },
          ]}
        />
      </section>

      <TemplateFinalCta
        eyebrow={
          <span
            className="font-mono text-sm font-semibold uppercase tracking-[0.14em]"
            style={{ color: template.color }}
          >
            Agent-Native {template.name}
          </span>
        }
        title={t("templateLanding.plan.s057")}
        actions={
          <>
            <TemplateDocsLink
              template={template}
              location="landing_page_cta"
              className={primaryLinkClassName}
            >
              {t("templateLanding.plan.s059")}
            </TemplateDocsLink>
            <Link
              data-an-prefetch="viewport"
              to={sitePathForLocale("/apps", locale)}
              className={activationLinkClassName}
            >
              {t("templateLanding.plan.s060")}
            </Link>
          </>
        }
      >
        <p className="m-0 max-w-2xl px-6 text-lg leading-[1.4] text-[var(--fg-secondary)] sm:px-8">
          {t("templateLanding.plan.s058")}
        </p>
      </TemplateFinalCta>

      <SectionDivider showOnSmallScreens={false} />

      <TemplateLandingFaq
        idPrefix="plan-faq"
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
