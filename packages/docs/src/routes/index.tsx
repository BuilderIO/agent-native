import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import CodeBlock from '../components/CodeBlock'

export const Route = createFileRoute('/')({ component: Home })

const features = [
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
        <polyline points="13 2 13 9 20 9" />
      </svg>
    ),
    title: 'Files as Database',
    description:
      'All state lives in files. UI and agent read/write the same files. No traditional DB needed.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
    title: 'AI Through Chat',
    description:
      'No inline LLM calls. UI delegates to the AI via a chat bridge. Clean separation of concerns.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    ),
    title: 'Scripts for Agents',
    description:
      'pnpm script dispatches to callable scripts the agent can invoke autonomously.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
    title: 'Real-time SSE',
    description:
      'File watcher streams changes to the UI instantly. Agent edits appear in real-time.',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    ),
    title: 'Agent Updates Code',
    description:
      'The agent can modify the app itself. Self-evolving applications by design.',
  },
]

const quickStartCode = `# Create a new agent-native app
npx @agent-native/core create my-app
cd my-app
pnpm install
pnpm dev`

const beforeCode = `// vite.config.ts — manual setup
import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    fs: {
      allow: ["./client", "./shared"],
      deny: [".env", "**/.git/**"],
    },
  },
  build: { outDir: "dist/spa" },
  plugins: [react(), expressPlugin()],
  // ... plus express plugin function
}));`

const afterCode = `// vite.config.ts — with @agent-native/core
import { defineConfig } from "@agent-native/core/vite";

export default defineConfig();`

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
          Now in public beta
        </div>

        <h1 className="mx-auto max-w-3xl">
          The Framework for{' '}
          <span className="bg-gradient-to-r from-[var(--accent)] to-[#7928ca] bg-clip-text text-transparent">
            Agent-Native
          </span>{' '}
          Apps
        </h1>

        <p className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-[var(--fg-secondary)]">
          Build applications where AI agents and UI share state through files.
          Like Next.js, but for agent-native development.
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
            href="https://github.com/agent-native"
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

      {/* Feature Grid */}
      <section className="py-20">
        <div className="mb-12 text-center">
          <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
            What's in Agent-Native?
          </h2>
          <p className="mx-auto max-w-xl text-base text-[var(--fg-secondary)]">
            Everything you need to build apps where AI agents are first-class citizens.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div key={feature.title} className="feature-card flex flex-col gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-light)] text-[var(--accent)]">
                {feature.icon}
              </div>
              <h3 className="text-base font-semibold">{feature.title}</h3>
              <p className="m-0 text-sm leading-relaxed text-[var(--fg-secondary)]">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Quick Start */}
      <section className="border-t border-[var(--border)] py-20">
        <div className="mb-12 text-center">
          <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
            Get running in seconds
          </h2>
          <p className="mx-auto max-w-xl text-base text-[var(--fg-secondary)]">
            One command to scaffold a full agent-native app with React, SSE, and an AI chat bridge.
          </p>
        </div>

        <div className="mx-auto max-w-2xl">
          <CodeBlock code={quickStartCode} lang="bash" />
        </div>
      </section>

      {/* Before / After */}
      <section className="border-t border-[var(--border)] py-20">
        <div className="mb-12 text-center">
          <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
            Less config, more building
          </h2>
          <p className="mx-auto max-w-xl text-base text-[var(--fg-secondary)]">
            Agent-Native replaces boilerplate with sensible defaults. Compare the setup yourself.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-red-500/10 px-3 py-1 text-xs font-medium text-red-500">
                Before
              </span>
              <span className="text-sm text-[var(--fg-secondary)]">40+ lines of config</span>
            </div>
            <CodeBlock code={beforeCode} lang="typescript" />
          </div>
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-green-500/10 px-3 py-1 text-xs font-medium text-green-500">
                After
              </span>
              <span className="text-sm text-[var(--fg-secondary)]">2 lines</span>
            </div>
            <CodeBlock code={afterCode} lang="typescript" />
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="border-t border-[var(--border)] py-20 text-center">
        <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
          Ready to build?
        </h2>
        <p className="mx-auto mb-8 max-w-md text-base text-[var(--fg-secondary)]">
          Start building agent-native apps today. Open source and free forever.
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
            href="https://github.com/agent-native"
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
