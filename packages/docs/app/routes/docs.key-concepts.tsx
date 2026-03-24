import DocsLayout from "../components/DocsLayout";
import CodeBlock from "../components/CodeBlock";

const TOC = [
  { id: "why-agent-native", label: "Why Agent-Native" },
  { id: "the-architecture", label: "The Architecture" },
  { id: "files-as-database", label: "Files as Database" },
  { id: "agent-chat-bridge", label: "Agent Chat Bridge" },
  { id: "scripts-system", label: "Scripts System" },
  { id: "sse-sync", label: "Real-time SSE Sync" },
  { id: "harnesses", label: "Harnesses" },
  { id: "file-sync", label: "File Sync" },
  { id: "apis-and-clis", label: "APIs & CLIs, Not MCPs" },
  { id: "agent-modifies-code", label: "Agent Modifies Code" },
];

export default function KeyConceptsDocs() {
  return (
    <DocsLayout toc={TOC}>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">
        Key Concepts
      </h1>
      <p className="mb-4 text-base text-[var(--fg-secondary)]">
        How agent-native apps work under the hood — and why they're built this
        way.
      </p>

      <h2 id="why-agent-native">Why agent-native</h2>
      <p>
        Teams today have four options for AI-powered work, and none of them are
        ideal:
      </p>
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          <strong>Chat apps</strong> (Claude Projects, ChatGPT) — accessible but
          not built for structured workflows. No persistent UI, no dashboards,
          no team collaboration.
        </li>
        <li>
          <strong>Raw agent interfaces</strong> (Claude Code, Cursor) — powerful
          but inaccessible to non-devs. No guardrails, no onboarding, no
          structured UI.
        </li>
        <li>
          <strong>Custom AI apps</strong> — limited. The AI can't see what you
          see, can't react to what you click, and can't update the app itself.
          No conversation history, no rollback, no skills.
        </li>
        <li>
          <strong>Existing SaaS</strong> (Amplitude, HubSpot, Google Slides) —
          bolting AI onto architectures that weren't designed for it. You can
          feel the seams.
        </li>
      </ol>
      <p>
        Agent-native apps solve this by making the agent and the UI equal
        citizens of the same system. Think of it as Claude Code, but with
        buttons and visual interfaces. The agent can do anything the UI can do
        (via natural language), and the UI can trigger anything the agent can do
        (via buttons).
      </p>
      <p>
        This is the same shift we saw with mobile-native. Instagram didn't
        shrink a desktop app — they built mobile-first with extreme discipline.
        Agent-native means every feature is tested against one question:{" "}
        <em>will AI be able to work with this reliably?</em> If yes, ship it. If
        not, don't.
      </p>

      <h2 id="the-architecture">The architecture</h2>
      <p>Every agent-native app is three things working together:</p>
      <div className="my-6 overflow-hidden rounded-xl border border-[var(--border)]">
        <div className="grid grid-cols-3 divide-x divide-[var(--border)]">
          <div className="p-5 text-center">
            <div className="mb-2 text-sm font-semibold">Agent</div>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Autonomous AI that reads, writes, and executes code. Customizable
              with skills and instructions.
            </p>
          </div>
          <div className="p-5 text-center">
            <div className="mb-2 text-sm font-semibold">Application</div>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Full React UI with dashboards, flows, and visualizations. Guided
              experiences your team can use.
            </p>
          </div>
          <div className="p-5 text-center">
            <div className="mb-2 text-sm font-semibold">Computer</div>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              File system, browser, code execution. Agents work directly with
              files and tools — no MCPs needed.
            </p>
          </div>
        </div>
      </div>
      <p>
        The app runs inside a <strong>harness</strong> — a host environment that
        provides the agent alongside the app UI. The simplest harness is a
        terminal on the left (running Claude Code) and your app iframe on the
        right. Cloud harnesses add collaboration, visual editing, and managed
        infrastructure for teams.
      </p>
      <p>Five rules govern the architecture:</p>
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          <strong>Files are the source of truth</strong> — all app state lives
          in files, which the agent can read and write directly
        </li>
        <li>
          <strong>All AI goes through the agent</strong> — no inline LLM calls
        </li>
        <li>
          <strong>Scripts for agent operations</strong> — complex work runs as
          scripts
        </li>
        <li>
          <strong>SSE keeps the UI in sync</strong> — file changes stream to the
          browser in real-time
        </li>
        <li>
          <strong>The agent can modify code</strong> — the app evolves as you
          use it
        </li>
      </ol>

      <h2 id="files-as-database">Files as database</h2>
      <div className="my-6 overflow-hidden rounded-xl border border-[var(--border)]">
        <img
          src="https://cdn.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/5f9484f006fe4e7594840b7f6546af20?format=webp&width=800"
          alt="Agent-native architecture diagram showing how files serve as the shared state between the agent, UI, and database adapters"
          className="w-full"
        />
      </div>
      <p>
        This is the core insight that makes the architecture work. All
        application state — content, data, configuration — lives in files (JSON,
        Markdown, YAML) in the <code>data/</code> directory. There is no
        traditional database.
      </p>
      <p>
        Why files? Because agents are excellent at reading, writing, grepping,
        and navigating file trees. When state is files:
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          The agent can read and modify any state directly — no API wrappers
          needed
        </li>
        <li>The UI reads state via API routes that serve files</li>
        <li>Both sides operate on the same source of truth</li>
        <li>State is versionable with git</li>
        <li>
          State is inspectable — <code>cat data/projects/my-project.json</code>
        </li>
      </ul>
      <CodeBlock
        code={`# The agent reads files directly
cat data/dashboards/main.json

# The UI reads via API routes that serve the same files
GET /api/dashboards/main → reads data/dashboards/main.json

# Both sides see the same state`}
        lang="bash"
      />
      <p>
        Your app becomes a function of files — like React is a function of
        state, an agent-native app is a function of files. When the agent writes
        a file, the UI updates. When the UI saves data, the agent can see it.
      </p>

      <h2 id="agent-chat-bridge">Agent chat bridge</h2>
      <p>
        The UI never calls an LLM directly. When a user clicks "Generate chart"
        or "Write summary", the UI sends a message to the agent via{" "}
        <code>postMessage</code>. The agent does the work — with full
        conversation history, skills, instructions, and the ability to iterate.
      </p>
      <CodeBlock
        code={`// In a React component — delegate AI work to the agent
import { sendToAgentChat } from "@agent-native/core";

sendToAgentChat({
  message: "Generate a chart showing signups by source",
  context: "Data source: data/analytics/signups.json",
  submit: true,
});`}
      />
      <p>Why not call an LLM inline?</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>AI is non-deterministic.</strong> You need conversation flow
          to give feedback and iterate — not one-shot buttons.
        </li>
        <li>
          <strong>Context matters.</strong> The agent has your full codebase,
          instructions, skills, and history. An inline call has none of that.
        </li>
        <li>
          <strong>The agent can do more.</strong> It can run scripts, browse the
          web, modify code, and chain multiple steps together.
        </li>
        <li>
          <strong>Headless execution.</strong> Because everything goes through
          the agent, any app can be driven entirely from Slack, Telegram, or
          another agent.
        </li>
      </ul>
      <p>
        The transport is simple: <code>window.parent.postMessage()</code> in the
        browser. The harness (Claude Code wrapper or Builder) receives the
        message and types it into the agent. From scripts, the same bridge works
        via stdout (<code>BUILDER_PARENT_MESSAGE:</code> prefix).
      </p>

      <h2 id="scripts-system">Scripts system</h2>
      <p>
        When the agent needs to do something complex — call an API, process
        data, generate images — it runs a script. Scripts are TypeScript files
        in <code>scripts/</code> that export a default async function:
      </p>
      <CodeBlock
        code={`// scripts/fetch-data.ts
import { parseArgs } from "@agent-native/core";

export default async function fetchData(args: string[]) {
  const { source } = parseArgs(args);
  const res = await fetch(\`https://api.example.com/\${source}\`);
  const data = await res.json();

  // Write results to data/ — the UI will see the change via SSE
  const fs = await import("node:fs/promises");
  await fs.writeFile(\`data/\${source}.json\`, JSON.stringify(data, null, 2));
  console.log(\`Fetched \${data.length} records\`);
}`}
      />
      <CodeBlock
        code={`# Agent runs scripts via CLI
pnpm script fetch-data --source=signups`}
        lang="bash"
      />
      <p>
        This means anything the UI can do, the agent can do — and vice versa.
        The UI calls <code>POST /api/fetch-data</code>, the agent calls{" "}
        <code>pnpm script fetch-data</code>. Same code, same results, different
        entry points.
      </p>

      <h2 id="sse-sync">Real-time SSE sync</h2>
      <p>
        When the agent writes a file, the UI needs to know immediately. A{" "}
        <a
          href="https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--accent)]"
        >
          chokidar
        </a>{" "}
        file watcher monitors <code>data/</code> and streams changes to the
        browser via Server-Sent Events:
      </p>
      <CodeBlock
        code={`// Server: set up file watching and SSE
import { createFileWatcher, createSSEHandler } from "@agent-native/core";

const watcher = createFileWatcher("./data");
app.get("/api/events", createSSEHandler(watcher));

// Client: invalidate react-query caches on file changes
import { useFileWatcher } from "@agent-native/core";

useFileWatcher({ queryClient, queryKeys: ["dashboards", "projects"] });`}
      />
      <p>The flow is:</p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>
          Agent writes to <code>data/dashboards/main.json</code>
        </li>
        <li>Chokidar detects the change</li>
        <li>
          SSE pushes{" "}
          <code>
            {'{ "type": "change", "path": "data/dashboards/main.json" }'}
          </code>{" "}
          to the browser
        </li>
        <li>
          <code>useFileWatcher</code> invalidates matching react-query caches
        </li>
        <li>Components re-fetch and render the new data</li>
      </ol>
      <p>
        No polling, no refresh — the UI updates instantly when the agent acts.
      </p>

      <h2 id="harnesses">Harnesses</h2>
      <p>
        Agent-native apps don't run standalone — they run inside a{" "}
        <strong>harness</strong> that provides the AI agent alongside the app
        UI. This is what makes the architecture work: the agent needs a computer
        (file system, browser, code execution), and the app needs the agent for
        AI work.
      </p>
      <div className="my-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-[var(--border)] p-5">
          <div className="mb-2 text-sm font-semibold">
            CLI Harness (Open Source)
          </div>
          <p className="m-0 text-sm text-[var(--fg-secondary)]">
            Terminal on the left running your choice of AI CLI (Claude Code,
            Codex, Gemini, OpenCode, Builder.io), your app iframe on the right.
            Runs locally. Free. Best for solo development.
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border)] p-5">
          <div className="mb-2 text-sm font-semibold">Cloud Harness</div>
          <p className="m-0 text-sm text-[var(--fg-secondary)]">
            Deploy to any cloud with real-time collaboration, visual editing,
            roles and permissions. Best for teams.
          </p>
        </div>
      </div>
      <p>
        Both harnesses support the same protocol: <code>postMessage</code>{" "}
        bridge for chat, SSE for file sync, and the script system. Your app code
        is identical regardless of harness.
      </p>

      <h2 id="file-sync">File Sync</h2>
      <p>
        Files are great for single-user and local development. But when multiple
        people need to collaborate in real-time across different agent
        instances, you need a sync layer.
      </p>
      <p>
        Agent-native provides a <strong>pluggable adapter system</strong> that
        syncs files to a database in real-time. Three adapters ship out of the
        box:
      </p>
      <div className="my-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-[var(--border)] p-5">
          <div className="mb-2 text-sm font-semibold">
            Google Cloud Firestore
          </div>
          <p className="m-0 text-sm text-[var(--fg-secondary)]">
            Real-time listener via <code>onSnapshot</code>. Best for apps
            already on Google Cloud or Firebase.
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border)] p-5">
          <div className="mb-2 text-sm font-semibold">Supabase (Postgres)</div>
          <p className="m-0 text-sm text-[var(--fg-secondary)]">
            Real-time via Supabase Realtime channels. Best for teams using
            Supabase for auth, storage, or edge functions.
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border)] p-5">
          <div className="mb-2 text-sm font-semibold">Convex</div>
          <p className="m-0 text-sm text-[var(--fg-secondary)]">
            Real-time via reactive queries. Best for teams wanting zero-config
            real-time with automatic reconnection.
          </p>
        </div>
      </div>
      <p>All adapters work the same way under the hood:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          A chokidar file watcher detects local changes and pushes them to the
          database
        </li>
        <li>
          A remote listener (real-time or polling) detects remote changes and
          writes them to disk
        </li>
        <li>
          Three-way merge with LCS-based conflict resolution handles concurrent
          edits
        </li>
        <li>
          Unresolvable conflicts create <code>.conflict</code> sidecar files for
          manual or LLM-assisted resolution
        </li>
      </ul>
      <p>
        The app doesn't know about the database — it just reads and writes
        files. The sync adapter handles everything behind the scenes. You
        configure which files sync via glob patterns:
      </p>
      <CodeBlock
        code={`// data/sync-config.json
{
  "syncFilePatterns": ["data/projects/**/*.json", "data/**/*.md"],
  "privateSyncFilePatterns": ["data/users/**/*.json"]
}`}
      />
      <p>
        This is important: the database is never the source of truth. Files are.
        The database is just a sync mechanism for collaboration. Git-ignore the
        synced files, and pull requests update the application code — not the
        data files.
      </p>

      <h2 id="apis-and-clis">APIs & CLIs, not MCPs</h2>
      <p>
        Agent-native apps can work with MCP servers, but the architecture leans
        heavily on something more standard:{" "}
        <strong>regular APIs and CLIs accessed through code execution</strong>.
      </p>
      <p>
        Why? Because APIs and CLIs are universal. Every service already has
        them. They're documented, versioned, and battle-tested. Agents are great
        at writing code that calls <code>fetch()</code> or runs a CLI command —
        no special protocol needed.
      </p>
      <CodeBlock
        code={`// scripts/sync-stripe.ts — agent calls Stripe's REST API directly
import { parseArgs } from "@agent-native/core";

export const meta = () => [
      { title: "Key Concepts — Agent-Native" },
      {
        name: "description",
        content:
          "How agent-native apps work: files as database, agent chat bridge, SSE sync, scripts, and harnesses.",
      },
    ];

export default async function(args: string[]) {
  const { customerId } = parseArgs(args);
  const res = await fetch(\`https://api.stripe.com/v1/customers/\${customerId}\`, {
    headers: { Authorization: \`Bearer \${process.env.STRIPE_SECRET_KEY}\` },
  });
  const customer = await res.json();
  const fs = await import("node:fs/promises");
  await fs.writeFile("data/customer.json", JSON.stringify(customer, null, 2));
}`}
      />
      <p>
        The scripts system is the key enabler. When the agent needs to interact
        with an external service, it writes (or runs) a script that uses the
        service's standard API or CLI. This means:
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>No wrapper layer.</strong> Call APIs directly with{" "}
          <code>fetch()</code> or use official SDKs.
        </li>
        <li>
          <strong>Any CLI works.</strong> <code>ffmpeg</code>, <code>gh</code>,{" "}
          <code>aws</code>, <code>gcloud</code> — if it runs in a terminal, the
          agent can use it.
        </li>
        <li>
          <strong>Code is the protocol.</strong> TypeScript scripts are more
          expressive than any tool schema. The agent can chain calls, handle
          errors, transform data — all in regular code.
        </li>
        <li>
          <strong>MCP is additive.</strong> If you want to use MCP servers too,
          they work fine alongside scripts. But they're not required.
        </li>
      </ul>

      <h2 id="agent-modifies-code">Agent modifies code</h2>
      <p>
        This is a feature, not a bug. The agent can edit the app's own source
        code — components, routes, styles, scripts. This enables a "fork and
        evolve" pattern:
      </p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>Fork a template (e.g. the analytics template)</li>
        <li>Customize it to your needs by asking the agent</li>
        <li>
          "Add a new chart type for cohort analysis" — the agent builds it
        </li>
        <li>
          "Connect to our Stripe account" — the agent writes the integration
        </li>
        <li>Your app gets better over time without manual development</li>
      </ol>
      <p>
        This works because the agent has your full codebase. It can read your
        components, understand your patterns, and make changes that fit.
        Combined with git-based workflows, roles, and ACLs, you get the power of
        custom development with the safety of code review.
      </p>
    </DocsLayout>
  );
}
