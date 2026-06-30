import { useLocale, useT } from "@agent-native/core/client";
import { useState } from "react";
import { Link } from "react-router";

import { sitePathForLocale } from "../components/docs-locale";
import { TemplateDocsLink } from "../components/template-docs";
import { templates, trackEvent } from "../components/TemplateCard";
import { withTemplateSocialImage } from "../seo";

export const meta = () =>
  withTemplateSocialImage(
    [
      {
        title:
          "Agent-Native Analytics — Open Source Alternative to Amplitude & Mixpanel",
      },
      {
        name: "description",
        content:
          "Build AI-powered analytics dashboards you own. Open source alternative to Amplitude, Mixpanel, and Looker. Multiple data connectors, SQL query explorer, reusable dashboards, data dictionary, and natural language chart generation.",
      },
      {
        property: "og:title",
        content:
          "Agent-Native Analytics — Open Source Alternative to Amplitude & Mixpanel",
      },
      {
        property: "og:description",
        content:
          "Build AI-powered analytics dashboards you own. Multiple data connectors, SQL query explorer, and natural language chart generation.",
      },
      {
        name: "keywords",
        content:
          "AI analytics, open source analytics, Amplitude alternative, Mixpanel alternative, Looker alternative, AI dashboard builder, AI data visualization, agent-native analytics, AI-powered BI tool, open source business intelligence, AI chart generator, natural language SQL, BigQuery dashboard",
      },
    ],
    "Analytics",
  );

const template = templates.find((t) => t.slug === "analytics")!;

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
      onClick={handleCopy}
      data-template-cli-copy
      className="group col-span-full flex w-full min-w-0 max-w-full items-center gap-3 rounded-lg border border-[var(--code-border)] bg-[var(--code-bg)] px-4 py-3 font-mono text-sm transition hover:border-[var(--fg-secondary)] sm:w-auto sm:max-w-[min(100%,36rem)] sm:px-5"
    >
      <span className="shrink-0 text-[var(--fg-secondary)]">$</span>
      <span
        data-template-cli-copy-text
        className="min-w-0 truncate text-[var(--fg)]"
      >
        {template.cliCommand}
      </span>
      <span className="ml-auto shrink-0 text-[var(--fg-secondary)] opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
        {copied ? (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </span>
    </button>
  );
}

