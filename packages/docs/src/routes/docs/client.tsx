import { createFileRoute } from '@tanstack/react-router'
import DocsLayout from '../../components/DocsLayout'
import CodeBlock from '../../components/CodeBlock'

export const Route = createFileRoute('/docs/client')({ component: ClientDocs })

const TOC = [
  { id: 'sendtoagentchat', label: 'sendToAgentChat()' },
  { id: 'agentchatmessage', label: 'AgentChatMessage', indent: true },
  { id: 'useagentchatgenerating', label: 'useAgentChatGenerating()' },
  { id: 'usefilewatcher', label: 'useFileWatcher()' },
  { id: 'cn', label: 'cn()' },
]

function ClientDocs() {
  return (
    <DocsLayout toc={TOC}>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">Client</h1>
      <p className="mb-8 text-base text-[var(--fg-secondary)]">
        <code>@agent-native/core</code> provides React hooks and utilities for
        the browser-side of agent-native apps.
      </p>

      <hr />

      <h2 id="sendtoagentchat">sendToAgentChat(opts)</h2>
      <p>Send a message to the agent chat via postMessage. Used to delegate AI tasks from UI interactions.</p>
      <CodeBlock code={`import { sendToAgentChat } from "@agent-native/core";

// Auto-submit a prompt with hidden context
sendToAgentChat({
  message: "Generate alt text for this image",
  context: "Image path: /api/projects/hero.jpg",
  submit: true,
});

// Prefill without submitting (user reviews first)
sendToAgentChat({
  message: "Rewrite this in a conversational tone",
  context: selectedText,
  submit: false,
});`} />

      <h3 id="agentchatmessage">AgentChatMessage</h3>
      <table>
        <thead>
          <tr>
            <th>Option</th>
            <th>Type</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['message', 'string', 'The visible prompt sent to the chat'],
            ['context', 'string?', 'Hidden context appended (not shown in chat UI)'],
            ['submit', 'boolean?', 'true = auto-submit, false = prefill only'],
            ['projectSlug', 'string?', 'Optional project slug for structured context'],
            ['preset', 'string?', 'Optional preset name for downstream consumers'],
            ['referenceImagePaths', 'string[]?', 'Optional reference image paths'],
          ].map(([name, type, desc]) => (
            <tr key={name}>
              <td>{name}</td>
              <td className="font-mono text-xs">{type}</td>
              <td>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 id="useagentchatgenerating">useAgentChatGenerating()</h2>
      <p>React hook that wraps sendToAgentChat with loading state tracking:</p>
      <CodeBlock code={`import { useAgentChatGenerating } from "@agent-native/core";

function GenerateButton() {
  const [isGenerating, send] = useAgentChatGenerating();

  return (
    <button
      disabled={isGenerating}
      onClick={() => send({
        message: "Generate a summary",
        context: documentContent,
        submit: true,
      })}
    >
      {isGenerating ? "Generating..." : "Generate"}
    </button>
  );
}`} />
      <p>
        <code>isGenerating</code> turns true on send, false when
        the <code>builder.fusion.chatRunning</code> event fires with <code>isRunning: false</code>.
      </p>

      <h2 id="usefilewatcher">useFileWatcher(options?)</h2>
      <p>React hook that connects to the SSE endpoint and invalidates react-query caches on file changes:</p>
      <CodeBlock code={`import { useFileWatcher } from "@agent-native/core";
import { useQueryClient } from "@tanstack/react-query";

function App() {
  const queryClient = useQueryClient();

  useFileWatcher({
    queryClient,
    queryKeys: ["files", "projects", "versionHistory"],
    eventsUrl: "/api/events",
    onEvent: (data) => console.log("File changed:", data),
  });

  return <div>...</div>;
}`} />

      <h3>Options</h3>
      <table>
        <thead>
          <tr>
            <th>Option</th>
            <th>Type</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['queryClient', 'QueryClient?', 'React-query client for cache invalidation'],
            ['queryKeys', 'string[]?', 'Query key prefixes to invalidate. Default: ["file", "fileTree"]'],
            ['eventsUrl', 'string?', 'SSE endpoint URL. Default: "/api/events"'],
            ['onEvent', '(data) => void', 'Optional callback for each SSE event'],
          ].map(([name, type, desc]) => (
            <tr key={name}>
              <td>{name}</td>
              <td className="font-mono text-xs">{type}</td>
              <td>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 id="cn">cn(...inputs)</h2>
      <p>Utility for merging class names (clsx + tailwind-merge):</p>
      <CodeBlock code={`import { cn } from "@agent-native/core";

<div className={cn(
  "px-4 py-2 rounded",
  isActive && "bg-primary text-primary-foreground",
  className
)} />`} />
    </DocsLayout>
  )
}
