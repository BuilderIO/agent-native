import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { templates } from '../../components/TemplateCard'

export const Route = createFileRoute('/templates/analytics')({
  component: AnalyticsTemplate,
  head: () => ({
    meta: [
      { title: 'AI-Native Analytics — Open Source Alternative to Amplitude & Mixpanel' },
      { name: 'description', content: 'Build AI-powered analytics dashboards you own. Open source alternative to Amplitude, Mixpanel, and Looker. 20+ data connectors, SQL query explorer, reusable dashboards, data dictionary, 50+ scripts, and natural language chart generation.' },
      { property: 'og:title', content: 'AI-Native Analytics — Open Source Alternative to Amplitude & Mixpanel' },
      { property: 'og:description', content: 'Build AI-powered analytics dashboards you own. 20+ data connectors, SQL query explorer, and natural language chart generation.' },
      { name: 'keywords', content: 'AI analytics, open source analytics, Amplitude alternative, Mixpanel alternative, Looker alternative, AI dashboard builder, AI data visualization, agent-native analytics, AI-powered BI tool, open source business intelligence, AI chart generator, natural language SQL, BigQuery dashboard' },
    ],
  }),
})

const template = templates.find((t) => t.slug === 'analytics')!

function CliCopy() {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    navigator.clipboard.writeText(template.cliCommand)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
        )}
      </span>
    </button>
  )
}

