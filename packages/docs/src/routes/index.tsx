import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import CodeBlock from '../components/CodeBlock'

export const Route = createFileRoute('/')({ component: Home })

const templates = [
  {
    name: 'Analytics',
    description:
      'Agent-native Amplitude. Prompt for any chart, answer any question, connect to any data source. No SQL required.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
    color: 'var(--accent)',
  },
  {
    name: 'Content',
    description:
      'Agent-native Notion. Write, edit, and organize content with an agent that understands your brand and publishing workflow.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    ),
    color: '#7928ca',
  },
  {
    name: 'Slides',
    description:
      'Agent-native Google Slides. Generate and edit React-based presentations via prompt or UI. Describe what you want and refine.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
    color: '#f59e0b',
  },
  {
    name: 'Video',
    description:
      'Agent-native video generation. Create and edit Remotion compositions with agent assistance — from storyboard to render.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="23 7 16 12 23 17 23 7" />
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </svg>
    ),
    color: '#ec4899',
  },
]

const principles = [
  {
    title: 'Files as Database',
    description: 'All state lives in files. UI and agent read/write the same files. No traditional DB needed.',
  },
  {
    title: 'AI Through Chat',
    description: 'No inline LLM calls. The UI delegates to the AI agent via a chat bridge.',
  },
  {
    title: 'Agent Updates Code',
    description: 'The agent can modify the app itself. Fork a template and keep evolving it.',
  },
  {
    title: 'Real-time SSE',
    description: 'File watcher streams changes to the UI instantly. Agent edits appear in real-time.',
  },
]

const quickStartCode = `# Fork a template and start building
npx @agent-native/core create my-app --template analytics
cd my-app
pnpm install
pnpm dev`

function TerminalCommand() {
  const [copied, setCopied] = useState(false)
  const command = 'npx @agent-native/core create my-app'

  function handleCopy() {
    navigator.clipboard.writeText(command)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="group mx-auto mt-8 flex items-center gap-3 rounded-lg border border-[var(--code-border)] bg-[var(--code-bg)] px-5 py-3 font-mono text-sm transition hover:border-[var(--fg-secondary)]"
    >
      <span className="text-[var(--fg-secondary)]">$</span>
      <span className="text-[var(--fg)]">{command}</span>
      <span className="ml-2 text-[var(--fg-secondary)] opacity-0 transition group-hover:opacity-100">
        {copied ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </span>
    </button>
  )
}

function Home() {
  return (
    <main className="mx-auto max-w-[1200px] px-6">
      {/* Hero */}
      <section className="hero-section">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-1.5 text-sm text-[var(--fg-secondary)]">
          <span className="inline-block h-2 w-2 rounded-full bg-[var(--accent)]" />
          Open source framework
        </div>

        <h1 className="mx-auto max-w-3xl">
          Software You{' '}
          <span className="bg-gradient-to-r from-[var(--accent)] to-[#7928ca] bg-clip-text text-transparent">
            Own
          </span>
          , Powered by AI
        </h1>

        <p className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-[var(--fg-secondary)]">
          Agent-native apps give you the power of SaaS with the control of custom software.
          Fork a template, launch in minutes, and let AI help you customize it to your exact needs.
        </p>

        <div className="flex items-center justify-center gap-4">
          <Link
            to="/docs"
            className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-black no-underline transition hover:bg-gray-200 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            Get Started
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>
          <a
            href="https://github.com/BuilderIO/agent-native"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
            GitHub
          </a>
        </div>

        <TerminalCommand />
      </section>

      {/* The Problem */}
      <section className="py-20">
        <div className="mb-12 text-center">
          <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
            The best of both worlds
          </h2>
          <p className="mx-auto max-w-2xl text-base leading-relaxed text-[var(--fg-secondary)]">
            SaaS tools aren't built for AI. Chat-based agents have no UI. Custom apps take months to build.
            Agent-native apps are a new category — fork a template, own the code, and let AI evolve it with you.
          </p>
        </div>

        <div className="mx-auto grid max-w-3xl gap-px overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2">
          <div className="bg-[var(--bg)] p-6">
            <div className="mb-2 text-sm font-medium text-red-400">SaaS tools</div>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Polished UI but rigid. Can't customize. AI bolted on as an afterthought. You don't own your data or workflows.
            </p>
          </div>
          <div className="bg-[var(--bg)] p-6">
            <div className="mb-2 text-sm font-medium text-red-400">Raw AI agents</div>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Powerful but no structured UI. Inaccessible to non-devs. No guardrails, no real-time collaboration.
            </p>
          </div>
          <div className="bg-[var(--bg)] p-6">
            <div className="mb-2 text-sm font-medium text-red-400">Custom apps</div>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Full control but months of work. AI is disconnected from the UI. Can't see what you see or react to what you click.
            </p>
          </div>
          <div className="bg-[var(--bg)] p-6">
            <div className="mb-2 text-sm font-medium text-[var(--accent)]">Agent-native apps</div>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Fork a template, launch in minutes. Own the code. AI and UI are unified — the agent can update the app itself.
            </p>
          </div>
        </div>
      </section>

      {/* Templates */}
      <section className="border-t border-[var(--border)] py-20">
        <div className="mb-12 text-center">
          <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
            Start from a template
          </h2>
          <p className="mx-auto max-w-2xl text-base leading-relaxed text-[var(--fg-secondary)]">
            Each template is a fully working app you can launch in minutes and customize over time.
            Every feature works with AI — if it doesn't, we don't ship it.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {templates.map((t) => (
            <div key={t.name} className="feature-card flex flex-col gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${t.color}15`, color: t.color }}
              >
                {t.icon}
              </div>
              <h3 className="text-base font-semibold">{t.name}</h3>
              <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
                {t.description}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-[var(--fg-secondary)]">
          Every template is forkable and open source. Connect your own data sources, customize the UI, extend with new features — all by asking.
        </p>
      </section>

      {/* How it works */}
      <section className="border-t border-[var(--border)] py-20">
        <div className="mb-12 text-center">
          <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
            How it works
          </h2>
          <p className="mx-auto max-w-2xl text-base leading-relaxed text-[var(--fg-secondary)]">
            The agent and the UI are one. Your app lives inside the agent workspace. Anything the UI can do, the agent can do via natural language — and vice versa.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {principles.map((p) => (
            <div key={p.title} className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
              <h3 className="mb-2 text-sm font-semibold">{p.title}</h3>
              <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
                {p.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Quick Start */}
      <section className="border-t border-[var(--border)] py-20">
        <div className="mb-12 text-center">
          <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
            Launch in minutes
          </h2>
          <p className="mx-auto max-w-xl text-base text-[var(--fg-secondary)]">
            One command to fork a template. Connect your integrations, and start building.
          </p>
        </div>

        <div className="mx-auto max-w-2xl">
          <CodeBlock code={quickStartCode} lang="bash" />
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="border-t border-[var(--border)] py-20 text-center">
        <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
          Own your software
        </h2>
        <p className="mx-auto mb-8 max-w-lg text-base text-[var(--fg-secondary)]">
          Stop renting rigid SaaS. Fork a template, customize it to your exact workflow, and let AI keep evolving it. Open source and free forever.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link
            to="/docs"
            className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-black no-underline transition hover:bg-gray-200 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            Read the Docs
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>
          <a
            href="https://github.com/BuilderIO/agent-native"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
          >
            View on GitHub
          </a>
        </div>
      </section>
    </main>
  )
}
