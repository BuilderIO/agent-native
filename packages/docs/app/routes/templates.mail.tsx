import { useLocale, useT } from "@agent-native/core/client/i18n";
import {
  IconArrowUpRight,
  IconCheck,
  IconCode,
  IconCopy,
  IconKeyboard,
  IconMailAi,
  IconSearch,
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
          "Agent-Native Mail — Open Source Alternative to Gmail & Superhuman",
      },
      {
        name: "description",
        content:
          "Build an AI-powered email client you own. Superhuman-style keyboard shortcuts, AI triage, smart search, and a fully customizable interface. Open source alternative to Gmail and Superhuman.",
      },
      {
        property: "og:title",
        content:
          "Agent-Native Mail — Open Source Alternative to Gmail & Superhuman",
      },
      {
        property: "og:description",
        content:
          "Superhuman-style email client with keyboard shortcuts, AI triage, and a fully customizable interface. Own your inbox workflow.",
      },
      {
        name: "keywords",
        content:
          "AI email client, open source email, Gmail alternative, Superhuman alternative, AI inbox, keyboard shortcuts email, agent-native mail, AI email triage, smart inbox, natural language email",
      },
    ],
    "Mail",
  );

const template = templates.find((t) => t.slug === "mail")!;

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

export default function MailTemplate() {
  const t = useT();
  const { locale } = useLocale();
  const capabilities = [
    {
      icon: IconKeyboard,
      title: t("templateLanding.mail.s012"),
      body: (
        <>
          Superhuman-style bindings for compose, archive, reply, and navigation.
          Zero mouse required.
        </>
      ),
    },
    {
      icon: IconMailAi,
      title: t("templateLanding.mail.s013"),
      body: t("templateLanding.mail.s014"),
    },
    {
      icon: IconSearch,
      title: t("templateLanding.mail.s015"),
      body: t("templateLanding.mail.s016"),
    },
    {
      icon: IconCode,
      title: t("templateLanding.mail.s017"),
      body: t("templateLanding.mail.s018"),
    },
  ];
  const faqItems = [
    {
      id: "mail-question-1",
      question: t("templateLanding.faq.question1"),
      answer: <p className="m-0">{t("templateLanding.faq.answer1")}</p>,
    },
    {
      id: "mail-question-2",
      question: t("templateLanding.faq.question2"),
      answer: <p className="m-0">{t("templateLanding.faq.answer2")}</p>,
    },
    {
      id: "mail-question-3",
      question: t("templateLanding.faq.question3"),
      answer: <p className="m-0">{t("templateLanding.faq.answer3")}</p>,
    },
  ];

  return (
    <TemplateLandingShell>
      <TemplateHero
        eyebrow={
          <span style={{ color: template.color }}>
            Agent-Native {template.name}
          </span>
        }
        title={t("templateLanding.mail.s007")}
        description={
          <p className="m-0">
            Superhuman-style keyboard shortcuts, AI triage, smart search, and
            multi-account support — built on an agent you own. No subscription
            fees, no vendor lock-in.
          </p>
        }
        mediaClassName="bg-[var(--bg-secondary)]"
        media={
          <img
            src={template.screenshot}
            alt={t("templateLanding.mail.s001")}
            loading="lazy"
            decoding="async"
            className="h-auto max-h-[536px] w-full object-cover object-top"
          />
        }
      />

      <TemplateActivationFrame
        heading={
          <h2 className="m-0 text-2xl font-medium leading-[1.15] tracking-tight text-[var(--fg)]">
            {t("templateLanding.mail.s008")}
          </h2>
        }
      >
        <div className="grid w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
          <a
            href="https://mail.agent-native.com"
            target="_blank"
            rel="noopener noreferrer"
            className={primaryLinkClassName}
            onClick={(event) => {
              applyFirstTouchAttributionToLink(event.currentTarget);
              trackEvent("try live demo", {
                template: "mail",
                location: "landing_page",
              });
            }}
          >
            {t("templateLanding.mail.s008")}
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
            {t("templateLanding.mail.s060")}
          </h2>
          <p className="m-0 max-w-3xl text-base leading-relaxed text-[var(--fg-secondary)]">
            {t("templateLanding.mail.s009")}
          </p>
        </div>
      </section>

      <SectionDivider showOnSmallScreens={false} />

      <section className="border-t border-[var(--docs-border)]">
        <TemplateStatOrStepsGrid className="sm:!grid-cols-4">
          {[
            {
              number: (
                <IconKeyboard
                  aria-hidden="true"
                  className="size-9"
                  stroke={1.75}
                />
              ),
              label: t("templateLanding.mail.s002"),
            },
            { number: "AI", label: t("templateLanding.mail.s003") },
            { number: "3", label: t("templateLanding.mail.s004") },
            { number: "∞", label: t("templateLanding.mail.s005") },
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
              {t("templateLanding.mail.s010")}
            </h2>
            <p className="m-0 max-w-[320px] text-lg leading-[1.3] text-[var(--fg-secondary)]">
              {t("templateLanding.mail.s011")}
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
              {t("templateLanding.mail.s019")}
            </h3>
            <p className="m-0 pt-5 text-lg leading-[1.3] text-[var(--fg-secondary)]">
              {t("templateLanding.mail.s020")}
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
                  {t(`templateLanding.mail.${key}`)}
                </li>
              ))}
            </ul>
          </div>
        }
        trailing={
          <div className="flex h-full flex-col px-6 py-10 sm:px-8 lg:px-10 lg:py-16">
            <h3 className="m-0 text-[1.75rem] font-medium leading-[1.15] text-[var(--fg)]">
              {t("templateLanding.mail.s024")}
            </h3>
            <p className="m-0 pt-5 text-lg leading-[1.3] text-[var(--fg-secondary)]">
              {t("templateLanding.mail.s025")}
            </p>
            <ul className="m-0 mt-6 list-none p-0 text-base leading-[1.4] text-[var(--fg-secondary)]">
              {["s026", "s027", "s028"].map((key) => (
                <li key={key} className="flex items-start gap-3 py-2">
                  <IconCheck
                    aria-hidden="true"
                    className="mt-0.5 size-5 shrink-0"
                    stroke={2}
                    style={{ color: template.color }}
                  />
                  {t(`templateLanding.mail.${key}`)}
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
              {t("templateLanding.mail.s029")}
            </h2>
            <p className="m-0 pt-5 text-lg leading-[1.3] text-[var(--fg-secondary)]">
              {t("templateLanding.mail.s030")}
            </p>
            <ul className="m-0 mt-6 list-none p-0 text-base leading-[1.4] text-[var(--fg-secondary)]">
              {["s031", "s032", "s033", "s034"].map((key) => (
                <li key={key} className="flex items-start gap-3 py-2">
                  <IconCheck
                    aria-hidden="true"
                    className="mt-0.5 size-5 shrink-0"
                    stroke={2}
                    style={{ color: template.color }}
                  />
                  {t(`templateLanding.mail.${key}`)}
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
                  sync-inbox --since 7d
                </div>
                <div>
                  <span style={{ color: template.color }}>$</span> pnpm action
                  triage --label priority
                </div>
                <div>
                  <span style={{ color: template.color }}>$</span> pnpm action
                  draft-reply --thread "RE: Q2 update"
                </div>
                <div>
                  <span style={{ color: template.color }}>$</span> pnpm action
                  summarize --unread
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
            {t("templateLanding.mail.s035")}
          </h2>
        </div>
        <TemplateComparisonTable
          caption={t("templateLanding.mail.s035")}
          columns={[
            { id: "gmail", header: "Gmail" },
            { id: "superhuman", header: "Superhuman" },
            {
              id: "agent-native",
              emphasized: true,
              header: (
                <span style={{ color: template.color }}>Agent-Native Mail</span>
              ),
            },
          ]}
          rows={[
            {
              id: "keyboard-shortcuts",
              label: t("templateLanding.mail.s036"),
              cells: {
                gmail: t("templateLanding.mail.s037"),
                superhuman: t("templateLanding.mail.s038"),
                "agent-native": t("templateLanding.mail.s039"),
              },
            },
            {
              id: "ai-assistance",
              label: t("templateLanding.mail.s040"),
              cells: {
                gmail: t("templateLanding.mail.s041"),
                superhuman: t("templateLanding.mail.s042"),
                "agent-native": t("templateLanding.mail.s043"),
              },
            },
            {
              id: "customization",
              label: t("templateLanding.mail.s044"),
              cells: {
                gmail: t("templateLanding.mail.s045"),
                superhuman: t("templateLanding.mail.s046"),
                "agent-native": t("templateLanding.mail.s047"),
              },
            },
            {
              id: "data-ownership",
              label: t("templateLanding.mail.s048"),
              cells: {
                gmail: t("templateLanding.mail.s049"),
                superhuman: t("templateLanding.mail.s050"),
                "agent-native": t("templateLanding.mail.s051"),
              },
            },
            {
              id: "pricing",
              label: t("templateLanding.mail.s052"),
              cells: {
                gmail: t("templateLanding.mail.s053"),
                superhuman: t("templateLanding.mail.s054"),
                "agent-native": t("templateLanding.mail.s055"),
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
        title={t("templateLanding.mail.s056")}
        actions={
          <>
            <TemplateDocsLink
              template={template}
              location="landing_page_cta"
              className={primaryLinkClassName}
            >
              {t("templateLanding.mail.s058")}
            </TemplateDocsLink>
            <Link
              data-an-prefetch="viewport"
              to={sitePathForLocale("/apps", locale)}
              className={activationLinkClassName}
            >
              {t("templateLanding.mail.s059")}
            </Link>
          </>
        }
      >
        <p className="m-0 max-w-2xl px-6 text-lg leading-[1.4] text-[var(--fg-secondary)] sm:px-8">
          {t("templateLanding.mail.s057")}
        </p>
      </TemplateFinalCta>

      <SectionDivider showOnSmallScreens={false} />

      <TemplateLandingFaq
        idPrefix="mail-faq"
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
