import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, useRef } from 'react'
import CodeBlock from '../components/CodeBlock'
import { templates, TemplateCard } from '../components/TemplateCard'

export const Route = createFileRoute('/')({ component: Home })


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


function TemplateCarousel() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(true)

  function updateScrollState() {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 4)
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4)
  }

  function scroll(dir: 'left' | 'right') {
    const el = scrollRef.current
    if (!el) return
    const cardWidth = 380 + 16 // card + gap
    el.scrollBy({ left: dir === 'left' ? -cardWidth : cardWidth, behavior: 'smooth' })
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => scroll('left')}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg)] text-[var(--fg-secondary)] shadow-sm transition hover:border-[var(--fg-secondary)] hover:text-[var(--fg)] ${canScrollLeft ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        aria-label="Scroll left"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      <div
        ref={scrollRef}
        onScroll={updateScrollState}
        className="min-w-0 flex-1 overflow-x-auto pb-4 scrollbar-hide"
      >
        <div className="flex gap-4" style={{ width: 'max-content' }}>
          {templates.map((t) => (
            <div key={t.name} className="w-[calc((1200px-2*16px)/3)] max-w-[380px] min-w-[300px] shrink-0">
              <TemplateCard template={t} />
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={() => scroll('right')}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg)] text-[var(--fg-secondary)] shadow-sm transition hover:border-[var(--fg-secondary)] hover:text-[var(--fg)] ${canScrollRight ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        aria-label="Scroll right"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>
  )
}

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
    <>
    <main className="mx-auto max-w-[1200px] px-6">
      {/* Hero */}
      <section className="hero-section">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-1.5 text-sm text-[var(--fg-secondary)]">
          <span className="inline-block h-2 w-2 rounded-full bg-[var(--accent)]" />
          Open source framework
        </div>

        <h1 className="mx-auto max-w-3xl">
          Agentic Applications{' '}
          <span className="inline-block bg-gradient-to-r from-[var(--accent)] to-[#7928ca] bg-clip-text text-transparent">
            You Own
          </span>
        </h1>

        <p className="mx-auto mb-10 max-w-xl text-lg leading-relaxed text-[var(--fg-secondary)]">
          SaaS products lock you into rigid software you can't customize.
          Agent-native gives you full-featured apps you own, powered by an AI agent that can evolve them.
        </p>

        <div className="flex items-center justify-center gap-4">
          <Link
            to="/templates"
            className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-black no-underline transition hover:bg-gray-200 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            Launch a Template
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

      {/* SaaS vs Agents comparison */}
      <section className="border-t border-[var(--border)] py-20">
        <div className="mb-12 text-center">
          <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
            SaaS Tools vs Raw AI Agents
          </h2>
          <p className="mx-auto max-w-2xl text-base leading-relaxed text-[var(--fg-secondary)]">
            Both existing approaches fall short. SaaS tools give you a polished UI but lock you into rigid workflows. Raw AI agents are powerful but leave your team staring at a blank chat prompt.
          </p>
        </div>

        <div className="approaches-table-wrapper">
          <div className="approaches-table-scroll">
            <table className="approaches-table">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--bg-secondary)]">
                  <th className="approaches-th approaches-col-dim">Dimension</th>
                  <th className="approaches-th approaches-col-saas">
                    <span className="approaches-col-label--bad">SaaS Tools</span>
                  </th>
                  <th className="approaches-th approaches-col-agent">
                    <span className="approaches-col-label--bad">Raw AI Agents</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-[var(--border)]">
                  <td className="approaches-td approaches-td--dim">UI</td>
                  <td className="approaches-td">Polished but rigid</td>
                  <td className="approaches-td">None</td>
                </tr>
                <tr className="border-b border-[var(--border)]">
                  <td className="approaches-td approaches-td--dim">AI</td>
                  <td className="approaches-td">Bolted on</td>
                  <td className="approaches-td">Powerful, no guardrails</td>
                </tr>
                <tr className="border-b border-[var(--border)]">
                  <td className="approaches-td approaches-td--dim">Customization</td>
                  <td className="approaches-td">Can't</td>
                  <td className="approaches-td">Prompt-only</td>
                </tr>
                <tr className="border-b border-[var(--border)]">
                  <td className="approaches-td approaches-td--dim">Ownership</td>
                  <td className="approaches-td">Rented</td>
                  <td className="approaches-td">N/A</td>
                </tr>
                <tr>
                  <td className="approaches-td approaches-td--dim">Non-dev friendly</td>
                  <td className="approaches-td">Yes</td>
                  <td className="approaches-td">No</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="approaches-solution">
          <div className="approaches-solution-badge">The solution</div>
          <p className="approaches-solution-tagline">Agent + UI + Computer</p>
          <p className="approaches-solution-desc">
            Agent-native apps combine a polished, guided UI with a powerful AI agent that can customize and evolve the app itself — giving your whole team the best of both worlds.
          </p>
        </div>
      </section>

      </main>

      {/* Templates - breaks out of max-width on ultra-wide screens */}
      <section className="py-20 px-6">
        <div className="mb-12 text-center">
          <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
            Start with a full featured template
          </h2>
          <p className="mx-auto max-w-2xl text-base leading-relaxed text-[var(--fg-secondary)]">
            High-quality, vetted templates that replace tools you're paying for — except you own the code and can customize everything.
            Try them with example data before connecting your own sources.
          </p>
        </div>

        {/* Mobile: vertical stack */}
        <div className="md:hidden">
          <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-5">
            {templates.map((t) => (
              <TemplateCard key={t.name} template={t} />
            ))}
          </div>
        </div>

        {/* Tablet/desktop carousel */}
        <div className="hidden md:block 2xl:hidden">
          <div className="mx-auto max-w-[1200px]">
            <TemplateCarousel />
          </div>
        </div>

        {/* Ultra-wide: 4-column grid */}
        <div className="hidden 2xl:block">
          <div className="mx-auto grid max-w-[1680px] grid-cols-4 gap-5">
            {templates.map((t) => (
              <TemplateCard key={t.name} template={t} />
            ))}
          </div>
        </div>

        <div className="mt-8 text-center">
          <Link
            to="/templates"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)] hover:no-underline"
          >
            View all templates
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>
        </div>
      </section>

      <main className="mx-auto max-w-[1200px] px-6">

      {/* The best of both worlds */}
      <section className="border-t border-[var(--border)] py-20">
        <div className="mb-12 text-center">
          <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
            The best of both worlds
          </h2>
          <p className="mx-auto max-w-2xl text-base leading-relaxed text-[var(--fg-secondary)]">
            SaaS tools are rigid and bolting AI on as an afterthought. Raw AI agents are powerful but have no UI — throw your team at a chat interface and they don't know what to prompt. Agent-native apps combine both.
          </p>
        </div>

        <div className="mx-auto max-w-3xl overflow-hidden rounded-xl border border-[var(--border)]">
          <table className="comparison-table w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--bg-secondary)]">
                <th className="px-5 py-3 text-left font-semibold text-[var(--fg)]"></th>
                <th className="px-5 py-3 text-left font-semibold text-red-400">SaaS Tools</th>
                <th className="px-5 py-3 text-left font-semibold text-red-400">Raw AI Agents</th>
                <th className="px-5 py-3 text-left font-semibold text-red-400">Internal Tools</th>
                <th className="px-5 py-3 text-left font-semibold text-[var(--accent)]">Agent-Native</th>
              </tr>
            </thead>
            <tbody className="text-[var(--fg-secondary)]">
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">UI</td>
                <td className="px-5 py-3">Polished but rigid</td>
                <td className="px-5 py-3">None</td>
                <td className="px-5 py-3">Months to build</td>
                <td className="px-5 py-3 text-[var(--fg)]">Full UI, fork &amp; go</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">AI</td>
                <td className="px-5 py-3">Bolted on</td>
                <td className="px-5 py-3">Powerful, no guardrails</td>
                <td className="px-5 py-3">Disconnected</td>
                <td className="px-5 py-3 text-[var(--fg)]">Agent-first, deeply integrated</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Customization</td>
                <td className="px-5 py-3">Can't</td>
                <td className="px-5 py-3">Prompt-only</td>
                <td className="px-5 py-3">Full but slow</td>
                <td className="px-5 py-3 text-[var(--fg)]">Agent modifies the app</td>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Ownership</td>
                <td className="px-5 py-3">Rented</td>
                <td className="px-5 py-3">N/A</td>
                <td className="px-5 py-3">Yours but costly</td>
                <td className="px-5 py-3 text-[var(--fg)]">You own the code</td>
              </tr>
              <tr>
                <td className="px-5 py-3 font-medium text-[var(--fg)]">Non-dev friendly</td>
                <td className="px-5 py-3">Yes</td>
                <td className="px-5 py-3">No</td>
                <td className="px-5 py-3">Rarely</td>
                <td className="px-5 py-3 text-[var(--fg)]">Guided UI + agent</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* The Trio */}
      <section className="border-t border-[var(--border)] py-20">
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
              <h3 className="text-base font-semibold">Builder.io Cloud</h3>
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
          <Link
            to="/templates"
            className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-black no-underline transition hover:bg-gray-200 hover:no-underline dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            Launch a Template
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>
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
    </>
  )
}
