import { Link } from "react-router";
import { useState } from "react";
import { templates, trackEvent } from "../components/TemplateCard";

export const meta = () => [
  {
    title:
      "AI-Native Analytics — Open Source Alternative to Amplitude & Mixpanel",
  },
  {
    name: "description",
    content:
      "Build AI-powered analytics dashboards you own. Open source alternative to Amplitude, Mixpanel, and Looker. Multiple data connectors, SQL query explorer, reusable dashboards, data dictionary, and natural language chart generation.",
  },
  {
    property: "og:title",
    content:
      "AI-Native Analytics — Open Source Alternative to Amplitude & Mixpanel",
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
];

const template = templates.find((t) => t.slug === "analytics")!;

function CliCopy() {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(template.cliCommand);
    setCopied(true);
    trackEvent("copy_cli_command", {
      template: template.slug,
      location: "landing_page",
    });
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      onClick={handleCopy}
      className="group flex items-center gap-3 rounded-lg border border-[var(--code-border)] bg-[var(--code-bg)] px-5 py-3 font-mono text-sm transition hover:border-[var(--fg-secondary)]"
    >
      <span className="shrink-0 text-[var(--fg-secondary)]">$</span>
      <span className="truncate text-[var(--fg)]">{template.cliCommand}</span>
      <span className="ml-auto shrink-0 text-[var(--fg-secondary)] opacity-0 transition group-hover:opacity-100">
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
  return (
    <main className="mx-auto max-w-[1200px] px-6">
      {/* Hero */}
      <section className="py-20">
        <div className="mb-4">
          <Link
            prefetch="render"
            to="/templates"
            className="inline-flex items-center gap-1 text-sm text-[var(--fg-secondary)] no-underline hover:text-[var(--fg)]"
          >
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
              <polyline points="15 18 9 12 15 6" />
            </svg>
            All Templates
          </Link>
        </div>

        <div className="grid gap-12 lg:grid-cols-2 lg:items-start">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-1 text-xs text-[var(--fg-secondary)]">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: template.color }}
              />
              {template.replaces}
            </div>

            <h1 className="mb-4 text-4xl font-bold tracking-tight md:text-5xl">
              Agent-Native Analytics
            </h1>

            <p className="mb-6 text-lg leading-relaxed text-[var(--fg-secondary)]">
              A full BI platform you own. Connect any data source, ask for any
              chart, build reusable dashboards — all with an AI agent that
              writes queries and evolves the app.
            </p>

            <div className="mb-8 flex flex-wrap items-center gap-3">
              <a
                href="https://analytics.agent-native.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm font-medium text-white no-underline transition hover:bg-gray-800 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
                onClick={() =>
                  trackEvent("try_live_demo", {
                    template: "analytics",
                    location: "landing_page",
                  })
                }
              >
                Try It
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
              <CliCopy />
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]">
            <img
              src={template.screenshot}
              alt="Analytics template screenshot"
              className="w-full object-cover object-top"
            />
          </div>
        </div>
      </section>

      {/* By the numbers */}
      <section className="border-t border-[var(--border)] py-16">
        <div className="mx-auto grid max-w-3xl gap-px overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--border)] sm:grid-cols-4">
          {[
            { number: "10+", label: "Data connectors" },
            { number: "7", label: "Chart types" },
            { number: "SQL", label: "Query explorer" },
            { number: "AI", label: "Natural language" },
          ].map((stat) => (
            <div key={stat.label} className="bg-[var(--bg)] p-6 text-center">
              <div className="mb-1 text-2xl font-bold text-[var(--accent)]">
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
      <section className="border-t border-[var(--border)] py-16">
        <h2 className="mb-3 text-2xl font-bold tracking-tight">
          What you can do
        </h2>
        <p className="mb-8 max-w-2xl text-base text-[var(--fg-secondary)]">
          Everything you need to replace your analytics stack.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <div className="mb-3 text-[var(--accent)]">
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
              Natural Language Queries
            </h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Ask in plain English. The agent writes the SQL and builds the
              chart.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <div className="mb-3 text-[var(--accent)]">
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
            <h3 className="mb-1 text-sm font-semibold">Reusable Dashboards</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Persistent dashboards with date controls, subviews, and resizable
              panels.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <div className="mb-3 text-[var(--accent)]">
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
              Direct BigQuery access with history, row counts, and shareable
              URLs.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <div className="mb-3 text-[var(--accent)]">
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
            <h3 className="mb-1 text-sm font-semibold">Self-Improving</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              The agent modifies the app itself. Need a new chart type? Just
              ask.
            </p>
          </div>
        </div>
      </section>

      {/* Connectors */}
      <section className="border-t border-[var(--border)] py-16">
        <h2 className="mb-3 text-2xl font-bold tracking-tight">
          Connect everything
        </h2>
        <p className="mb-8 max-w-2xl text-base text-[var(--fg-secondary)]">
          Multiple built-in connectors for popular services. The agent writes
          new ones on demand.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-[var(--border)] p-5">
            <h3 className="mb-2 text-sm font-semibold">CRM & Revenue</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              HubSpot, Stripe, Apollo — deals, subscriptions, MRR, and
              enrichment.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Engineering</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              GitHub, Jira, Sentry — PRs, tickets, sprints, and error tracking.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Infrastructure</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Google Cloud, Grafana — services, metrics, logs, and alerts.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Communication</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Slack, Gong, Twitter — channel history, call transcripts, and
              social metrics.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Content & SEO</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Notion, DataForSEO — content calendars, keywords, and top search
              terms.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Community</h3>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Common Room, Pylon — member engagement and support tickets.
            </p>
          </div>
        </div>
      </section>

      {/* Data dictionary highlight */}
      <section className="border-t border-[var(--border)] py-16">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="mb-3 text-2xl font-bold tracking-tight">
              Living data dictionary
            </h2>
            <p className="mb-6 text-base text-[var(--fg-secondary)]">
              Metric definitions with query templates, join patterns, known
              gotchas, and update frequency. Synced from Notion with
              community-driven validation.
            </p>
            <ul className="m-0 list-none space-y-3 p-0 text-sm text-[var(--fg-secondary)]">
              <li className="flex items-start gap-2">
                <svg
                  className="mt-0.5 shrink-0 text-[var(--accent)]"
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
                Query templates and example outputs for every metric
              </li>
              <li className="flex items-start gap-2">
                <svg
                  className="mt-0.5 shrink-0 text-[var(--accent)]"
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
                Trust scoring and validation with reviewer approvals
              </li>
              <li className="flex items-start gap-2">
                <svg
                  className="mt-0.5 shrink-0 text-[var(--accent)]"
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
                AI-powered metric suggestions and discovery
              </li>
              <li className="flex items-start gap-2">
                <svg
                  className="mt-0.5 shrink-0 text-[var(--accent)]"
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
                Data lag, dependencies, and valid date ranges documented
              </li>
            </ul>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-6">
            <div className="space-y-3 font-mono text-sm">
              <div className="text-[var(--fg-secondary)]">
                {"// Example metric definition"}
              </div>
              <div>
                <span className="text-[var(--accent)]">name:</span>{" "}
                <span className="text-[var(--fg)]">Weekly Active Users</span>
              </div>
              <div>
                <span className="text-[var(--accent)]">query:</span>{" "}
                <span className="text-[var(--fg)]">
                  SELECT COUNT(DISTINCT user_id)...
                </span>
              </div>
              <div>
                <span className="text-[var(--accent)]">frequency:</span>{" "}
                <span className="text-[var(--fg)]">Daily</span>
              </div>
              <div>
                <span className="text-[var(--accent)]">lag:</span>{" "}
                <span className="text-[var(--fg)]">~2 hours</span>
              </div>
              <div>
                <span className="text-[var(--accent)]">gotchas:</span>{" "}
                <span className="text-[var(--fg)]">
                  Excludes internal @company emails
                </span>
              </div>
              <div>
                <span className="text-[var(--accent)]">trust:</span>{" "}
                <span className="text-[var(--fg)]">Validated ✓</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Comparison table */}
      <section className="border-t border-[var(--border)] py-16">
        <h2 className="mb-8 text-2xl font-bold tracking-tight">
          How it compares
        </h2>
        <div className="overflow-hidden rounded-xl border border-[var(--border)]">
          <table className="comparison-table w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--bg-secondary)]">
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg)]"></th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">
                  Amplitude / Mixpanel
                </th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">
                  ChatGPT + CSV
                </th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--accent)]">
                  Agent-Native Analytics
                </th>
              </tr>
            </thead>
            <tbody className="text-[var(--fg-secondary)]">
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Dashboard UI
                </td>
                <td className="px-5 py-3">Yes, rigid</td>
                <td className="px-5 py-3">No</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Yes, fully customizable
                </td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Natural language
                </td>
                <td className="px-5 py-3">Limited</td>
                <td className="px-5 py-3">Yes, ephemeral</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Yes, persistent charts
                </td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Data connectors
                </td>
                <td className="px-5 py-3">Built-in SDKs</td>
                <td className="px-5 py-3">Manual upload</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Multiple sources + custom
                </td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Data dictionary
                </td>
                <td className="px-5 py-3">Basic</td>
                <td className="px-5 py-3">None</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Full metrics with context
                </td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Customization
                </td>
                <td className="px-5 py-3">Config only</td>
                <td className="px-5 py-3">Prompt only</td>
                <td className="px-5 py-3 text-[var(--fg)]">Full source code</td>
              </tr>
              <tr>
                <td className="px-5 py-3 font-medium text-[var(--fg)]">
                  Pricing
                </td>
                <td className="px-5 py-3">Per-seat, per-event</td>
                <td className="px-5 py-3">Subscription</td>
                <td className="px-5 py-3 text-[var(--fg)]">
                  Free & open source
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-[var(--border)] py-16 text-center">
        <h2 className="mb-3 text-2xl font-bold tracking-tight">
          Get started in minutes
        </h2>
        <p className="mx-auto mb-8 max-w-lg text-base text-[var(--fg-secondary)]">
          Fork the template, connect your data, start building dashboards.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link
            prefetch="render"
            to="/docs"
            className="inline-flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm font-medium text-white no-underline transition hover:bg-gray-800 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            Get Started
          </Link>
          <Link
            prefetch="render"
            to="/templates"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
          >
            View all templates
          </Link>
        </div>
      </section>
    </main>
  );
}
