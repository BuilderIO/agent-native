import { createFileRoute } from '@tanstack/react-router'
import DocsLayout from '../../components/DocsLayout'
import CodeBlock from '../../components/CodeBlock'

export const Route = createFileRoute('/docs/harnesses')({ component: HarnessesDocs })

const TOC = [
  { id: 'claude-code-harness', label: 'Claude Code Harness' },
  { id: 'builder-harness', label: 'Builder Harness' },
  { id: 'feature-comparison', label: 'Feature Comparison' },
  { id: 'how-it-works', label: 'How It Works' },
]

function HarnessesDocs() {
  return (
    <DocsLayout toc={TOC}>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">Harnesses</h1>
      <p className="mb-4 text-base text-[var(--fg-secondary)]">
        Agent-native apps run inside a <strong>harness</strong> — a host environment that provides
        the AI agent and displays the app UI side by side.
      </p>

      <h2 id="claude-code-harness">Claude Code Harness (Local)</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Open source, ships with <code>@agent-native/harness-claude-code</code></li>
        <li>Runs locally — xterm.js terminal on the left, your app iframe on the right</li>
        <li>Powered by Claude Code CLI via a real PTY (node-pty)</li>
        <li>Settings panel for launch flags (<code>--dangerously-skip-permissions</code>, <code>--resume</code>, <code>--verbose</code>, custom flags)</li>
        <li>Restart button to relaunch with new settings</li>
        <li>Auto-detects when Claude finishes generating and notifies the app</li>
        <li>Best for: solo development, local testing, open-source projects</li>
      </ul>

      <p>Quick start:</p>
      <CodeBlock code={`# In your agent-native monorepo
pnpm dev:harness`} />

      <h2 id="builder-harness">Builder Harness (Cloud)</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Provided by Builder.io — available at builder.io</li>
        <li>Runs locally or in the cloud</li>
        <li>Real-time collaboration — multiple users can watch/interact simultaneously</li>
        <li>Visual editing capabilities alongside the AI agent</li>
        <li>Parallel agent execution for faster iteration</li>
        <li>Best for: teams, production deployments, visual editing, real-time collaboration</li>
      </ul>

      <h2 id="feature-comparison">Feature Comparison</h2>
      <table>
        <thead>
          <tr>
            <th>Feature</th>
            <th>Claude Code Harness</th>
            <th>Builder Harness</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['Local development', 'Yes', 'Yes'],
            ['Cloud/remote', 'No', 'Yes'],
            ['Real-time collaboration', 'No', 'Yes'],
            ['Visual editing', 'No', 'Yes'],
            ['Parallel agents', 'No', 'Yes'],
            ['Agent chat bridge', 'Yes', 'Yes'],
            ['File watcher (SSE)', 'Yes', 'Yes'],
            ['Script system', 'Yes', 'Yes'],
            ['Open source', 'Yes', 'No'],
          ].map(([feature, claude, builder]) => (
            <tr key={feature}>
              <td>{feature}</td>
              <td>{claude}</td>
              <td>{builder}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 id="how-it-works">How It Works</h2>
      <p>Both harnesses support the same core agent-native protocol:</p>
      <ol className="list-decimal space-y-3 pl-5">
        <li>
          <strong>postMessage bridge</strong> — app sends <code>builder.submitChat</code> messages up
          to the harness
        </li>
        <li>
          <strong>Chat running events</strong> — harness sends{' '}
          <code>builder.fusion.chatRunning</code> events down to the app
        </li>
        <li>
          <strong>File watching</strong> — SSE endpoint keeps UI in sync when the agent modifies
          files
        </li>
        <li>
          <strong>Script system</strong> — <code>pnpm script {'<name>'}</code> dispatches to
          callable scripts
        </li>
      </ol>
      <p>Your app code is identical regardless of which harness you use.</p>
    </DocsLayout>
  )
}
