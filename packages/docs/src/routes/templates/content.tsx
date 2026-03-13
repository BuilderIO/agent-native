import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { templates } from '../../components/TemplateCard'

export const Route = createFileRoute('/templates/content')({
  component: ContentTemplate,
  head: () => ({
    meta: [
      { title: 'AI-Native Content — Open Source Alternative to Notion & Google Docs' },
      { name: 'description', content: 'Write and organize content with an AI agent that knows your brand. Open source alternative to Notion and Google Docs. AI-powered writing, editing, and publishing workflows you own.' },
      { property: 'og:title', content: 'AI-Native Content — Open Source Alternative to Notion & Google Docs' },
      { property: 'og:description', content: 'Write and organize content with an AI agent that knows your brand.' },
      { name: 'keywords', content: 'AI content editor, open source Notion alternative, Google Docs alternative, AI writing tool, AI content management, agent-native content, AI-powered CMS, AI document editor, AI content creation, open source writing app' },
    ],
  }),
})

const template = templates.find((t) => t.slug === 'content')!

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

function ContentTemplate() {
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
              AI-Native Content
            </h1>

            <p className="mb-6 text-lg leading-relaxed text-[var(--fg-secondary)]">
              Stop writing in tools that don't understand your brand.
              This template gives you a full content workspace with an AI agent that knows your voice, connects to your CMS, and follows your publishing workflow.
              Projects, documents, media management, and a rich editor — all backed by files you own.
              The agent can create drafts, rewrite copy, organize your content library, and even modify the app to add features you need.
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
            <img src={template.screenshot} alt="Content template screenshot" className="w-full object-cover object-top" />
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--border)] py-16">
        <h2 className="mb-4 text-2xl font-bold tracking-tight">What you can do</h2>
        <p className="mb-8 max-w-2xl text-base leading-relaxed text-[var(--fg-secondary)]">
          A complete content workspace with AI built in. Organize projects, write documents, manage media, and publish — all with an agent that understands your brand.
        </p>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Project & Document Organization</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Organize content into projects with nested documents and resource files. A sidebar with tree navigation, search, and quick switching — like Notion, but you own the code.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Rich Text Editor</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              A full-featured editor with formatting, headings, lists, code blocks, and embedded media. All content stored as files — markdown, HTML, or any format you prefer.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Brand-Aware AI Writing</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              The agent learns your brand voice, style guide, and tone through instructions and examples. Every draft sounds like you, not a chatbot. Feedback makes it smarter over time.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Media Management</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Browse and manage media assets alongside your content. Upload images, reference files, and resources — all stored in the file system and accessible to the agent.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">CMS Publishing</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Connect to WordPress, Contentful, Builder, or any headless CMS via scripts. Write here, publish everywhere. The agent can handle the entire workflow.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">AI Editing & Rewriting</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Ask the agent to rewrite, expand, summarize, or adjust tone on any selection. It edits files directly and the UI updates in real time via SSE.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Real-Time Sync</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Agent edits appear instantly. Files are the single source of truth — when the agent writes to a file, SSE broadcasts the change and the UI updates without refresh.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Script Automation</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Callable scripts for batch operations — bulk content generation, cross-referencing, publishing pipelines, and more. The agent runs scripts autonomously when needed.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Fully Open Source</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Fork the template, own the code, customize everything. No vendor lock-in, no per-seat pricing. Your content stays on your infrastructure.
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
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">Notion / Google Docs</th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg-secondary)]">ChatGPT / Claude</th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--accent)]">Agent-Native Content</th>
              </tr>
            </thead>
            <tbody className="text-[var(--fg-secondary)]">
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Editor UI</td>
                <td className="px-5 py-3">Full, rigid</td>
                <td className="px-5 py-3">Chat only</td>
                <td className="px-5 py-3 text-[var(--fg)]">Full, customizable</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Brand awareness</td>
                <td className="px-5 py-3">None</td>
                <td className="px-5 py-3">Per-conversation</td>
                <td className="px-5 py-3 text-[var(--fg)]">Persistent, trained</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">CMS publishing</td>
                <td className="px-5 py-3">Separate step</td>
                <td className="px-5 py-3">Manual copy-paste</td>
                <td className="px-5 py-3 text-[var(--fg)]">Integrated workflow</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Self-improving</td>
                <td className="px-5 py-3">No</td>
                <td className="px-5 py-3">No</td>
                <td className="px-5 py-3 text-[var(--fg)]">Agent modifies the app</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Customization</td>
                <td className="px-5 py-3">Plugins only</td>
                <td className="px-5 py-3">Prompt only</td>
                <td className="px-5 py-3 text-[var(--fg)]">Full source code</td>
              </tr>
              <tr>
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Pricing</td>
                <td className="px-5 py-3">Per-seat</td>
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
          Fork the content template, connect your CMS, and start writing with AI that knows your brand.
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
