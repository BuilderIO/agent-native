import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, useRef } from 'react'
import { templates } from '../../components/TemplateCard'
import CodeBlock from '../../components/CodeBlock'

export const Route = createFileRoute('/templates/analytics')({
  component: AnalyticsTemplate,
  head: () => ({
    meta: [
      { title: 'AI-Native Analytics — Open Source Alternative to Amplitude & Mixpanel' },
      { name: 'description', content: 'Build AI-powered analytics dashboards you own. Open source alternative to Amplitude, Mixpanel, and Looker. Connect any data source, prompt for any chart, build reusable dashboards with AI assistance.' },
      { property: 'og:title', content: 'AI-Native Analytics — Open Source Alternative to Amplitude & Mixpanel' },
      { property: 'og:description', content: 'Build AI-powered analytics dashboards you own. Connect any data source, prompt for any chart.' },
      { name: 'keywords', content: 'AI analytics, open source analytics, Amplitude alternative, Mixpanel alternative, AI dashboard builder, AI data visualization, agent-native analytics, AI-powered BI tool' },
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
      <span className="text-[var(--fg-secondary)]">$</span>
      <span className="text-[var(--fg)]">{template.cliCommand}</span>
      <span className="ml-2 text-[var(--fg-secondary)] opacity-0 transition group-hover:opacity-100">
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
              Connect any data source, ask for any chart in natural language, and build reusable dashboards — not throwaway Q&A.
              You own the code. Customize everything.
            </p>

            <div className="mb-8 flex flex-wrap items-center gap-3">
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
        <h2 className="mb-8 text-2xl font-bold tracking-tight">What you can do</h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Natural Language Queries</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Ask questions in plain English. "Show me weekly signups by source for the last quarter." No SQL required.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Reusable Dashboards</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Build dashboards that persist and update — not throwaway chat responses. Pin charts, arrange layouts, share with your team.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Any Data Source</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Connect databases, APIs, CSV files, or any data source. The agent writes the connectors for you.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">AI Chart Generation</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Describe the visualization you want — bar charts, funnels, cohort analysis, heatmaps — and the agent builds it.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Self-Improving</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              The agent can modify the app itself. Need a new chart type or custom metric? Ask for it and the app evolves.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Fully Open Source</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Fork the template, own the code, customize everything. No vendor lock-in, no per-seat pricing, no data leaving your infrastructure.
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
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Data ownership</td>
                <td className="px-5 py-3">Their servers</td>
                <td className="px-5 py-3">Upload required</td>
                <td className="px-5 py-3 text-[var(--fg)]">Your infrastructure</td>
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
          Fork the analytics template, connect your data, and start building dashboards with AI.
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
