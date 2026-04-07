import DocsLayout from "../components/DocsLayout";

const TOC = [
  { id: "embedded-agent", label: "Embedded Agent Panel" },
  { id: "supported-clis", label: "Supported CLIs" },
  { id: "cloud-frame", label: "Builder.io Cloud" },
  { id: "how-it-works", label: "How It Works" },
];

export default function FramesDocs() {
  return (
    <DocsLayout toc={TOC}>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">Frames</h1>
      <p className="mb-4 text-base text-[var(--fg-secondary)]">
        Agent-native apps run with an AI agent alongside the app UI. Locally,
        the agent panel is embedded directly in your app. In the cloud,
        Builder.io provides a managed frame with collaboration and visual
        editing.
      </p>

      <h2 id="embedded-agent">Embedded Agent Panel</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          Ships with <code>@agent-native/core</code> — no separate package
          needed
        </li>
        <li>
          Agent panel embedded directly in your app with chat and optional CLI
          terminal
        </li>
        <li>
          Supports multiple AI coding CLIs — switch between them from the
          settings panel
        </li>
        <li>
          Toggle between production mode (app tools only) and development mode
          (full filesystem, shell, and database access)
        </li>
        <li>Great for local development, self-hosted production, and OSS</li>
      </ul>

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
            ["Builder.io", "builder", "—"],
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
        Switch between CLIs at any time from the agent panel settings. The
        terminal restarts with the selected CLI.
      </p>

      <h2 id="cloud-frame">
        <a
          href="https://www.builder.io"
          target="_blank"
          rel="noopener noreferrer"
        >
          Builder.io Cloud
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

      <h2 id="how-it-works">How It Works</h2>
      <p>
        The framework provides type-safe APIs so you never deal with raw
        messaging:
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
          <strong>Action system</strong> — <code>pnpm action {"<name>"}</code>{" "}
          dispatches to callable actions
        </li>
      </ol>
      <p>Your app code is identical regardless of how the agent is provided.</p>
    </DocsLayout>
  );
}
