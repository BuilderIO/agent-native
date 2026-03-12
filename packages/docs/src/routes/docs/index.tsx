import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/docs/')({ component: DocsIndex })

function DocsIndex() {
  return (
    <main className="page-wrap px-4 pb-8 pt-10">
      <h1 className="display-title mb-4 text-3xl font-bold tracking-tight text-[var(--sea-ink)] sm:text-4xl">
        Getting Started
      </h1>
      <p className="mb-8 max-w-2xl text-base text-[var(--sea-ink-soft)]">
        Agent-Native is a framework for building apps where an AI agent and UI share state through files.
      </p>

      <section className="prose-section mb-10">
        <h2>Installation</h2>
        <p>Create a new project:</p>
        <Pre code="npx @agent-native/core create my-app" />
        <p>Or add to an existing project:</p>
        <Pre code="pnpm add @agent-native/core" />
      </section>

      <section className="prose-section mb-10">
        <h2>Project Structure</h2>
        <p>Every agent-native app follows the same convention:</p>
        <Pre code={`my-app/
  client/          # React frontend (Vite SPA)
    App.tsx        # Entry point
    components/    # UI components
    lib/utils.ts   # cn() utility
  server/          # Express backend
    index.ts       # createAppServer() — routes + middleware
    node-build.ts  # Production entry point
  shared/          # Isomorphic code (client & server)
  scripts/         # Agent-callable scripts
    run.ts         # Script dispatcher
  data/            # App data files (watched by SSE)`} />
      </section>

      <section className="prose-section mb-10">
        <h2>Vite Configuration</h2>
        <p>Two config files — client SPA and server build:</p>
        <Pre code={`// vite.config.ts
import { defineConfig } from "@agent-native/core/vite";
export default defineConfig();`} />
        <Pre code={`// vite.config.server.ts
import { defineServerConfig } from "@agent-native/core/vite";
export default defineServerConfig();`} />
        <p>
          <code>defineConfig()</code> sets up React SWC, path aliases (<code>@/</code> → <code>client/</code>,{' '}
          <code>@shared/</code> → <code>shared/</code>), fs restrictions, and the Express dev plugin
          that mounts your server as Vite middleware.
        </p>
      </section>

      <section className="prose-section mb-10">
        <h2>TypeScript & Tailwind</h2>
        <Pre code={`// tsconfig.json
{ "extends": "@agent-native/core/tsconfig.base.json" }`} />
        <Pre code={`// tailwind.config.ts
import type { Config } from "tailwindcss";
import preset from "@agent-native/core/tailwind";

export default {
  presets: [preset],
  content: ["./client/**/*.{ts,tsx}"],
} satisfies Config;`} />
      </section>

      <section className="prose-section mb-10">
        <h2>Subpath Exports</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--line)]">
                <th className="py-2 pr-4 text-left font-semibold text-[var(--sea-ink)]">Import</th>
                <th className="py-2 text-left font-semibold text-[var(--sea-ink)]">Exports</th>
              </tr>
            </thead>
            <tbody className="text-[var(--sea-ink-soft)]">
              {[
                ['@agent-native/core/vite', 'defineConfig(), defineServerConfig()'],
                ['@agent-native/core/server', 'createServer(), createFileWatcher(), createSSEHandler(), createProductionServer()'],
                ['@agent-native/core/client', 'sendToFusionChat(), useFusionChatGenerating(), useFileWatcher(), cn()'],
                ['@agent-native/core/shared', 'fusionChat.send(), .submit(), .prefill()'],
                ['@agent-native/core/scripts', 'runScript(), parseArgs(), loadEnv(), fail(), isValidPath()'],
                ['@agent-native/core/tailwind', 'Tailwind preset (HSL colors, shadcn/ui tokens, animations)'],
                ['@agent-native/core/adapters/firestore', 'FileSync, threeWayMerge, loadSyncConfig'],
              ].map(([imp, desc]) => (
                <tr key={imp} className="border-b border-[var(--line)]">
                  <td className="py-2 pr-4 font-mono text-xs text-[var(--lagoon-deep)]">{imp}</td>
                  <td className="py-2">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="prose-section mb-10">
        <h2>Architecture Principles</h2>
        <ol className="list-decimal space-y-3 pl-5 text-[var(--sea-ink-soft)]">
          <li><strong className="text-[var(--sea-ink)]">Files as database</strong> — All app state lives in files. Both UI and agent read/write the same files.</li>
          <li><strong className="text-[var(--sea-ink)]">All AI through agent chat</strong> — No inline LLM calls. UI delegates to the AI via <code>sendToFusionChat()</code>.</li>
          <li><strong className="text-[var(--sea-ink)]">Scripts for agent ops</strong> — <code>pnpm script &lt;name&gt;</code> dispatches to callable script files.</li>
          <li><strong className="text-[var(--sea-ink)]">Bidirectional SSE events</strong> — File watcher keeps UI in sync with agent changes in real-time.</li>
          <li><strong className="text-[var(--sea-ink)]">Agent can update code</strong> — The agent modifies the app itself.</li>
        </ol>
      </section>
    </main>
  )
}

function Pre({ code }: { code: string }) {
  return (
    <pre className="my-3 overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 text-xs leading-relaxed text-[var(--sea-ink)]">
      <code>{code}</code>
    </pre>
  )
}