export default function AnalyticsTemplate() {
  const t = useT();
  const { locale } = useLocale();
  return (
    <main className="template-detail-page mx-auto w-full max-w-[1200px] overflow-x-clip px-4 sm:px-6">
      {/* Hero */}
      <section className="py-12 sm:py-16 lg:py-20">
        <div className="grid min-w-0 gap-10 lg:grid-cols-2 lg:items-start lg:gap-12">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--docs-border)] bg-[var(--bg-secondary)] px-3 py-1 text-xs text-[var(--fg-secondary)]">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: template.color }}
              />
              Agent-Native {template.name}
            </div>

            <h1 className="mb-4 text-[2rem] font-bold leading-[1.08] tracking-tight sm:text-4xl md:text-5xl">
              {t("templateLanding.analytics.s007")}
            </h1>

            <p className="mb-6 text-base leading-7 text-[var(--fg-secondary)] sm:text-lg sm:leading-relaxed">
              {t("templateLanding.analytics.s008")}
            </p>

            <div className="template-detail-actions mb-8 grid grid-cols-2 items-stretch gap-3 sm:flex sm:flex-wrap sm:items-center">
              <a
                href="https://analytics.agent-native.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm font-medium text-white no-underline transition hover:bg-gray-800 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
                onClick={() =>
                  trackEvent("try live demo", {
                    template: "analytics",
                    location: "landing_page",
                  })
                }
              >
                {t("templateLanding.analytics.s009")}
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
              <TemplateDocsLink template={template} location="landing_page" />
              <CliCopy />
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)]">
            <img
              src={template.screenshot}
              alt={t("templateLanding.analytics.s001")}
              className="w-full object-cover object-top"
            />
          </div>
        </div>
      </section>

      {/* By the numbers */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <div className="mx-auto grid max-w-3xl gap-px overflow-hidden rounded-xl border border-[var(--docs-border)] bg-[var(--docs-border)] sm:grid-cols-4">
          {[
            { number: "10+", label: t("templateLanding.analytics.s002") },
            { number: "7", label: t("templateLanding.analytics.s003") },
            { number: "SQL", label: t("templateLanding.analytics.s004") },
            { number: "AI", label: t("templateLanding.analytics.s005") },
          ].map((stat) => (
            <div key={stat.label} className="bg-[var(--bg)] p-6 text-center">
              <div className="mb-1 text-2xl font-bold text-[var(--docs-accent)]">
                {stat.number}
              </div>
              <div className="text-sm text-[var(--fg-secondary)]">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Core capabilities - icon cards */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <h2 className="mb-3 text-2xl font-bold tracking-tight">
          {t("templateLanding.analytics.s010")}
        </h2>
        <p className="mb-8 max-w-2xl text-base text-[var(--fg-secondary)]">
          {t("templateLanding.analytics.s011")}
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <div className="mb-3 text-[var(--docs-accent)]">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <h3 className="mb-1 text-sm font-semibold">
              {t("templateLanding.analytics.s012")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.analytics.s013")}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <div className="mb-3 text-[var(--docs-accent)]">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="9" y1="21" x2="9" y2="9" />
              </svg>
            </div>
            <h3 className="mb-1 text-sm font-semibold">
              {t("templateLanding.analytics.s014")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.analytics.s015")}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <div className="mb-3 text-[var(--docs-accent)]">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <h3 className="mb-1 text-sm font-semibold">SQL Query Explorer</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.analytics.s016")}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
            <div className="mb-3 text-[var(--docs-accent)]">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
            </div>
            <h3 className="mb-1 text-sm font-semibold">
              {t("templateLanding.analytics.s017")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.analytics.s018")}
            </p>
          </div>
        </div>
      </section>

      {/* Connectors */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <h2 className="mb-3 text-2xl font-bold tracking-tight">
          {t("templateLanding.analytics.s019")}
        </h2>
        <p className="mb-8 max-w-2xl text-base text-[var(--fg-secondary)]">
          {t("templateLanding.analytics.s020")}
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-[var(--docs-border)] p-5">
            <h3 className="mb-2 text-sm font-semibold">
              {t("templateLanding.analytics.s021")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              HubSpot, Stripe, Apollo — deals, subscriptions, MRR, and
              enrichment.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] p-5">
            <h3 className="mb-2 text-sm font-semibold">
              {t("templateLanding.analytics.s022")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              {t("templateLanding.analytics.s023")}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] p-5">
            <h3 className="mb-2 text-sm font-semibold">
              {t("templateLanding.analytics.s024")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Google Cloud, Grafana — services, metrics, logs, and alerts.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] p-5">
            <h3 className="mb-2 text-sm font-semibold">
              {t("templateLanding.analytics.s025")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Slack, Gong, Twitter — channel history, call transcripts, and
              social metrics.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] p-5">
            <h3 className="mb-2 text-sm font-semibold">
              {t("templateLanding.analytics.s026")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Notion, DataForSEO — content calendars, keywords, and top search
              terms.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] p-5">
            <h3 className="mb-2 text-sm font-semibold">
              {t("templateLanding.analytics.s027")}
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Common Room, Pylon — member engagement and support tickets.
            </p>
          </div>
        </div>
      </section>

      {/* Data dictionary highlight */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="mb-3 text-2xl font-bold tracking-tight">
              {t("templateLanding.analytics.s028")}
            </h2>
            <p className="mb-6 text-base text-[var(--fg-secondary)]">
              {t("templateLanding.analytics.s029")}
            </p>
            <ul className="m-0 list-none space-y-3 p-0 text-sm text-[var(--fg-secondary)]">
              <li className="flex items-start gap-2">
                <svg
                  className="mt-0.5 shrink-0 text-[var(--docs-accent)]"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t("templateLanding.analytics.s030")}
              </li>
              <li className="flex items-start gap-2">
                <svg
                  className="mt-0.5 shrink-0 text-[var(--docs-accent)]"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t("templateLanding.analytics.s031")}
              </li>
              <li className="flex items-start gap-2">
                <svg
                  className="mt-0.5 shrink-0 text-[var(--docs-accent)]"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t("templateLanding.analytics.s032")}
              </li>
              <li className="flex items-start gap-2">
                <svg
                  className="mt-0.5 shrink-0 text-[var(--docs-accent)]"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t("templateLanding.analytics.s033")}
              </li>
            </ul>
          </div>
          <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-6">
            <div className="space-y-3 font-mono text-sm">
              <div className="text-[var(--fg-secondary)]">
                {"// Example metric definition"}
              </div>
              <div>
                <span className="text-[var(--docs-accent)]">name:</span>{" "}
                <span className="text-[var(--fg)]">
                  {t("templateLanding.analytics.s034")}
                </span>
              </div>
              <div>
                <span className="text-[var(--docs-accent)]">query:</span>{" "}
                <span className="text-[var(--fg)]">
                  SELECT COUNT(DISTINCT user_id)...
                </span>
              </div>
              <div>
                <span className="text-[var(--docs-accent)]">frequency:</span>{" "}
                <span className="text-[var(--fg)]">
                  {t("templateLanding.analytics.s035")}
                </span>
              </div>
              <div>
                <span className="text-[var(--docs-accent)]">lag:</span>{" "}
                <span className="text-[var(--fg)]">
                  {t("templateLanding.analytics.s036")}
                </span>
              </div>
              <div>
                <span className="text-[var(--docs-accent)]">gotchas:</span>{" "}
                <span className="text-[var(--fg)]">
                  {t("templateLanding.analytics.s037")}
                </span>
              </div>
              <div>
                <span className="text-[var(--docs-accent)]">trust:</span>{" "}
                <span className="text-[var(--fg)]">
                  {t("templateLanding.analytics.s038")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Comparison table */}
      <section className="border-t border-[var(--docs-border)] py-16">
        <h2 className="mb-8 text-2xl font-bold tracking-tight">
          {t("templateLanding.analytics.s039")}
        </h2>
        <div className="overflow-x-auto rounded-xl border border-[var(--docs-border)]">
          <table className="comparison-table min-w-[42rem] w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--docs-border)] bg-[var(--bg-secondary)]">
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg)]"></th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">
                  Amplitude / Mixpanel
                </th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">
                  ChatGPT + CSV
                </th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--docs-accent)]">
                  Agent-Native Analytics
                </th>
              </tr>
            </thead>
            <tbody className="text-[var(--fg-secondary)]">
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  {t("templateLanding.analytics.s040")}
                </td>
                <td className="px-5 py-3">
                  {t("templateLanding.analytics.s041")}
                </td>
                <td className="px-5 py-3">
                  {t("templateLanding.analytics.s042")}
                </td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  {t("templateLanding.analytics.s043")}
                </td>
              </tr>
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  {t("templateLanding.analytics.s005")}
                </td>
                <td className="px-5 py-3">
                  {t("templateLanding.analytics.s044")}
                </td>
                <td className="px-5 py-3">
                  {t("templateLanding.analytics.s045")}
                </td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  {t("templateLanding.analytics.s046")}
                </td>
              </tr>
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  {t("templateLanding.analytics.s002")}
                </td>
                <td className="px-5 py-3">
                  {t("templateLanding.analytics.s047")}
                </td>
                <td className="px-5 py-3">
                  {t("templateLanding.analytics.s048")}
                </td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  {t("templateLanding.analytics.s049")}
                </td>
              </tr>
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  {t("templateLanding.analytics.s050")}
                </td>
                <td className="px-5 py-3">
                  {t("templateLanding.analytics.s051")}
                </td>
                <td className="px-5 py-3">None</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  {t("templateLanding.analytics.s052")}
                </td>
              </tr>
              <tr className="border-b border-[var(--docs-border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  {t("templateLanding.analytics.s053")}
                </td>
                <td className="px-5 py-3">
                  {t("templateLanding.analytics.s054")}
                </td>
                <td className="px-5 py-3">
                  {t("templateLanding.analytics.s055")}
                </td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  {t("templateLanding.analytics.s056")}
                </td>
              </tr>
              <tr>
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  {t("templateLanding.analytics.s057")}
                </td>
                <td className="px-5 py-3">
                  {t("templateLanding.analytics.s058")}
                </td>
                <td className="px-5 py-3">
                  {t("templateLanding.analytics.s059")}
                </td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  {t("templateLanding.analytics.s060")}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-[var(--docs-border)] py-16 text-center">
        <h2 className="mb-3 text-2xl font-bold tracking-tight">
          {t("templateLanding.analytics.s061")}
        </h2>
        <p className="mx-auto mb-8 max-w-lg text-base text-[var(--fg-secondary)]">
          {t("templateLanding.analytics.s062")}
        </p>
        <div className="template-detail-cta-actions flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center sm:gap-4">
          <TemplateDocsLink
            template={template}
            location="landing_page_cta"
            className="inline-flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm font-medium text-white no-underline transition hover:bg-gray-800 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            {t("templateLanding.analytics.s063")}
          </TemplateDocsLink>
          <Link
            data-an-prefetch="render"
            to={sitePathForLocale("/apps", locale)}
            className="inline-flex items-center gap-2 rounded-full border border-[var(--docs-border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
          >
            {t("templateLanding.analytics.s064")}
          </Link>
        </div>
      </section>
    </main>
  );
}
