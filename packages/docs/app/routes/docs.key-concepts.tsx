import { Link } from "react-router";
import DocsLayout from "../components/DocsLayout";
import CodeBlock from "../components/CodeBlock";

const TOC = [
  { id: "why-agent-native", label: "Why Agent-Native" },
  { id: "the-architecture", label: "The Architecture" },
  { id: "data-in-sql", label: "Data in SQL" },
  { id: "agent-chat-bridge", label: "Agent Chat Bridge" },
  { id: "scripts-system", label: "Scripts System" },
  { id: "polling-sync", label: "Polling Sync" },
  { id: "harnesses", label: "Harnesses" },
  { id: "context-awareness", label: "Context Awareness" },
  { id: "apis-and-clis", label: "APIs & CLIs, Not MCPs" },
  { id: "agent-modifies-code", label: "Agent Modifies Code" },
  { id: "deep-dives", label: "Deep Dives" },
];

export const meta = () => [
  { title: "Key Concepts — Agent-Native" },
  {
    name: "description",
    content:
      "How agent-native apps work: SQL database, agent chat bridge, polling sync, scripts, and context awareness.",
  },
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
        See{" "}
        <Link to="/docs/core-philosophy" className="text-[var(--accent)]">
          Core Philosophy
        </Link>{" "}
        for the foundational principles and hard requirements.
      </p>

      <h2 id="the-architecture">The architecture</h2>
      <p>Every agent-native app is three things working together:</p>
      <div className="my-6 overflow-hidden rounded-xl border border-[var(--border)]">
        <div className="grid grid-cols-3 divide-x divide-[var(--border)]">
          <div className="p-5 text-center">
            <div className="mb-2 text-sm font-semibold">Agent</div>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Autonomous AI that reads data, writes data, runs scripts, and
              modifies code. Customizable with skills and instructions.
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
              Database, browser, code execution. Agents work directly with SQL
              and tools — no MCPs needed.
            </p>
          </div>
        </div>
      </div>
      <p>
        Every app includes an embedded agent panel with chat and optional CLI
        terminal. Locally, you run <code>pnpm dev</code> and the agent is right
        there. In the cloud, Builder.io provides a managed harness with
        collaboration, visual editing, and managed infrastructure for teams.
      </p>
      <p>Six rules govern the architecture:</p>
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          <strong>Data lives in SQL</strong> — all app state lives in the
          database via Drizzle ORM
        </li>
        <li>
          <strong>All AI goes through the agent</strong> — no inline LLM calls
        </li>
        <li>
          <strong>Scripts for agent operations</strong> — complex work runs as
          scripts
        </li>
        <li>
          <strong>Polling keeps the UI in sync</strong> — database changes sync
          via lightweight polling
        </li>
        <li>
          <strong>The agent can modify code</strong> — the app evolves as you
          use it
        </li>
        <li>
          <strong>Application state in SQL</strong> — ephemeral UI state lives
          in the database, readable by both agent and UI
        </li>
      </ol>

      <h2 id="data-in-sql">Data in SQL</h2>
      <p>
        All application state lives in a SQL database via Drizzle ORM. The
        framework supports multiple databases — SQLite, Postgres (Neon,
        Supabase), Turso, Cloudflare D1. Users configure{" "}
        <code>DATABASE_URL</code> to choose their database.
      </p>
      <p>Core SQL stores are auto-created and available in every template:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <code>application_state</code> — ephemeral UI state (navigation,
          drafts, selections)
        </li>
        <li>
          <code>settings</code> — persistent key-value config
        </li>
        <li>
          <code>oauth_tokens</code> — OAuth credentials
        </li>
        <li>
          <code>sessions</code> — auth sessions
        </li>
      </ul>
      <CodeBlock
        code={`// Drizzle schema for domain data
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const forms = sqliteTable("forms", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  schema: text("schema").notNull(), // JSON
  ownerEmail: text("owner_email"),
  createdAt: integer("created_at").notNull(),
});

// Core scripts for quick database access
pnpm script db-schema           # show all tables
pnpm script db-query --sql "SELECT * FROM forms"
pnpm script db-exec --sql "INSERT INTO forms ..."`}
        lang="bash"
      />

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
  context: "Dashboard ID: main, date range: last 30 days",
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
          another agent via{" "}
          <Link to="/docs/a2a-protocol" className="text-[var(--accent)]">
            A2A
          </Link>
          .
        </li>
      </ul>

      <h2 id="scripts-system">Scripts system</h2>
      <p>
        When the agent needs to do something complex — call an API, process
        data, query the database — it runs a script. Scripts are TypeScript
        files in <code>scripts/</code> that export a default async function:
      </p>
      <CodeBlock
        code={`// scripts/fetch-data.ts
import { parseArgs } from "@agent-native/core";

export default async function fetchData(args: string[]) {
  const { source } = parseArgs(args);
  const res = await fetch(\`https://api.example.com/\${source}\`);
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
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
        <code>pnpm script fetch-data</code>. Same logic, same results, different
        entry points.
      </p>

      <h2 id="polling-sync">Polling sync</h2>
      <p>
        Database changes are synced to the UI via lightweight polling. When the
        agent writes to the database (application state, settings, or domain
        data), a version counter increments. The client{" "}
        <code>useFileWatcher()</code> hook polls{" "}
        <code>/_agent-native/poll</code> every 2 seconds and invalidates React
        Query caches when changes are detected.
      </p>
      <CodeBlock
        code={`// Client: invalidate caches on database changes
import { useFileWatcher } from "@agent-native/core";

useFileWatcher({
  queryClient,
  queryKeys: ["app-state", "settings", "forms"],
});`}
      />
      <p>The flow is:</p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>Agent runs a script that writes to the database</li>
        <li>Version counter increments</li>
        <li>
          <code>useFileWatcher</code> detects the new version on next poll
        </li>
        <li>React Query caches are invalidated</li>
        <li>Components re-fetch and render the new data</li>
      </ol>
      <p>
        This works in all deployment environments — including serverless and
        edge — because it uses the database, not in-memory state or file system
        watchers.
      </p>

      <h2 id="harnesses">Harnesses</h2>
      <p>
        Agent-native apps include an embedded agent panel that provides the AI
        agent alongside the app UI. This is what makes the architecture work:
        the agent needs a computer (database, browser, code execution), and the
        app needs the agent for AI work.
      </p>
      <div className="my-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-[var(--border)] p-5">
          <div className="mb-2 text-sm font-semibold">Embedded Agent Panel</div>
          <p className="m-0 text-sm text-[var(--fg-secondary)]">
            Chat and optional CLI terminal built into every app. Supports Claude
            Code, Codex, Gemini, OpenCode, and Builder.io. Runs locally. Free
            and open source.
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

      <h2 id="context-awareness">Context awareness</h2>
      <p>
        The agent always knows what the user is looking at. The UI writes a{" "}
        <code>navigation</code> key to application-state on every route change.
        The agent reads it via the <code>view-screen</code> script before
        acting.
      </p>
      <p>
        See{" "}
        <Link to="/docs/context-awareness" className="text-[var(--accent)]">
          Context Awareness
        </Link>{" "}
        for the full pattern: navigation state, view-screen, navigate commands,
        and jitter prevention.
      </p>

      <h2 id="apis-and-clis">APIs & CLIs, not MCPs</h2>
      <p>
        Agent-native apps can work with MCP servers, but the architecture leans
        heavily on something more standard:{" "}
        <strong>regular APIs and CLIs accessed through code execution</strong>.
        Agents are great at writing code that calls <code>fetch()</code> or runs
        a CLI command — no special protocol needed.
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
          expressive than any tool schema.
        </li>
        <li>
          <strong>MCP is additive.</strong> Use MCP servers alongside scripts if
          you want, but they're not required.
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

      <h2 id="deep-dives">Deep dives</h2>
      <p>For detailed guidance on specific patterns:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <Link to="/docs/core-philosophy" className="text-[var(--accent)]">
            Core Philosophy
          </Link>{" "}
          — foundational principles and hard requirements
        </li>
        <li>
          <Link to="/docs/context-awareness" className="text-[var(--accent)]">
            Context Awareness
          </Link>{" "}
          — navigation state, view-screen, navigate commands
        </li>
        <li>
          <Link to="/docs/skills-guide" className="text-[var(--accent)]">
            Skills Guide
          </Link>{" "}
          — framework skills, domain skills, creating custom skills
        </li>
        <li>
          <Link to="/docs/a2a-protocol" className="text-[var(--accent)]">
            A2A Protocol
          </Link>{" "}
          — agent-to-agent communication
        </li>
      </ul>
    </DocsLayout>
  );
}
