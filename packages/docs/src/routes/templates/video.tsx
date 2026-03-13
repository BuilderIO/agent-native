import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { templates } from '../../components/TemplateCard'

export const Route = createFileRoute('/templates/video')({
  component: VideoTemplate,
  head: () => ({
    meta: [
      { title: 'AI-Native Video — Open Source AI Video Editor & Generator' },
      { name: 'description', content: 'Create and edit video compositions with AI. Open source AI video editor built on Remotion. Generate videos from prompts, edit with an agent, render programmatically — all in code you own.' },
      { property: 'og:title', content: 'AI-Native Video — Open Source AI Video Editor & Generator' },
      { property: 'og:description', content: 'Create and edit video compositions with AI assistance.' },
      { name: 'keywords', content: 'AI video editor, AI video generator, open source video editor, Remotion video, AI video creation, agent-native video, programmatic video, AI motion graphics' },
    ],
  }),
})

const template = templates.find((t) => t.slug === 'video')!

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

function VideoTemplate() {
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
              AI-Native Video
            </h1>

            <p className="mb-6 text-lg leading-relaxed text-[var(--fg-secondary)]">
              Create and edit video compositions with an AI agent.
              Built on Remotion, this template lets you go from storyboard to rendered video — all through natural language.
              Describe scenes, adjust timing, add effects. You own the code.
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
            <img src={template.screenshot} alt="Video template screenshot" className="w-full object-cover object-top" />
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)] py-16">
        <h2 className="mb-8 text-2xl font-bold tracking-tight">What you can do</h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Prompt-to-Video</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Describe your video concept and the agent builds the composition — scenes, transitions, text overlays, and timing.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Remotion-Powered</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Built on Remotion — videos are React components. Add any animation, data visualization, or interactive element.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Agent-Assisted Editing</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              "Speed up the intro." "Add a fade between scenes." "Change the background music timing." Edit conversationally.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Programmatic Rendering</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Render videos programmatically. Generate batches of personalized videos, social content, or data-driven visualizations.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Live Preview</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              See changes in real time as the agent edits. Scrub through the timeline, preview transitions, and iterate fast.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Fully Open Source</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Fork the template, own the code, customize everything. No watermarks, no render limits, no vendor lock-in.
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
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">Traditional Editors</th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">AI Video Tools</th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--accent)]">Agent-Native Video</th>
              </tr>
            </thead>
            <tbody className="text-[var(--fg-secondary)]">
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">AI assistance</td>
                <td className="px-5 py-3">None / basic</td>
                <td className="px-5 py-3">Generation only</td>
                <td className="px-5 py-3 text-[var(--fg)]">Full create + edit</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Programmatic</td>
                <td className="px-5 py-3">No</td>
                <td className="px-5 py-3">API-only</td>
                <td className="px-5 py-3 text-[var(--fg)]">React + API</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Customization</td>
                <td className="px-5 py-3">Plugins</td>
                <td className="px-5 py-3">Templates only</td>
                <td className="px-5 py-3 text-[var(--fg)]">Full source code</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Batch rendering</td>
                <td className="px-5 py-3">Manual</td>
                <td className="px-5 py-3">Limited</td>
                <td className="px-5 py-3 text-[var(--fg)]">Built-in</td>
              </tr>
              <tr>
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Pricing</td>
                <td className="px-5 py-3">License / subscription</td>
                <td className="px-5 py-3">Per-render</td>
                <td className="px-5 py-3 text-[var(--fg)]">Free & open source</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="border-t border-[var(--border)] py-16 text-center">
        <h2 className="mb-3 text-2xl font-bold tracking-tight">Get started in minutes</h2>
        <p className="mx-auto mb-8 max-w-lg text-base text-[var(--fg-secondary)]">
          Fork the video template and start creating videos with AI.
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
