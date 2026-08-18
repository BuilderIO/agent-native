import { useLocale, useT } from "@agent-native/core/client/i18n";
import {
  IconBrandSlack,
  IconCheck,
  IconClock,
  IconHierarchy,
  IconShieldCheck,
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
        title:
          "Agent-Native Dispatch — Open Source Slack & Telegram Agent Router",
      },
      {
        name: "description",
        content:
          "Your agent's home base. Talk to it from Slack, Telegram, or any messenger and it routes to your other agents. Jobs, memory, approvals, and A2A delegation built in. The central hub for all your agent-native apps.",
      },
      {
        property: "og:title",
        content:
          "Agent-Native Dispatch — Open Source Slack & Telegram Agent Router",
      },
      {
        property: "og:description",
        content:
          "Talk to your agent from any messenger. Jobs, memory, approvals, and A2A delegation — the central router for your agent-native apps.",
      },
      {
        name: "keywords",
        content:
          "Slack agent, Telegram agent, agent router, A2A protocol, agent-to-agent, AI orchestration, AI assistant Slack, agent memory, recurring jobs agent, AI approvals, agent-native dispatch",
      },
    ],
    "Dispatch",
  );

const template = templates.find((t) => t.slug === "dispatch")!;

const activationLinkClassName = "secondary-button";

const primaryLinkClassName = "primary-button";

