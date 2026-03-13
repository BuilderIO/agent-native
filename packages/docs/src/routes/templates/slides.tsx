import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { templates } from '../../components/TemplateCard'

export const Route = createFileRoute('/templates/slides')({
  component: SlidesTemplate,
  head: () => ({
    meta: [
      { title: 'AI-Native Slides — Open Source AI Presentation Builder' },
      { name: 'description', content: 'Generate and edit presentations with AI. Open source alternative to Google Slides and Pitch. Create React-based slide decks via natural language, customize every pixel, own the code.' },
      { property: 'og:title', content: 'AI-Native Slides — Open Source AI Presentation Builder' },
      { property: 'og:description', content: 'Generate and edit presentations with AI. Create slide decks via natural language.' },
      { name: 'keywords', content: 'AI presentation maker, AI slide generator, open source Google Slides alternative, Pitch alternative, AI PowerPoint, AI deck builder, agent-native slides, AI presentation tool' },
    ],
  }),
})

const template = templates.find((t) => t.slug === 'slides')!

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

function SlidesTemplate() {
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
              AI-Native Slides
            </h1>

            <p className="mb-6 text-lg leading-relaxed text-[var(--fg-secondary)]">
              Stop dragging boxes around in slide editors.
              Describe the presentation you want, refine it conversationally, and edit with point-and-click when you need precision.
              React-based slides mean unlimited customization. You own the code.
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
            <img src={template.screenshot} alt="Slides template screenshot" className="w-full object-cover object-top" />
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)] py-16">
        <h2 className="mb-8 text-2xl font-bold tracking-tight">What you can do</h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Prompt-to-Deck</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Describe your presentation topic and audience. The agent generates a complete slide deck with structure, content, and styling.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Visual Editing</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Point-and-click editing when you need pixel-level control. Move elements, change colors, adjust layouts — all in a live preview.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">React-Based Slides</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Slides are React components. Add animations, live data, interactive elements — anything React can render.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Iterative Refinement</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              "Make the title bigger." "Add a chart on slide 3." "Change the color scheme to blue." Refine conversationally until it's perfect.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Custom Themes</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Create and save brand themes. Every new deck starts with your fonts, colors, and layout preferences.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Fully Open Source</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Fork the template, own the code, customize everything. No vendor lock-in, no per-seat pricing.
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
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">Google Slides / Pitch</th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">AI Slide Generators</th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--accent)]">Agent-Native Slides</th>
              </tr>
            </thead>
            <tbody className="text-[var(--fg-secondary)]">
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Visual editor</td>
                <td className="px-5 py-3">Yes, template-bound</td>
                <td className="px-5 py-3">Limited / none</td>
                <td className="px-5 py-3 text-[var(--fg)]">Yes, fully customizable</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">AI generation</td>
                <td className="px-5 py-3">Basic / none</td>
                <td className="px-5 py-3">One-shot, rigid</td>
                <td className="px-5 py-3 text-[var(--fg)]">Iterative, conversational</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Interactivity</td>
                <td className="px-5 py-3">Static</td>
                <td className="px-5 py-3">Static</td>
                <td className="px-5 py-3 text-[var(--fg)]">React components</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Customization</td>
                <td className="px-5 py-3">Themes only</td>
                <td className="px-5 py-3">Prompt only</td>
                <td className="px-5 py-3 text-[var(--fg)]">Full source code</td>
              </tr>
              <tr>
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Pricing</td>
                <td className="px-5 py-3">Free / per-seat</td>
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
          Fork the slides template and start creating presentations with AI.
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
