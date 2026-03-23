import { createFileRoute } from "@tanstack/react-router";
import DocsLayout from "../../components/DocsLayout";
import CodeBlock from "../../components/CodeBlock";

export const Route = createFileRoute("/docs/harnesses")({
  component: HarnessesDocs,
});

const TOC = [
  { id: "cli-harness", label: "CLI Harness" },
  { id: "supported-clis", label: "Supported CLIs" },
  { id: "cloud-harness", label: "Builder.io Cloud Harness" },
  { id: "feature-comparison", label: "Feature Comparison" },
  { id: "how-it-works", label: "How It Works" },
];

function HarnessesDocs() {
  return (
    <DocsLayout toc={TOC}>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">Harnesses</h1>
      <p className="mb-4 text-base text-[var(--fg-secondary)]">
        Agent-native apps run inside a <strong>harness</strong> — a host
        environment that provides the AI agent and displays the app UI side by
        side.
      </p>

      <h2 id="cli-harness">CLI Harness (Local)</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          Open source, ships with <code>@agent-native/harness-cli</code>
        </li>
        <li>
          Runs locally — xterm.js terminal on the left, your app iframe on the
          right
        </li>
        <li>
          Supports multiple AI coding CLIs — switch between them from the
          settings panel
        </li>
        <li>Auto-installs missing CLIs on first use</li>
        <li>Per-CLI launch flags and settings, persisted to localStorage</li>
        <li>
          Auto-detects when the agent finishes generating and notifies the app
        </li>
        <li>Great for local use — individuals, development, and testing</li>
      </ul>

      <p>Quick start:</p>
      <CodeBlock
        code={`# In your agent-native monorepo
pnpm dev:harness`}
      />

      <h2 id="supported-clis">Supported CLIs</h2>
      <table>
        <thead>
          <tr>
            <th>CLI</th>
            <th>Command</th>
            <th>Key Flags</th>
          </tr>
        </thead>
        <tbody>
          {[
            [
              "Claude Code",
              "claude",
              "--dangerously-skip-permissions, --resume, --verbose",
            ],
            ["Codex", "codex", "--full-auto, --quiet"],
            ["Gemini CLI", "gemini", "--sandbox"],
            ["OpenCode", "opencode", "—"],
            ["Builder.io / Fusion", "fusion", "—"],
          ].map(([name, cmd, flags]) => (
            <tr key={cmd}>
              <td>{name}</td>
              <td>
                <code>{cmd}</code>
              </td>
              <td>{flags}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Switch between CLIs at any time from the settings panel. The harness
        restarts the terminal with the selected CLI and loads its saved launch
        options.
      </p>

      <h2 id="cloud-harness">
        <a
          href="https://www.builder.io"
          target="_blank"
          rel="noopener noreferrer"
        >
          Builder.io Cloud Harness
        </a>
      </h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Runs in the cloud</li>
        <li>
          Real-time collaboration — multiple users can watch/interact
          simultaneously
        </li>
        <li>Visual editing, roles and permissions</li>
        <li>Parallel agent execution for faster iteration</li>
        <li>Great for team use</li>
      </ul>

      <h2 id="feature-comparison">Feature Comparison</h2>
      <table>
        <thead>
          <tr>
            <th>Feature</th>
            <th>CLI Harness</th>
            <th>Builder.io Cloud Harness</th>
          </tr>
        </thead>
        <tbody>
          {[
            ["Local development", "Yes", "Yes"],
            ["Cloud/remote", "No", "Yes"],
            ["Multi-CLI support", "Yes (5 CLIs)", "Yes"],
            ["Real-time collaboration", "No", "Yes"],
            ["Visual editing", "No", "Yes"],
            ["Parallel agents", "No", "Yes"],
            ["Agent chat bridge", "Yes", "Yes"],
            ["File watcher (SSE)", "Yes", "Yes"],
            ["Script system", "Yes", "Yes"],
            ["Open source", "Yes", "No"],
          ].map(([feature, cli, builder]) => (
            <tr key={feature}>
              <td>{feature}</td>
              <td>{cli}</td>
              <td>{builder}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 id="how-it-works">How It Works</h2>
      <p>
        Both harnesses support the same core agent-native protocol. The
        framework provides type-safe APIs so you never deal with raw messaging:
      </p>
      <ol className="list-decimal space-y-3 pl-5">
        <li>
          <strong>Agent chat</strong> — use <code>sendToAgentChat()</code> to
          send messages to the agent
        </li>
        <li>
          <strong>Generation state</strong> — use{" "}
          <code>useAgentChatGenerating()</code> to track when the agent is
          running
        </li>
        <li>
          <strong>File watching</strong> — SSE endpoint keeps UI in sync when
          the agent modifies files
        </li>
        <li>
          <strong>Script system</strong> — <code>pnpm script {"<name>"}</code>{" "}
          dispatches to callable scripts
        </li>
      </ol>
      <p>
        Your app code is identical regardless of which harness or CLI you use.
      </p>
    </DocsLayout>
  );
}
