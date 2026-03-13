import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import CodeBlock from '../components/CodeBlock'

export const Route = createFileRoute('/')({ component: Home })

const templates = [
  {
    name: 'Analytics',
    replaces: 'Replaces Amplitude, Mixpanel',
    description:
      'Connect any data source, prompt for any chart. Build reusable dashboards — not throwaway Q&A. No SQL required.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
    color: 'var(--accent)',
  },
  {
    name: 'Content',
    replaces: 'Replaces Notion, Google Docs',
    description:
      'Write and organize content with an agent that knows your brand, connects to your CMS, and follows your publishing workflow.',
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
    replaces: 'Replaces Google Slides, Pitch',
    description:
      'Generate and edit React-based presentations via prompt or point-and-click. Describe what you want, refine as you go.',
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
    replaces: 'Replaces manual video editing',
    description:
      'Create and edit Remotion video compositions with agent assistance — from storyboard to render, all in code you own.',
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
    description: 'All state lives in files. The agent and UI read and write the same source of truth. No traditional database needed.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
        <polyline points="13 2 13 9 20 9" />
      </svg>
    ),
  },
  {
    title: 'AI Through the Agent',
    description: 'No inline LLM calls. The UI delegates to the agent via a chat bridge. One AI, always customizable with skills and instructions.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    title: 'Agent Updates Code',
    description: 'The agent can modify the app itself. Your tools get better over time. Fork a template and keep evolving it.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    ),
  },
  {
    title: 'Real-time Sync',
    description: 'File watcher streams changes via SSE. When the agent writes a file, the UI updates instantly. No polling, no refresh.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    ),
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
          Agentic Applications{' '}
          <span className="bg-gradient-to-r from-[var(--accent)] to-[#7928ca] bg-clip-text text-transparent">
            You Own
          </span>
        </h1>

        <p className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-[var(--fg-secondary)]">
          Other products charge you for rigid software you can't customize.
          Agent-native gives you full-featured apps you own, powered by an AI agent that can use and evolve them.
          Fork a template, launch in minutes, customize everything.
        </p>

        <div className="flex items-center justify-center gap-4">
          <a
            href="https://builder.io"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-black no-underline transition hover:bg-gray-200 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            Launch a Template
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </a>
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

      {/* The Trio */}
      <section className="py-20">
        <div className="mb-12 text-center">
          <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
            Agent + UI + Computer
          </h2>
          <p className="mx-auto max-w-2xl text-base leading-relaxed text-[var(--fg-secondary)]">
            Every agent-native app is three things working together: an AI agent, a full application UI, and a computer (file system, browser, code execution). Everything the UI can do, the agent can do — and vice versa.
          </p>
        </div>

        <div className="mx-auto grid max-w-3xl gap-px overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--border)] sm:grid-cols-3">
          <div className="bg-[var(--bg)] p-6 text-center">
            <div className="mb-3 flex justify-center text-[var(--accent)]">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div className="mb-1 text-sm font-semibold">Agent</div>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Autonomous AI that reads, writes, browses, and executes code. Customizable with skills and instructions.
            </p>
          </div>
          <div className="bg-[var(--bg)] p-6 text-center">
            <div className="mb-3 flex justify-center text-[#7928ca]">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="9" y1="21" x2="9" y2="9" />
              </svg>
            </div>
            <div className="mb-1 text-sm font-semibold">Application</div>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Full UI with dashboards, user flows, visualizations. Guided experiences your whole team can use.
            </p>
          </div>
          <div className="bg-[var(--bg)] p-6 text-center">
            <div className="mb-3 flex justify-center text-[#f59e0b]">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>
            <div className="mb-1 text-sm font-semibold">Computer</div>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              File system, browser, code execution. No MCPs needed for most tasks. Agents work directly with files and tools.
            </p>
          </div>
        </div>
      </section>

      {/* Why agent-native */}
      <section className="border-t border-[var(--border)] py-20">
        <div className="mb-12 text-center">
          <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
            The best of both worlds
          </h2>
          <p className="mx-auto max-w-2xl text-base leading-relaxed text-[var(--fg-secondary)]">
            SaaS tools are rigid and bolting AI on as an afterthought. Raw AI agents are powerful but have no UI — throw your team at a chat interface and they don't know what to prompt. Agent-native apps combine both: guided UIs your team can use, powered by an agent that can do anything autonomously.
          </p>
        </div>

        <div className="mx-auto grid max-w-3xl gap-px overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2">
          <div className="bg-[var(--bg)] p-6">
            <div className="mb-2 text-sm font-medium text-red-400">SaaS tools</div>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Polished UI but rigid. Can't customize. AI bolted on. You don't own your data, code, or workflows.
            </p>
          </div>
          <div className="bg-[var(--bg)] p-6">
            <div className="mb-2 text-sm font-medium text-red-400">Raw AI agents</div>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Powerful but no structured UI. No guidance for non-devs. No reusable dashboards — just throwaway Q&A.
            </p>
          </div>
          <div className="bg-[var(--bg)] p-6">
            <div className="mb-2 text-sm font-medium text-red-400">Hacky internal tools</div>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Blank canvas, no real UI or guidance. Months of custom dev work. Everyone working off a blank prompt.
            </p>
          </div>
          <div className="bg-[var(--bg)] p-6">
            <div className="mb-2 text-sm font-medium text-[var(--accent)]">Agent-native apps</div>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Fork a template, launch in minutes. Full UI and AI, deeply connected. The agent can update the app itself. You own everything.
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
            High-quality, vetted templates that replace tools you're paying for — except you own the code and can customize everything.
            Try them with example data before connecting your own sources.
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
              <p className="m-0 text-xs text-[var(--accent)]">{t.replaces}</p>
              <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
                {t.description}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-10 text-center">
          <p className="mb-4 text-sm text-[var(--fg-secondary)]">
            Every template is forkable and open source. The community can build and share their own.
          </p>
          <a
            href="https://builder.io"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-black no-underline transition hover:bg-gray-200 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            Launch a Template in Builder
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </a>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-[var(--border)] py-20">
        <div className="mb-12 text-center">
          <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
            How it works
          </h2>
          <p className="mx-auto max-w-2xl text-base leading-relaxed text-[var(--fg-secondary)]">
            One framework, one mindset. Everything the UI can do, the agent can do via natural language. Everything the agent can do, the UI exposes through point-and-click interfaces.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {principles.map((p) => (
            <div key={p.title} className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
              <div className="mb-3 text-[var(--accent)]">
                {p.icon}
              </div>
              <h3 className="mb-2 text-sm font-semibold">{p.title}</h3>
              <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
                {p.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Built for teams */}
      <section className="border-t border-[var(--border)] py-20">
        <div className="mb-12 text-center">
          <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
            Built for teams
          </h2>
          <p className="mx-auto max-w-2xl text-base leading-relaxed text-[var(--fg-secondary)]">
            Anyone on your team can customize the software to their needs without piling on developers.
            Enterprise-grade roles, permissions, and git-based workflows keep everything manageable at scale.
          </p>
        </div>

        <div className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Roles &amp; Permissions</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Control who can update the app, who can use it, and who can modify agent behavior.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Git-based Workflows</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Pull requests and reviews for software changes that matter. You own your repo.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
            <h3 className="mb-2 text-sm font-semibold">Works Everywhere</h3>
            <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
              Call your agent from Slack, Telegram, or any chat interface. Set up daily digests, automated workflows, and more.
            </p>
          </div>
        </div>
      </section>

      {/* Harnesses */}
      <section className="border-t border-[var(--border)] py-20">
        <div className="mb-12 text-center">
          <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
            Run anywhere
          </h2>
          <p className="mx-auto max-w-2xl text-base leading-relaxed text-[var(--fg-secondary)]">
            Agent-native apps run inside a harness — a host that provides the AI agent alongside your app UI. Run locally with open-source tools or in the cloud with Builder for collaboration and team features.
          </p>
        </div>

        <div className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--border)] p-6">
            <div className="mb-3 flex items-center gap-2">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
              <h3 className="text-base font-semibold">Local / Open Source</h3>
            </div>
            <ul className="m-0 list-none space-y-2 p-0 text-sm text-[var(--fg-secondary)]">
              <li>Run with Claude Code CLI or any local harness</li>
              <li>Full permissions, full control</li>
              <li>Free and open source</li>
              <li>Solo development and testing</li>
            </ul>
          </div>
          <div className="rounded-xl border-2 border-[var(--accent)] p-6">
            <div className="mb-3 flex items-center gap-2">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
              </svg>
              <h3 className="text-base font-semibold">Builder Cloud</h3>
            </div>
            <ul className="m-0 list-none space-y-2 p-0 text-sm text-[var(--fg-secondary)]">
              <li>One-click launch from templates</li>
              <li>Real-time multiplayer collaboration</li>
              <li>Visual editing, roles and permissions</li>
              <li>Cloud computers for every user</li>
            </ul>
          </div>
        </div>

        <p className="mt-6 text-center text-sm text-[var(--fg-secondary)]">
          Your app code is identical regardless of harness. Start local, go to cloud when you need teams.
        </p>
      </section>

      {/* Quick Start */}
      <section className="border-t border-[var(--border)] py-20">
        <div className="mb-12 text-center">
          <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
            Launch in minutes
          </h2>
          <p className="mx-auto max-w-xl text-base text-[var(--fg-secondary)]">
            One command to fork a template locally. Or click to launch in Builder — no setup required.
          </p>
        </div>

        <div className="mx-auto max-w-2xl">
          <CodeBlock code={quickStartCode} lang="bash" />
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="border-t border-[var(--border)] py-20 text-center">
        <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
          Software you own, built for the agentic era
        </h2>
        <p className="mx-auto mb-8 max-w-lg text-base text-[var(--fg-secondary)]">
          Stop renting rigid SaaS. Fork a template, customize it to your exact workflow, and let the agent keep evolving it.
          Open source. Forkable. Yours.
        </p>
        <div className="flex items-center justify-center gap-4">
          <a
            href="https://builder.io"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-black no-underline transition hover:bg-gray-200 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            Launch a Template
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </a>
          <Link
            to="/docs"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
          >
            Read the Docs
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