export default function DispatchTemplate() {
  const t = useT();
  const { locale } = useLocale();
  const capabilities = [
    {
      icon: IconBrandSlack,
      title: "Slack & Telegram",
      body: t("templateLanding.dispatch.s012"),
    },
    {
      icon: IconHierarchy,
      title: "A2A Delegation",
      body: t("templateLanding.dispatch.s013"),
    },
    {
      icon: IconClock,
      title: t("templateLanding.dispatch.s014"),
      body: t("templateLanding.dispatch.s015"),
    },
    {
      icon: IconShieldCheck,
      title: t("templateLanding.dispatch.s016"),
      body: t("templateLanding.dispatch.s017"),
    },
  ];
  const faqItems = Array.from({ length: 6 }, (_, index) => {
    const itemNumber = index + 1;
    return {
      id: `dispatch-question-${itemNumber}`,
      question: t(`templateLanding.dispatch.faq.question${itemNumber}`),
      answer: (
        <p className="m-0">
          {t(`templateLanding.dispatch.faq.answer${itemNumber}`)}
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
        title={t("templateLanding.dispatch.s007")}
        description={
          <p className="m-0">{t("templateLanding.dispatch.s008")}</p>
        }
        media={
          <img
            src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F6323f9166bd348a49ee0a4640e90c4a9?format=webp&width=800&height=1200"
            crossOrigin="anonymous"
            alt={t("templateLanding.dispatch.s001")}
            loading="lazy"
            decoding="async"
            className="h-auto max-h-[536px] w-full object-cover object-top"
          />
        }
      />

      <TemplateActivationFrame
        heading={
          <h2 className="m-0 text-2xl font-medium leading-[1.15] tracking-tight text-[var(--fg)]">
            {t("templateLanding.dispatch.s009")}
          </h2>
        }
      >
        <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-center sm:gap-[120px]">
          <a
            href="https://dispatch.agent-native.com"
            target="_blank"
            rel="noopener noreferrer"
            className={primaryLinkClassName}
            onClick={(event) => {
              applyFirstTouchAttributionToLink(event.currentTarget);
              trackEvent("try live demo", {
                template: "dispatch",
                location: "landing_page",
              });
            }}
          >
            {t("templateLanding.dispatch.s009")}
          </a>
          <TemplateDocsLink
            template={template}
            location="landing_page"
            className={activationLinkClassName}
          />
        </div>
      </TemplateActivationFrame>

      <SectionDivider showOnSmallScreens={false} />

      <section className="border-t border-[var(--docs-border)]">
        <TemplateStatOrStepsGrid className="sm:!grid-cols-4">
          {[
            { number: "Slack", label: t("templateLanding.dispatch.s002") },
            { number: "A2A", label: t("templateLanding.dispatch.s003") },
            { number: "∞", label: t("templateLanding.dispatch.s004") },
            { number: "Cron", label: t("templateLanding.dispatch.s005") },
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
              {t("templateLanding.dispatch.s010")}
            </h2>
            <p className="m-0 max-w-[320px] text-lg leading-[1.3] text-[var(--fg-secondary)]">
              {t("templateLanding.dispatch.s011")}
            </p>
          </>
        }
      >
        {capabilities.map(({ icon: Icon, title, body }, index) => (
          <div
            key={title}
            className={`flex flex-col gap-6 border-b border-[var(--docs-border)] p-6 sm:border-e sm:p-8 sm:even:border-e-0 sm:[&:nth-child(3)]:border-b-0 sm:[&:nth-child(4)]:border-b-0 ${
              [1, 2].includes(index)
                ? "!border !border-[var(--docs-border)] sm:!border"
                : ""
            }`}
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
      </TemplateCapabilityGrid>

      <SectionDivider showOnSmallScreens={false} />

      <TemplateSplitFeature
        leading={
          <div className="flex h-full flex-col px-6 py-10 sm:px-8 lg:px-10 lg:py-16">
            <h3 className="m-0 text-[1.75rem] font-medium leading-[1.15] text-[var(--fg)]">
              {t("templateLanding.dispatch.s018")}
            </h3>
            <p className="m-0 pt-5 text-lg leading-[1.3] text-[var(--fg-secondary)]">
              {t("templateLanding.dispatch.s019")}
            </p>
            <ul className="m-0 mt-6 list-none p-0 text-base leading-[1.4] text-[var(--fg-secondary)]">
              {["s020", "s021", "s022"].map((key) => (
                <li key={key} className="flex items-start gap-3 py-2">
                  <IconCheck
                    aria-hidden="true"
                    className="mt-0.5 size-5 shrink-0"
                    stroke={2}
                    style={{ color: template.color }}
                  />
                  {t(`templateLanding.dispatch.${key}`)}
                </li>
              ))}
            </ul>
          </div>
        }
        trailing={
          <div className="flex h-full flex-col px-6 py-10 sm:px-8 lg:px-10 lg:py-16">
            <h3 className="m-0 text-[1.75rem] font-medium leading-[1.15] text-[var(--fg)]">
              {t("templateLanding.dispatch.s023")}
            </h3>
            <p className="m-0 pt-5 text-lg leading-[1.3] text-[var(--fg-secondary)]">
              {t("templateLanding.dispatch.s024")}
            </p>
            <ul className="m-0 mt-6 list-none p-0 text-base leading-[1.4] text-[var(--fg-secondary)]">
              {["s025", "s026", "s027"].map((key) => (
                <li key={key} className="flex items-start gap-3 py-2">
                  <IconCheck
                    aria-hidden="true"
                    className="mt-0.5 size-5 shrink-0"
                    stroke={2}
                    style={{ color: template.color }}
                  />
                  {t(`templateLanding.dispatch.${key}`)}
                </li>
              ))}
            </ul>
          </div>
        }
      />

      <SectionDivider showOnSmallScreens={false} />

      <TemplateSplitFeature
        leading={
          <div className="flex h-full flex-col justify-center px-6 py-10 sm:px-8 lg:px-10 lg:py-16">
            <h2 className="m-0 text-[1.75rem] font-medium leading-[1.15] text-[var(--fg)]">
              {t("templateLanding.dispatch.s028")}
            </h2>
            <p className="m-0 pt-5 text-lg leading-[1.3] text-[var(--fg-secondary)]">
              {t("templateLanding.dispatch.s029")}
            </p>
            <ul className="m-0 mt-6 list-none p-0 text-base leading-[1.4] text-[var(--fg-secondary)]">
              {["s030", "s031", "s032", "s033"].map((key) => (
                <li key={key} className="flex items-start gap-3 py-2">
                  <IconCheck
                    aria-hidden="true"
                    className="mt-0.5 size-5 shrink-0"
                    stroke={2}
                    style={{ color: template.color }}
                  />
                  {t(`templateLanding.dispatch.${key}`)}
                </li>
              ))}
            </ul>
          </div>
        }
        trailing={
          <div className="flex h-full items-center p-6 sm:p-8 lg:p-10">
            <div className="w-full overflow-x-auto border border-[var(--code-border)] bg-[var(--code-bg)] p-6 font-mono text-sm">
              <div className="mb-4 text-[var(--fg-secondary)]">
                {"// Available agent actions"}
              </div>
              <div className="grid min-w-[28rem] gap-3 text-[var(--fg)]">
                <div>
                  <span style={{ color: template.color }}>$</span> pnpm action
                  route --target slides
                </div>
                <div>
                  <span style={{ color: template.color }}>$</span> pnpm action
                  schedule --cron "0 9 * * 1-5"
                </div>
                <div>
                  <span style={{ color: template.color }}>$</span> pnpm action
                  remember --scope user
                </div>
                <div>
                  <span style={{ color: template.color }}>$</span> pnpm action
                  approve --action send-email
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
            {t("templateLanding.dispatch.s034")}
          </h2>
        </div>
        <TemplateComparisonTable
          caption={t("templateLanding.dispatch.s034")}
          featureHeader={t("templateLanding.dispatch.s034")}
          columns={[
            { id: "slack-bots", header: "Slack Bots" },
            {
              id: "closed-assistants",
              header: t("templateLanding.dispatch.s035"),
            },
            {
              id: "agent-native",
              emphasized: true,
              agentNative: { color: template.color, name: template.name },
            },
          ]}
          rows={[
            {
              id: "cross-app-routing",
              label: t("templateLanding.dispatch.s036"),
              cells: {
                "slack-bots": t("templateLanding.dispatch.s037"),
                "closed-assistants": t("templateLanding.dispatch.s038"),
                "agent-native": "A2A to any agent-native app",
              },
            },
            {
              id: "memory",
              label: t("templateLanding.dispatch.s004"),
              cells: {
                "slack-bots": "None",
                "closed-assistants": t("templateLanding.dispatch.s039"),
                "agent-native": t("templateLanding.dispatch.s040"),
              },
            },
            {
              id: "recurring-jobs",
              label: t("templateLanding.dispatch.s005"),
              cells: {
                "slack-bots": t("templateLanding.dispatch.s041"),
                "closed-assistants": t("templateLanding.dispatch.s042"),
                "agent-native": "Cron + agent loop",
              },
            },
            {
              id: "customization",
              label: t("templateLanding.dispatch.s043"),
              cells: {
                "slack-bots": t("templateLanding.dispatch.s044"),
                "closed-assistants": t("templateLanding.dispatch.s045"),
                "agent-native": t("templateLanding.dispatch.s046"),
              },
            },
            {
              id: "pricing",
              label: t("templateLanding.dispatch.s047"),
              cells: {
                "slack-bots": t("templateLanding.dispatch.s048"),
                "closed-assistants": t("templateLanding.dispatch.s049"),
                "agent-native": t("templateLanding.dispatch.s050"),
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
        title={t("templateLanding.dispatch.s051")}
        actions={
          <>
            <a
              href={`${template.demoUrl}/_agent-native/sign-in`}
              target="_blank"
              rel="noopener noreferrer"
              className={primaryLinkClassName}
            >
              {t("common.signIn")}
            </a>
            <Link
              data-an-prefetch="viewport"
              to={sitePathForLocale("/apps", locale)}
              className={activationLinkClassName}
            >
              View more apps
            </Link>
          </>
        }
      >
        <p className="m-0 max-w-2xl px-6 text-lg leading-[1.4] text-[var(--fg-secondary)] sm:px-8">
          {t("templateLanding.dispatch.s052")}
        </p>
      </TemplateFinalCta>

      <TemplateLandingFaq
        idPrefix="dispatch-faq"
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