function AnalyticsTemplate() {
  return (
    <main className="mx-auto max-w-[1200px] px-6">
      <section className="py-20">
        <div className="mb-4">
          <Link to="/templates" className="inline-flex items-center gap-1 text-sm text-[var(--fg-secondary)] no-underline hover:text-[var(--fg)]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            All Templates
          </Link>
        </div>

        <div className="grid gap-12 lg:grid-cols-2 lg:items-start">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-1 text-xs text-[var(--fg-secondary)]">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: template.color }} />
              {template.replaces}
            </div>

            <h1 className="mb-4 text-4xl font-bold tracking-tight md:text-5xl">
              AI-Native Analytics
            </h1>

            <p className="mb-6 text-lg leading-relaxed text-[var(--fg-secondary)]">
              Stop paying for rigid analytics tools that can't answer the questions you actually have.
              This template gives you a full BI platform with 20+ data connectors, a SQL query explorer, reusable dashboards, and a data dictionary with 550+ metric definitions — all with an AI agent that can build charts, write queries, and even modify the app itself.
              Connect BigQuery, HubSpot, Stripe, Jira, Sentry, Slack, GitHub, and more.
              You own the code.
            </p>

            <div className="mb-8 flex flex-col items-start gap-3">
              <a
                href="https://builder.io"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-black no-underline transition hover:bg-gray-200 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" /></svg>
                Launch in Cloud
              </a>
              <CliCopy />
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]">
            <img src={template.screenshot} alt="Analytics template screenshot" className="w-full object-cover object-top" />
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)] py-16">
        <h2 className="mb-4 text-2xl font-bold tracking-tight">What you can do</h2>
        <p className="mb-8 max-w-2xl text-base leading-relaxed text-[var(--fg-secondary)]">
          A complete business intelligence platform with an AI agent. Connect your data, build dashboards, explore with SQL, and maintain a living data dictionary — all in code you own.
        </p>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">20+ Data Connectors</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              BigQuery, HubSpot, Stripe, Jira, Sentry, GitHub, Slack, Grafana, Google Cloud, Apollo, Gong, Notion, Twitter, Pylon, DataForSEO, Common Room, and more. The agent writes new connectors on demand.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">SQL Query Explorer</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Direct BigQuery access with query history, row count tracking, SQL preview, shareable URLs, and export-ready results. Build event-based filters, group by dimensions, and pick chart types visually.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Reusable Dashboards</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Build dashboards that persist and update — not throwaway chat responses. Multi-view subviews, date range controls (7d/30d/90d/custom), author tracking, and resizable panel layouts.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Data Dictionary</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              550+ metric definitions with query templates, example outputs, join patterns, update frequency, data lag, and known gotchas. Synced from Notion with community-driven validation scoring and AI-powered suggestions.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Rich Visualizations</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Area charts, time series, cumulative net charts, revenue comparisons, data tables, leaderboards, and kanban boards. Dark mode optimized, responsive tooltips, currency/percentage formatters.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">50+ Pre-built Scripts</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Ready-to-run scripts for BigQuery schema inspection, chart generation, sentiment analysis, conversion funnels, deal pipeline analysis, social engagement metrics, and provider-specific queries.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Ad-Hoc Analysis System</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Deep-dive investigation framework for one-time business questions. Step-by-step diagnostic walkthroughs, automatic date tracking, and the ability to promote insights into permanent dashboards.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Data Quality & Trust</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              NULL rate validation, data completeness checks, metric trust scoring, and BigQuery cost tracking. Community-driven validation with reviewer approvals and gamified contribution leaderboards.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Agent-Assisted Creation</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Describe what you want — "Show me weekly signups by source for the last quarter" — and the agent writes the query, builds the chart, and adds it to a dashboard. It can even modify the app to add new chart types.
            </p>
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)] py-16">
        <h2 className="mb-8 text-2xl font-bold tracking-tight">How it compares</h2>
        <div className="overflow-hidden rounded-xl border border-[var(--border)]">
          <table className="comparison-table w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--bg-secondary)]">
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg)]"></th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">Amplitude / Mixpanel</th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">ChatGPT + CSV</th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--accent)]">Agent-Native Analytics</th>
              </tr>
            </thead>
            <tbody className="text-[var(--fg-secondary)]">
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Dashboard UI</td>
                <td className="px-5 py-3">Yes, rigid</td>
                <td className="px-5 py-3">No</td>
                <td className="px-5 py-3 text-[var(--fg)]">Yes, fully customizable</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Natural language</td>
                <td className="px-5 py-3">Limited</td>
                <td className="px-5 py-3">Yes, ephemeral</td>
                <td className="px-5 py-3 text-[var(--fg)]">Yes, persistent charts</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Data connectors</td>
                <td className="px-5 py-3">Built-in SDKs</td>
                <td className="px-5 py-3">Manual upload</td>
                <td className="px-5 py-3 text-[var(--fg)]">20+ sources + custom</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Data dictionary</td>
                <td className="px-5 py-3">Basic</td>
                <td className="px-5 py-3">None</td>
                <td className="px-5 py-3 text-[var(--fg)]">550+ metrics with context</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Self-improving</td>
                <td className="px-5 py-3">No</td>
                <td className="px-5 py-3">No</td>
                <td className="px-5 py-3 text-[var(--fg)]">Agent modifies the app</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Customization</td>
                <td className="px-5 py-3">Config only</td>
                <td className="px-5 py-3">Prompt only</td>
                <td className="px-5 py-3 text-[var(--fg)]">Full source code</td>
              </tr>
              <tr>
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Pricing</td>
                <td className="px-5 py-3">Per-seat, per-event</td>
                <td className="px-5 py-3">Subscription</td>
                <td className="px-5 py-3 text-[var(--fg)]">Free & open source</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="border-t border-[var(--border)] py-16 text-center">
        <h2 className="mb-3 text-2xl font-bold tracking-tight">Get started in minutes</h2>
        <p className="mx-auto mb-8 max-w-lg text-base text-[var(--fg-secondary)]">
          Fork the analytics template, connect your data sources, and start building dashboards with AI.
        </p>
        <div className="flex items-center justify-center gap-4">
          <a
            href="https://builder.io"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-black no-underline transition hover:bg-gray-200 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            Launch in Cloud
          </a>
          <Link
            to="/templates"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
          >
            View all templates
          </Link>
        </div>
      </section>
    </main>
  )
}
