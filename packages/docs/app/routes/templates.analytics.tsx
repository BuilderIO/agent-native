import { useLocale, useT } from "@agent-native/core/client/i18n";
import {
  IconChartBar,
  IconCheck,
  IconCode,
  IconDatabaseSearch,
  IconLayoutDashboard,
  IconMessage,
  IconPlugConnected,
  IconSearch,
} from "@tabler/icons-react";
import { Link } from "react-router";

import { sitePathForLocale } from "../components/docs-locale";
import { applyFirstTouchAttributionToLink } from "../components/marketing-attribution";
import { SectionDivider } from "../components/SectionDivider";
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
          "Agent-Native Analytics — Open Source Alternative to Amplitude & FullStory",
      },
      {
        name: "description",
        content:
          "Build AI-powered analytics dashboards you own. Open source alternative to Amplitude and FullStory. Multiple data connectors, SQL query explorer, reusable dashboards, data dictionary, and natural language chart generation.",
      },
      {
        property: "og:title",
        content:
          "Agent-Native Analytics — Open Source Alternative to Amplitude & FullStory",
      },
      {
        property: "og:description",
        content:
          "Build AI-powered analytics dashboards you own. Multiple data connectors, SQL query explorer, and natural language chart generation.",
      },
      {
        name: "keywords",
        content:
          "AI analytics, open source analytics, Amplitude alternative, FullStory alternative, Mixpanel alternative, Looker alternative, AI dashboard builder, AI data visualization, agent-native analytics, AI-powered BI tool, open source business intelligence, AI chart generator, natural language SQL, BigQuery dashboard",
      },
    ],
    "Analytics",
  );

const template = templates.find((t) => t.slug === "analytics")!;

const activationLinkClassName = "secondary-button";

const primaryLinkClassName = "primary-button";

