import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/docs/client')({ component: ClientDocs })

function ClientDocs() {
  return (
    <main className="page-wrap px-4 pb-8 pt-10">
      <h1 className="display-title mb-4 text-3xl font-bold tracking-tight text-[var(--sea-ink)] sm:text-4xl">
        Client
      </h1>
      <p className="mb-8 max-w-2xl text-base text-[var(--sea-ink-soft)]">
        <code>@agent-native/core/client</code> provides React hooks and utilities for
        the browser-side of agent-native apps.
      </p>

      <section className="prose-section mb-10">
        <h2>sendToFusionChat(opts)</h2>
        <p>Send a message to the Fusion AI chat via postMessage. Used to delegate AI tasks from UI interactions.</p>
        <Pre code={`import { sendToFusionChat } from "@agent-native/core/client";

// Auto-submit a prompt with hidden context
sendToFusionChat({
  message: "Generate alt text for this image",
  context: "Image path: /api/projects/hero.jpg",
  submit: true,
});

// Prefill without submitting (user reviews first)
sendToFusionChat({
  message: "Rewrite this in a conversational tone",
  context: selectedText,
  submit: false,
});`} />
        <h3>FusionChatMessage</h3>
        <Props items={[
          ['message', 'string', 'The visible prompt sent to the chat'],
          ['context', 'string?', 'Hidden context appended (not shown in chat UI)'],
          ['submit', 'boolean?', 'true = auto-submit, false = prefill only'],
          ['projectSlug', 'string?', 'Optional project slug for structured context'],
          ['preset', 'string?', 'Optional preset name for downstream consumers'],
          ['referenceImagePaths', 'string[]?', 'Optional reference image paths'],
        ]} />
      </section>

      <section className="prose-section mb-10">
        <h2>useFusionChatGenerating()</h2>
        <p>React hook that wraps sendToFusionChat with loading state tracking:</p>
        <Pre code={`import { useFusionChatGenerating } from "@agent-native/core/client";

function GenerateButton() {
  const [isGenerating, send] = useFusionChatGenerating();

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
      </section>

      <section className="prose-section mb-10">
        <h2>useFileWatcher(options?)</h2>
        <p>React hook that connects to the SSE endpoint and invalidates react-query caches on file changes:</p>
        <Pre code={`import { useFileWatcher } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";

function App() {
  const queryClient = useQueryClient();

  useFileWatcher({
    queryClient,
    queryKeys: ["files", "projects", "versionHistory"],
    eventsUrl: "/api/events", // default
    onEvent: (data) => console.log("File changed:", data),
  });

  return <div>...</div>;
}`} />
        <h3>Options</h3>
        <Props items={[
          ['queryClient', 'QueryClient?', 'React-query client for cache invalidation'],
          ['queryKeys', 'string[]?', 'Query key prefixes to invalidate. Default: ["file", "fileTree"]'],
          ['eventsUrl', 'string?', 'SSE endpoint URL. Default: "/api/events"'],
          ['onEvent', '(data) => void', 'Optional callback for each SSE event'],
        ]} />
      </section>

      <section className="prose-section mb-10">
        <h2>cn(...inputs)</h2>
        <p>Utility for merging class names (clsx + tailwind-merge):</p>
        <Pre code={`import { cn } from "@agent-native/core/client";

<div className={cn(
  "px-4 py-2 rounded",
  isActive && "bg-primary text-primary-foreground",
  className
)} />`} />
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

function Props({ items }: { items: [string, string, string][] }) {
  return (
    <div className="my-3 overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--line)]">
            <th className="px-4 py-2 text-left font-semibold text-[var(--sea-ink)]">Option</th>
            <th className="px-4 py-2 text-left font-semibold text-[var(--sea-ink)]">Type</th>
            <th className="px-4 py-2 text-left font-semibold text-[var(--sea-ink)]">Description</th>
          </tr>
        </thead>
        <tbody className="text-[var(--sea-ink-soft)]">
          {items.map(([name, type, desc]) => (
            <tr key={name} className="border-b border-[var(--line)] last:border-0">
              <td className="px-4 py-2 font-mono text-xs text-[var(--lagoon-deep)]">{name}</td>
              <td className="px-4 py-2 font-mono text-xs">{type}</td>
              <td className="px-4 py-2">{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
