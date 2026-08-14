import { useLocale, useT } from "@agent-native/core/client/i18n";
import {
  IconArrowUpRight,
  IconCalendar,
  IconCheck,
  IconCode,
  IconCopy,
  IconMessage,
  IconUserPlus,
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
          "Agent-Native Calendar — Open Source Alternative to Google Calendar & Calendly",
      },
      {
        name: "description",
        content:
          "Build an AI-powered calendar you own. Open source alternative to Google Calendar and Calendly. Google Calendar sync, public booking pages, configurable availability, and natural language scheduling.",
      },
      {
        property: "og:title",
        content:
          "Agent-Native Calendar — Open Source Alternative to Google Calendar & Calendly",
      },
      {
        property: "og:description",
        content:
          "Build an AI-powered calendar you own. Google Calendar sync, public booking pages, and natural language scheduling.",
      },
      {
        name: "keywords",
        content:
          "AI calendar, open source calendar, Google Calendar alternative, Calendly alternative, AI scheduling, agent-native calendar, AI booking page, open source scheduling, AI appointment booking, natural language scheduling",
      },
    ],
    "Calendar",
  );

const template = templates.find((t) => t.slug === "calendar")!;

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

export default function CalendarTemplate() {
  const t = useT();
  const { locale } = useLocale();
  const capabilities = [
    {
      icon: IconCalendar,
      title: t("templateLanding.calendar.s012"),
      body: t("templateLanding.calendar.s013"),
    },
    {
      icon: IconMessage,
      title: t("templateLanding.calendar.s014"),
      body: t("templateLanding.calendar.s015"),
    },
    {
      icon: IconUserPlus,
      title: t("templateLanding.calendar.s016"),
      body: t("templateLanding.calendar.s017"),
    },
    {
      icon: IconCode,
      title: t("templateLanding.calendar.s018"),
      body: t("templateLanding.calendar.s019"),
    },
  ];
  const faqItems = Array.from({ length: 4 }, (_, index) => {
    const itemNumber = index + 1;
    return {
      id: `calendar-question-${itemNumber}`,
      question: t(`templateLanding.calendar.faq.question${itemNumber}`),
      answer: (
        <p className="m-0">
          {t(`templateLanding.calendar.faq.answer${itemNumber}`)}
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
        title={t("templateLanding.calendar.s006")}
        description={
          <p className="m-0">{t("templateLanding.calendar.s007")}</p>
        }
        mediaClassName="bg-[var(--bg-secondary)]"
        media={
          <img
            src={template.screenshot}
            alt={t("templateLanding.calendar.s001")}
            loading="lazy"
            decoding="async"
            className="h-auto max-h-[536px] w-full object-cover object-top"
          />
        }
      />

      <TemplateActivationFrame
        heading={
          <h2 className="m-0 text-2xl font-medium leading-[1.15] tracking-tight text-[var(--fg)]">
            {t("templateLanding.calendar.s008")}
          </h2>
        }
      >
        <div className="grid w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
          <a
            href="https://calendar.agent-native.com"
            target="_blank"
            rel="noopener noreferrer"
            className={primaryLinkClassName}
            onClick={(event) => {
              applyFirstTouchAttributionToLink(event.currentTarget);
              trackEvent("try live demo", {
                template: "calendar",
                location: "landing_page",
              });
            }}
          >
            {t("templateLanding.calendar.s008")}
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

      <section className="border-t border-[var(--docs-border)]">
        <div className="border-x border-b border-[var(--docs-border)] px-6 py-8 sm:px-8 lg:px-10">
          <h2 className="mb-2 text-lg font-medium text-[var(--fg)]">
            {t("templateLanding.calendar.s057")}
          </h2>
          <p className="m-0 max-w-3xl text-base leading-relaxed text-[var(--fg-secondary)]">
            {t("templateLanding.calendar.s009")}
          </p>
        </div>
      </section>

      <SectionDivider showOnSmallScreens={false} />

      <section className="border-t border-[var(--docs-border)]">
        <TemplateStatOrStepsGrid className="sm:!grid-cols-4">
          {[
            { number: "3", label: t("templateLanding.calendar.s002") },
            { number: "4", label: t("templateLanding.calendar.s003") },
            { number: "N", label: t("templateLanding.calendar.s004") },
            { number: "2-way", label: t("templateLanding.calendar.s058") },
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
              {t("templateLanding.calendar.s010")}
            </h2>
            <p className="m-0 max-w-[320px] text-lg leading-[1.3] text-[var(--fg-secondary)]">
              {t("templateLanding.calendar.s011")}
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

      <TemplateSplitFeature
        leading={
          <div className="flex h-full flex-col px-6 py-10 sm:px-8 lg:px-10 lg:py-16">
            <h3 className="m-0 text-[1.75rem] font-medium leading-[1.15] text-[var(--fg)]">
              Google Calendar Sync
            </h3>
            <p className="m-0 pt-5 text-lg leading-[1.3] text-[var(--fg-secondary)]">
              {t("templateLanding.calendar.s020")}
            </p>
            <ul className="m-0 mt-6 list-none p-0 text-base leading-[1.4] text-[var(--fg-secondary)]">
              {["s021", "s022", "s023"].map((key) => (
                <li key={key} className="flex items-start gap-3 py-2">
                  <IconCheck
                    aria-hidden="true"
                    className="mt-0.5 size-5 shrink-0"
                    stroke={2}
                    style={{ color: template.color }}
                  />
                  {t(`templateLanding.calendar.${key}`)}
                </li>
              ))}
            </ul>
          </div>
        }
        trailing={
          <div className="flex h-full flex-col px-6 py-10 sm:px-8 lg:px-10 lg:py-16">
            <h3 className="m-0 text-[1.75rem] font-medium leading-[1.15] text-[var(--fg)]">
              Calendly-Style Booking
            </h3>
            <p className="m-0 pt-5 text-lg leading-[1.3] text-[var(--fg-secondary)]">
              {t("templateLanding.calendar.s024")}
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
                  {t(`templateLanding.calendar.${key}`)}
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
              {t("templateLanding.calendar.s028")}
            </h2>
            <p className="m-0 pt-5 text-lg leading-[1.3] text-[var(--fg-secondary)]">
              {t("templateLanding.calendar.s029")}
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
                  {t(`templateLanding.calendar.${key}`)}
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
              <div className="grid min-w-[32rem] gap-3 text-[var(--fg)]">
                <div>
                  <span style={{ color: template.color }}>$</span> pnpm action
                  sync-google-calendar --from 2026-01-01 --to 2026-06-01
                </div>
                <div>
                  <span style={{ color: template.color }}>$</span> pnpm action
                  create-event --title "Team Standup" --start "2026-03-15T09:00"
                </div>
                <div>
                  <span style={{ color: template.color }}>$</span> pnpm action
                  check-availability --date "2026-03-18" --duration 30
                </div>
                <div>
                  <span style={{ color: template.color }}>$</span> pnpm action
                  list-events --from "2026-03-14" --to "2026-03-21"
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
            {t("templateLanding.calendar.s034")}
          </h2>
        </div>
        <TemplateComparisonTable
          caption={t("templateLanding.calendar.s034")}
          featureHeader={t("templateLanding.calendar.s034")}
          columns={[
            { id: "google", header: "Google Calendar" },
            { id: "calendly", header: "Calendly" },
            {
              id: "agent-native",
              emphasized: true,
              header: (
                <span style={{ color: template.color }}>
                  Agent-Native Calendar
                </span>
              ),
            },
          ]}
          rows={[
            {
              id: "calendar-ui",
              label: t("templateLanding.calendar.s035"),
              cells: {
                google: t("templateLanding.calendar.s036"),
                calendly: t("templateLanding.calendar.s037"),
                "agent-native": t("templateLanding.calendar.s038"),
              },
            },
            {
              id: "ai-scheduling",
              label: t("templateLanding.calendar.s039"),
              cells: {
                google: "None",
                calendly: "None",
                "agent-native": t("templateLanding.calendar.s040"),
              },
            },
            {
              id: "booking-page",
              label: t("templateLanding.calendar.s041"),
              cells: {
                google: t("templateLanding.calendar.s042"),
                calendly: t("templateLanding.calendar.s043"),
                "agent-native": t("templateLanding.calendar.s044"),
              },
            },
            {
              id: "customization",
              label: t("templateLanding.calendar.s045"),
              cells: {
                google: t("templateLanding.calendar.s046"),
                calendly: t("templateLanding.calendar.s047"),
                "agent-native": t("templateLanding.calendar.s048"),
              },
            },
            {
              id: "pricing",
              label: t("templateLanding.calendar.s049"),
              cells: {
                google: t("templateLanding.calendar.s050"),
                calendly: t("templateLanding.calendar.s051"),
                "agent-native": t("templateLanding.calendar.s052"),
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
        title={t("templateLanding.calendar.s053")}
        actions={
          <>
            <TemplateDocsLink
              template={template}
              location="landing_page_cta"
              className={primaryLinkClassName}
            >
              {t("templateLanding.calendar.s055")}
            </TemplateDocsLink>
            <Link
              data-an-prefetch="viewport"
              to={sitePathForLocale("/apps", locale)}
              className={activationLinkClassName}
            >
              {t("templateLanding.calendar.s056")}
            </Link>
          </>
        }
      >
        <p className="m-0 max-w-2xl px-6 text-lg leading-[1.4] text-[var(--fg-secondary)] sm:px-8">
          {t("templateLanding.calendar.s054")}
        </p>
      </TemplateFinalCta>

      <SectionDivider showOnSmallScreens={false} />

      <TemplateLandingFaq
        idPrefix="calendar-faq"
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