export default function AnalyticsTemplate() {
  const t = useT();
  const { locale } = useLocale();
  const capabilities = [
    {
      icon: IconMessage,
      title: t("templateLanding.analytics.s012"),
      body: t("templateLanding.analytics.s013"),
    },
    {
      icon: IconLayoutDashboard,
      title: t("templateLanding.analytics.s014"),
      body: t("templateLanding.analytics.s015"),
    },
    {
      icon: IconDatabaseSearch,
      title: "SQL Query Explorer",
      body: t("templateLanding.analytics.s016"),
    },
    {
      icon: IconCode,
      title: t("templateLanding.analytics.s017"),
      body: t("templateLanding.analytics.s018"),
    },
  ];
  const connectors = [
    {
      icon: IconChartBar,
      title: t("templateLanding.analytics.s021"),
      body: "HubSpot, Stripe, Apollo — deals, subscriptions, MRR, and enrichment.",
    },
    {
      icon: IconCode,
      title: t("templateLanding.analytics.s022"),
      body: t("templateLanding.analytics.s023"),
    },
    {
      icon: IconDatabaseSearch,
      title: t("templateLanding.analytics.s024"),
      body: "Google Cloud, Grafana — services, metrics, logs, and alerts.",
    },
    {
      icon: IconMessage,
      title: t("templateLanding.analytics.s025"),
      body: "Slack, Gong, Twitter — channel history, call transcripts, and social metrics.",
    },
    {
      icon: IconSearch,
      title: t("templateLanding.analytics.s026"),
      body: "Notion, DataForSEO — content calendars, keywords, and top search terms.",
    },
    {
      icon: IconPlugConnected,
      title: t("templateLanding.analytics.s027"),
      body: "Common Room, Pylon — member engagement and support tickets.",
    },
  ];
  const faqItems = Array.from({ length: 5 }, (_, index) => {
    const itemNumber = index + 1;
    return {
      id: `analytics-question-${itemNumber}`,
      question: t(`templateLanding.analytics.faq.question${itemNumber}`),
      answer: (
        <p className="m-0">
          {t(`templateLanding.analytics.faq.answer${itemNumber}`)}
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
        title={t("templateLanding.analytics.s007")}
        description={
          <p className="m-0">{t("templateLanding.analytics.s008")}</p>
        }
        headingAction={
          <a
            href="https://analytics.agent-native.com"
            target="_blank"
            rel="noopener noreferrer"
            className={primaryLinkClassName}
            onClick={(event) => {
              applyFirstTouchAttributionToLink(event.currentTarget);
              trackEvent("try live demo", {
                template: "analytics",
                location: "landing_page_hero",
              });
            }}
          >
            Talk to Your Data
          </a>
        }
        media={
          <img
            src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Ff1e7ffee62d64d26b0411c1f6a50e1e1?format=webp&width=800&height=1200"
            crossOrigin="anonymous"
            alt={t("templateLanding.analytics.s001")}
            loading="lazy"
            decoding="async"
            className="h-auto max-h-[536px] w-full object-cover object-top"
          />
        }
      />

      <TemplateActivationFrame>
        <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-center sm:gap-[120px]">
          <a
            href="https://analytics.agent-native.com"
            target="_blank"
            rel="noopener noreferrer"
            className={primaryLinkClassName}
            onClick={(event) => {
              applyFirstTouchAttributionToLink(event.currentTarget);
              trackEvent("try live demo", {
                template: "analytics",
                location: "landing_page",
              });
            }}
          >
            Talk to Your Data
          </a>
        </div>
      </TemplateActivationFrame>

      <SectionDivider showOnSmallScreens={false} />

      <section className="border-t border-[var(--docs-border)]">
        <TemplateStatOrStepsGrid className="sm:!grid-cols-4">
          {[
            { number: "10+", label: t("templateLanding.analytics.s002") },
            { number: "7", label: t("templateLanding.analytics.s003") },
            { number: "SQL", label: t("templateLanding.analytics.s004") },
            { number: "AI", label: t("templateLanding.analytics.s005") },
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
              {t("templateLanding.analytics.s010")}
            </h2>
            <p className="m-0 max-w-[320px] text-lg leading-[1.3] text-[var(--fg-secondary)]">
              {t("templateLanding.analytics.s011")}
            </p>
          </>
        }
      >
        {capabilities.map(({ icon: Icon, title, body }) => (
          <div
            key={title}
            className="flex flex-col gap-6 border-b border-[var(--docs-border)] p-6 sm:border-e sm:p-8 sm:even:border-e-0 sm:[&:nth-child(3)]:border-b-0 sm:[&:nth-child(4)]:border-b-0"
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

      <TemplateCapabilityGrid
        intro={
          <>
            <h2 className="m-0 text-[1.75rem] font-medium leading-[1.15] tracking-tight text-[var(--fg)]">
              {t("templateLanding.analytics.s019")}
            </h2>
            <p className="m-0 max-w-[320px] text-lg leading-[1.3] text-[var(--fg-secondary)]">
              {t("templateLanding.analytics.s020")}
            </p>
          </>
        }
      >
        {connectors.map(({ icon: Icon, title, body }) => (
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
      </TemplateCapabilityGrid>

      <SectionDivider showOnSmallScreens={false} />

      <TemplateSplitFeature
        leading={
          <div className="flex h-full flex-col justify-center px-6 py-10 sm:px-8 lg:px-10 lg:py-16">
            <h2 className="m-0 text-[1.75rem] font-medium leading-[1.15] text-[var(--fg)]">
              {t("templateLanding.analytics.s028")}
            </h2>
            <p className="m-0 pt-5 text-lg leading-[1.3] text-[var(--fg-secondary)]">
              {t("templateLanding.analytics.s029")}
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
                  {t(`templateLanding.analytics.${key}`)}
                </li>
              ))}
            </ul>
          </div>
        }
        trailing={
          <div className="flex h-full items-center p-6 sm:p-8 lg:p-10">
            <div className="w-full overflow-x-auto border border-[var(--code-border)] bg-[var(--code-bg)] p-6 font-mono text-sm">
              <div className="mb-4 text-[var(--fg-secondary)]">
                {"// Example metric definition"}
              </div>
              <div className="grid min-w-[24rem] gap-3 text-[var(--fg)]">
                <div>
                  <span style={{ color: template.color }}>name:</span>{" "}
                  {t("templateLanding.analytics.s034")}
                </div>
                <div>
                  <span style={{ color: template.color }}>query:</span> SELECT
                  COUNT(DISTINCT user_id)...
                </div>
                <div>
                  <span style={{ color: template.color }}>frequency:</span>{" "}
                  {t("templateLanding.analytics.s035")}
                </div>
                <div>
                  <span style={{ color: template.color }}>lag:</span>{" "}
                  {t("templateLanding.analytics.s036")}
                </div>
                <div>
                  <span style={{ color: template.color }}>gotchas:</span>{" "}
                  {t("templateLanding.analytics.s037")}
                </div>
                <div>
                  <span style={{ color: template.color }}>trust:</span>{" "}
                  {t("templateLanding.analytics.s038")}
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
            {t("templateLanding.analytics.s039")}
          </h2>
        </div>
        <TemplateComparisonTable
          caption={t("templateLanding.analytics.s039")}
          featureHeader={t("templateLanding.analytics.s039")}
          columns={[
            { id: "product-analytics", header: "Amplitude / Mixpanel" },
            { id: "chat-csv", header: "ChatGPT + CSV" },
            {
              id: "agent-native",
              emphasized: true,
              agentNative: { color: template.color, name: template.name },
            },
          ]}
          rows={[
            {
              id: "dashboard-ui",
              label: t("templateLanding.analytics.s040"),
              cells: {
                "product-analytics": t("templateLanding.analytics.s041"),
                "chat-csv": t("templateLanding.analytics.s042"),
                "agent-native": t("templateLanding.analytics.s043"),
              },
            },
            {
              id: "natural-language",
              label: t("templateLanding.analytics.s005"),
              cells: {
                "product-analytics": t("templateLanding.analytics.s044"),
                "chat-csv": t("templateLanding.analytics.s045"),
                "agent-native": t("templateLanding.analytics.s046"),
              },
            },
            {
              id: "data-connectors",
              label: t("templateLanding.analytics.s002"),
              cells: {
                "product-analytics": t("templateLanding.analytics.s047"),
                "chat-csv": t("templateLanding.analytics.s048"),
                "agent-native": t("templateLanding.analytics.s049"),
              },
            },
            {
              id: "data-dictionary",
              label: t("templateLanding.analytics.s050"),
              cells: {
                "product-analytics": t("templateLanding.analytics.s051"),
                "chat-csv": "None",
                "agent-native": t("templateLanding.analytics.s052"),
              },
            },
            {
              id: "customization",
              label: t("templateLanding.analytics.s053"),
              cells: {
                "product-analytics": t("templateLanding.analytics.s054"),
                "chat-csv": t("templateLanding.analytics.s055"),
                "agent-native": t("templateLanding.analytics.s056"),
              },
            },
            {
              id: "pricing",
              label: t("templateLanding.analytics.s057"),
              cells: {
                "product-analytics": t("templateLanding.analytics.s058"),
                "chat-csv": t("templateLanding.analytics.s059"),
                "agent-native": t("templateLanding.analytics.s060"),
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
        title={t("templateLanding.analytics.s061")}
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
          {t("templateLanding.analytics.s062")}
        </p>
      </TemplateFinalCta>

      <TemplateLandingFaq
        idPrefix="analytics-faq"
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
