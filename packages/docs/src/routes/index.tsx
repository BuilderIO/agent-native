import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <main className="page-wrap px-4 pb-8 pt-14">
      <section className="island-shell rise-in relative overflow-hidden rounded-[2rem] px-6 py-10 sm:px-10 sm:py-14">
        <div className="pointer-events-none absolute -left-20 -top-24 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(79,184,178,0.32),transparent_66%)]" />
        <div className="pointer-events-none absolute -bottom-20 -right-20 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(47,106,74,0.18),transparent_66%)]" />
        <p className="island-kicker mb-3">Open Source Framework</p>
        <h1 className="display-title mb-5 max-w-3xl text-4xl leading-[1.02] font-bold tracking-tight text-[var(--sea-ink)] sm:text-6xl">
          Build apps where AI agents are first-class citizens.
        </h1>
        <p className="mb-8 max-w-2xl text-base text-[var(--sea-ink-soft)] sm:text-lg">
          Agent-Native is a framework for building applications where an AI agent and UI share state through files.
          Like Next.js, but for apps where the agent reads, writes, and even modifies the code itself.
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href="/docs"
            className="rounded-full border border-[rgba(50,143,151,0.3)] bg-[rgba(79,184,178,0.14)] px-5 py-2.5 text-sm font-semibold text-[var(--lagoon-deep)] no-underline transition hover:-translate-y-0.5 hover:bg-[rgba(79,184,178,0.24)]"
          >
            Get Started
          </a>
          <a
            href="https://github.com/agent-native"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-[rgba(23,58,64,0.2)] bg-white/50 px-5 py-2.5 text-sm font-semibold text-[var(--sea-ink)] no-underline transition hover:-translate-y-0.5 hover:border-[rgba(23,58,64,0.35)]"
          >
            GitHub
          </a>
        </div>
      </section>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ['Files as Database', 'All state lives in files. UI and agent read/write the same files. No traditional DB needed.'],
          ['AI Through Chat', 'No inline LLM calls. UI delegates to the AI via a chat bridge. Clean separation of concerns.'],
          ['Scripts for Agents', 'pnpm script <name> dispatches to callable scripts the agent can invoke autonomously.'],
          ['Real-time SSE', 'File watcher streams changes to the UI instantly. Agent edits appear in real-time.'],
          ['Agent Updates Code', 'The agent can modify the app itself. Self-evolving applications by design.'],
        ].map(([title, desc], index) => (
          <article
            key={title}
            className="island-shell feature-card rise-in rounded-2xl p-5"
            style={{ animationDelay: `${index * 90 + 80}ms` }}
          >
            <h2 className="mb-2 text-base font-semibold text-[var(--sea-ink)]">{title}</h2>
            <p className="m-0 text-sm text-[var(--sea-ink-soft)]">{desc}</p>
          </article>
        ))}
      </section>

      <section className="island-shell mt-8 rounded-2xl p-6">
        <p className="island-kicker mb-2">Quick Start</p>
        <div className="rounded-xl bg-[var(--surface)] p-4 font-mono text-sm text-[var(--sea-ink)]">
          <div className="text-[var(--sea-ink-soft)]"># Create a new app</div>
          <div>npx @agent-native/core create my-app</div>
          <div>cd my-app</div>
          <div>pnpm install</div>
          <div>pnpm dev</div>
        </div>
      </section>

      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="island-shell rounded-2xl p-6">
          <p className="island-kicker mb-2">Before (40+ lines)</p>
          <pre className="rounded-xl bg-[var(--surface)] p-4 text-xs text-[var(--sea-ink-soft)] overflow-x-auto"><code>{`// vite.config.ts — manual setup
import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { createServer } from "./server";

export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    fs: {
      allow: ["./client", "./shared"],
      deny: [".env", "**/.git/**", "server/**"],
    },
  },
  build: { outDir: "dist/spa" },
  plugins: [react(), expressPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./client"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
}));
// ... plus express plugin function`}</code></pre>
        </div>
        <div className="island-shell rounded-2xl p-6">
          <p className="island-kicker mb-2">After (2 lines)</p>
          <pre className="rounded-xl bg-[var(--surface)] p-4 text-xs text-[var(--sea-ink)] overflow-x-auto"><code>{`// vite.config.ts — with @agent-native/core
import { defineConfig } from "@agent-native/core/vite";

export default defineConfig();`}</code></pre>
        </div>
      </section>

      <section className="island-shell mt-8 rounded-2xl p-6">
        <p className="island-kicker mb-2">Install</p>
        <div className="rounded-xl bg-[var(--surface)] p-4 font-mono text-sm text-[var(--sea-ink)]">
          pnpm add @agent-native/core
        </div>
      </section>
    </main>
  )
}
