import { createFileRoute } from "@tanstack/react-router";
import DocsLayout from "../../components/DocsLayout";
import CodeBlock from "../../components/CodeBlock";

export const Route = createFileRoute("/docs/")({ component: DocsIndex });

const TOC = [
  { id: "installation", label: "Installation" },
  { id: "project-structure", label: "Project Structure" },
  { id: "vite-configuration", label: "Vite Configuration" },
  { id: "typescript-tailwind", label: "TypeScript & Tailwind" },
  { id: "subpath-exports", label: "Subpath Exports" },
  { id: "architecture-principles", label: "Architecture Principles" },
];

function DocsIndex() {
  return (
    <DocsLayout toc={TOC}>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">
        Getting Started
      </h1>
      <p className="mb-4 text-base text-[var(--fg-secondary)]">
        Welcome to the Agent-Native documentation!
      </p>

      <h2 id="installation">Installation</h2>
      <p>Create a new project:</p>
      <CodeBlock code="npx @agent-native/core create my-app" lang="bash" />

      <h2 id="project-structure">Project Structure</h2>
      <p>Every agent-native app follows the same convention:</p>
      <CodeBlock
        code={`my-app/
  client/          # React frontend (Vite SPA)
    App.tsx        # Entry point
    components/    # UI components
    lib/utils.ts   # cn() utility
  server/          # Express backend
    index.ts       # createAppServer()
    node-build.ts  # Production entry point
  shared/          # Isomorphic code (client & server)
  scripts/         # Agent-callable scripts
    run.ts         # Script dispatcher
  data/            # App data files (watched by SSE)`}
        lang="text"
      />

      <h2 id="vite-configuration">Vite Configuration</h2>
      <p>Two config files — client SPA and server build:</p>
      <CodeBlock
        code={`// vite.config.ts
import { defineConfig } from "@agent-native/core/vite";
export default defineConfig();`}
      />
      <CodeBlock
        code={`// vite.config.server.ts
import { defineServerConfig } from "@agent-native/core/vite";
export default defineServerConfig();`}
      />
      <p>
        <code>defineConfig()</code> sets up React SWC, path aliases (
        <code>@/</code> {"->"} <code>client/</code>, <code>@shared/</code>{" "}
        {"->"} <code>shared/</code>), fs restrictions, and the Express dev
        plugin.
      </p>

      <h2 id="typescript-tailwind">TypeScript & Tailwind</h2>
      <CodeBlock
        code={`// tsconfig.json
{ "extends": "@agent-native/core/tsconfig.base.json" }`}
      />
      <CodeBlock
        code={`// tailwind.config.ts
import type { Config } from "tailwindcss";
import preset from "@agent-native/core/tailwind";

export default {
  presets: [preset],
  content: ["./client/**/*.{ts,tsx}"],
} satisfies Config;`}
      />

      <h2 id="subpath-exports">Subpath Exports</h2>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Import</th>
              <th>Exports</th>
            </tr>
          </thead>
          <tbody>
            {[
              [
                "@agent-native/core",
                "Server, client, scripts: createServer, createFileWatcher, createSSEHandler, createProductionServer, runScript, parseArgs, loadEnv, fail, agentChat, sendToAgentChat, useAgentChatGenerating, useFileWatcher, cn",
              ],
              [
                "@agent-native/core/vite",
                "defineConfig(), defineServerConfig()",
              ],
              [
                "@agent-native/core/tailwind",
                "Tailwind preset (HSL colors, shadcn/ui tokens, animations)",
              ],
              [
                "@agent-native/core/adapters/firestore",
                "FileSync, threeWayMerge, loadSyncConfig",
              ],
            ].map(([imp, desc]) => (
              <tr key={imp}>
                <td>{imp}</td>
                <td>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="architecture-principles">Architecture Principles</h2>
      <ol className="list-decimal space-y-3 pl-5">
        <li>
          <strong>Files as database</strong> — All app state lives in files.
          Both UI and agent read/write the same files.
        </li>
        <li>
          <strong>All AI through agent chat</strong> — No inline LLM calls. UI
          delegates to the AI via <code>sendToAgentChat()</code>.
        </li>
        <li>
          <strong>Scripts for agent ops</strong> —{" "}
          <code>pnpm script &lt;name&gt;</code> dispatches to callable script
          files.
        </li>
        <li>
          <strong>Bidirectional SSE events</strong> — File watcher keeps UI in
          sync with agent changes in real-time.
        </li>
        <li>
          <strong>Agent can update code</strong> — The agent modifies the app
          itself.
        </li>
      </ol>
    </DocsLayout>
  );
}
