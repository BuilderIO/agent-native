import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { templates } from '../../components/TemplateCard'

export const Route = createFileRoute('/templates/slides')({
  component: SlidesTemplate,
  head: () => ({
    meta: [
      { title: 'AI-Native Slides — Open Source AI Presentation Builder' },
      { name: 'description', content: 'Generate and edit presentations with AI. Open source alternative to Google Slides and Pitch. Create slide decks via natural language with visual editing, 8 layouts, image generation, logo search, sharing, and presentation mode.' },
      { property: 'og:title', content: 'AI-Native Slides — Open Source AI Presentation Builder' },
      { property: 'og:description', content: 'Generate and edit presentations with AI. Create slide decks via natural language.' },
      { name: 'keywords', content: 'AI presentation maker, AI slide generator, open source Google Slides alternative, Pitch alternative, AI PowerPoint, AI deck builder, agent-native slides, AI presentation tool, AI slide deck, prompt to presentation' },
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
              Describe the presentation you want, and the agent generates a complete deck — with layouts, content, and AI-generated images.
              Then refine it conversationally or with point-and-click visual editing.
              Eight slide layouts, drag-and-drop reordering, speaker notes, image generation, logo search, sharing, and a full-screen presentation mode.
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
            <img src={template.screenshot} alt="Slides template screenshot" className="w-full object-cover object-top" />
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)] py-16">
        <h2 className="mb-4 text-2xl font-bold tracking-tight">What you can do</h2>
        <p className="mb-8 max-w-2xl text-base leading-relaxed text-[var(--fg-secondary)]">
          A full slide editor and presentation studio with an AI agent. Generate decks from prompts, edit visually, generate images, and present — all in code you own.
        </p>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Prompt-to-Deck</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Describe your presentation topic and audience, optionally attach reference PDFs or images. The agent generates a complete deck with structure, content, layouts, and image prompts.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Visual + Code Editing</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Click any element to edit styles, double-click text to edit content. Switch to code mode for raw HTML control. The agent can also edit slides by writing directly to JSON files.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">8 Slide Layouts</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Title, section divider, content with bullets, two-column, image, statement, full-bleed image, and blank — each with sensible defaults and customizable styling.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">AI Image Generation</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Generate images with Gemini directly in the editor. Style references ensure brand consistency. The agent generates 3 variations and you pick your favorite.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Logo & Image Search</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Search for company logos via Logo.dev or Brandfetch. Search Google Images for stock photos. Upload your own assets. All accessible from the image overlay menu.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Drag & Drop Reordering</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Reorder slides by dragging thumbnails in the sidebar. Duplicate or delete slides with hover actions. Add new slides via prompt at any position.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Presentation Mode</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Full-screen immersive presentation with keyboard navigation, auto-hiding controls, and slide counter. Speaker notes for each slide. Start from any slide.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Sharing & Undo/Redo</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Generate share links for read-only presentation access. Full undo/redo history (Cmd+Z) with labeled entries. Navigate to any point in history.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Conversational Refinement</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              "Make the title bigger." "Add a chart on slide 3." "Change the color scheme to blue." The agent edits slides in real time — changes appear instantly via SSE.
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
                <td className="px-5 py-3 text-[var(--fg)]">Visual + code + agent</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">AI generation</td>
                <td className="px-5 py-3">Basic / none</td>
                <td className="px-5 py-3">One-shot, rigid</td>
                <td className="px-5 py-3 text-[var(--fg)]">Iterative, conversational</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Image generation</td>
                <td className="px-5 py-3">None</td>
                <td className="px-5 py-3">Basic</td>
                <td className="px-5 py-3 text-[var(--fg)]">Gemini with style refs</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Self-improving</td>
                <td className="px-5 py-3">No</td>
                <td className="px-5 py-3">No</td>
                <td className="px-5 py-3 text-[var(--fg)]">Agent modifies the app</td>
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
