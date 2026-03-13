import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { templates } from '../../components/TemplateCard'

export const Route = createFileRoute('/templates/video')({
  component: VideoTemplate,
  head: () => ({
    meta: [
      { title: 'AI-Native Video — Open Source AI Video Editor & Remotion Studio' },
      { name: 'description', content: 'Create and edit video compositions with AI. Open source video studio built on Remotion. Track-based animation system, 30+ easing curves, interactive cursor system, 6D camera controls, keyframe editing, and 12 example compositions.' },
      { property: 'og:title', content: 'AI-Native Video — Open Source AI Video Editor & Remotion Studio' },
      { property: 'og:description', content: 'Create and edit video compositions with AI. Full animation studio built on Remotion.' },
      { name: 'keywords', content: 'AI video editor, AI video generator, open source video editor, Remotion video, AI video creation, agent-native video, programmatic video, AI motion graphics, AI animation tool, open source animation studio, React video editor' },
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
              A full video composition studio built on Remotion with an AI agent.
              Track-based animation system with 30+ easing curves, multi-keyframe editing, an interactive cursor system, 6D camera controls (pan, zoom, 3D tilt), and 12 example compositions — from kinetic text to full UI product demos.
              Describe what you want, the agent builds it. Tweak in the timeline or let the agent iterate.
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
            <img src={template.screenshot} alt="Video template screenshot" className="w-full object-cover object-top" />
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)] py-16">
        <h2 className="mb-4 text-2xl font-bold tracking-tight">What you can do</h2>
        <p className="mb-8 max-w-2xl text-base leading-relaxed text-[var(--fg-secondary)]">
          A professional animation studio in the browser. Build product demos, explainer videos, animated social content, and UI mockup recordings — all with an AI agent and a visual timeline editor.
        </p>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Track-Based Animation</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Every animation is a track in the timeline — visible, editable, and reorderable. Duration tracks with drag handles, keyframe tracks with diamond markers, and expression tracks for programmatic animations.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">30+ Easing Curves</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Linear, power (1-4), back, bounce, circ, elastic, expo, sine — each with in/out/inOut variants plus Remotion spring physics. Visual curve picker shows the shape of each easing.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Multi-Keyframe Editing</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Per-property keyframes at arbitrary frames, each with independent easing. Box-select multiple keyframes, shift-click to add/remove, and drag groups while preserving relative timing.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Interactive Cursor System</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Three cursor styles (arrow, pointer hand, text I-beam) with hover zone detection, smooth transitions, and click animations. Perfect for product demos and UI walkthroughs.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">6D Camera Controls</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Pan (X/Y), zoom (scale), and 3D tilt (rotateX/Y) with perspective depth. Anti-pixelation rendering at 3× internal scale ensures crisp output even at high zoom levels.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">12 Example Compositions</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Kinetic text, logo reveals, slideshows, interactive UI showcases (Jira, Slack, project boards), component demos, and blank templates. Fork and customize any of them.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Expression Animations</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Programmatic animations for complex effects — typing reveals, particle bursts, stagger effects. Adjustable parameters let users tweak without touching code. Marked with purple "fx" badges in the timeline.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Remotion-Powered</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Built on Remotion — videos are React components at 1920×1080, 30fps. Add any React component, data visualization, or interactive element. Render to MP4/WebM via Remotion CLI.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Agent-Assisted Creation</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Describe what you want — "A logo reveal with particle burst and spring physics" — and the agent builds the composition, tracks, and animations. Refine conversationally or in the timeline UI.
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
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">After Effects / Premiere</th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">AI Video Tools</th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--accent)]">Agent-Native Video</th>
              </tr>
            </thead>
            <tbody className="text-[var(--fg-secondary)]">
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Timeline editor</td>
                <td className="px-5 py-3">Professional</td>
                <td className="px-5 py-3">None / basic</td>
                <td className="px-5 py-3 text-[var(--fg)]">Visual tracks + keyframes</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">AI assistance</td>
                <td className="px-5 py-3">None / basic</td>
                <td className="px-5 py-3">Generation only</td>
                <td className="px-5 py-3 text-[var(--fg)]">Full create + edit + iterate</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Programmatic</td>
                <td className="px-5 py-3">ExtendScript</td>
                <td className="px-5 py-3">API-only</td>
                <td className="px-5 py-3 text-[var(--fg)]">React components</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Interactive elements</td>
                <td className="px-5 py-3">Manual</td>
                <td className="px-5 py-3">None</td>
                <td className="px-5 py-3 text-[var(--fg)]">Cursor + hover zones</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Customization</td>
                <td className="px-5 py-3">Plugins</td>
                <td className="px-5 py-3">Templates only</td>
                <td className="px-5 py-3 text-[var(--fg)]">Full source code</td>
              </tr>
              <tr>
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Pricing</td>
                <td className="px-5 py-3">$55+/mo subscription</td>
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
          Fork the video template and start creating compositions with AI.
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
