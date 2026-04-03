import DocsLayout from "../components/DocsLayout";
import CodeBlock from "../components/CodeBlock";

const TOC = [
  { id: "agent-ui-parity", label: "Agent + UI Parity" },
  { id: "four-area-checklist", label: "The Four-Area Checklist" },
  { id: "single-tenant-model", label: "Single-Tenant Model" },
  { id: "database-agnostic", label: "Database Agnostic" },
  { id: "hosting-agnostic", label: "Hosting Agnostic" },
  { id: "hard-requirements", label: "Hard Requirements" },
];

export const meta = () => [
  { title: "Core Philosophy — Agent-Native" },
  {
    name: "description",
    content:
      "The foundational principles of agent-native: parity, portability, and the four-area checklist.",
  },
];

export default function CorePhilosophyDocs() {
  return (
    <DocsLayout toc={TOC}>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">
        Core Philosophy
      </h1>
      <p className="mb-4 text-base text-[var(--fg-secondary)]">
        The foundational principles that govern every agent-native app. These
        are hard requirements, not suggestions.
      </p>

      <h2 id="agent-ui-parity">Agent + UI parity</h2>
      <p>
        Everything the UI can do, the agent can do. Everything the agent can do,
        the UI can do. This is the defining principle of agent-native.
      </p>
      <p>
        If a user can create a form from the UI, the agent must have a script to
        create it too. If the agent can run an analytics query, the UI must have
        a way to trigger it. No feature is complete until both sides can use it.
      </p>
      <div className="my-6 overflow-hidden rounded-xl border border-[var(--border)]">
        <div className="grid grid-cols-2 divide-x divide-[var(--border)]">
          <div className="p-5">
            <div className="mb-2 text-sm font-semibold">
              User clicks a button
            </div>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              UI calls an API route or writes to application-state. The agent
              can see the result via <code>view-screen</code>.
            </p>
          </div>
          <div className="p-5">
            <div className="mb-2 text-sm font-semibold">
              Agent runs a script
            </div>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Script writes to the database. The UI picks up the change via
              polling and re-renders.
            </p>
          </div>
        </div>
      </div>

      <h2 id="four-area-checklist">The four-area checklist</h2>
      <p>
        Every new feature must update all four areas. Skipping any one breaks
        the agent-native contract.
      </p>
      <div className="my-6 overflow-hidden rounded-xl border border-[var(--border)]">
        <div className="grid grid-cols-2 gap-px bg-[var(--border)] sm:grid-cols-4">
          {[
            ["1. UI", "Page, component, or dialog the user interacts with"],
            [
              "2. Script",
              "Agent-callable script in scripts/ for the same operation",
            ],
            [
              "3. Skills",
              "Update AGENTS.md and/or create a skill documenting the pattern",
            ],
            [
              "4. App-State",
              "Navigation state, view-screen data, and navigate commands",
            ],
          ].map(([title, desc]) => (
            <div key={title} className="bg-[var(--bg)] p-4">
              <div className="mb-1 text-sm font-semibold">{title}</div>
              <p className="m-0 text-xs text-[var(--fg-secondary)]">{desc}</p>
            </div>
          ))}
        </div>
      </div>
      <p>
        A feature with only UI is invisible to the agent. A feature with only
        scripts is invisible to the user. A feature without app-state means the
        agent is blind to what the user is doing.
      </p>

      <h2 id="single-tenant-model">Single-tenant model</h2>
      <p>
        Agent-native apps follow a fork-and-customize model. Each organization
        gets their own instance of the app, which they can modify freely via the
        agent.
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>Fork a template (e.g. analytics, mail, forms)</li>
        <li>
          Customize it by asking the agent — "connect to our Stripe account",
          "add a cohort analysis chart"
        </li>
        <li>
          Deploy via Builder.io hosting or self-host on any Nitro-supported
          platform
        </li>
        <li>
          The app evolves over time as the agent modifies code, adds
          integrations, and responds to requests
        </li>
      </ul>

      <h2 id="database-agnostic">Database agnostic</h2>
      <p>
        All data lives in SQL via Drizzle ORM. The framework supports every
        Drizzle-supported database:
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>SQLite</strong> — local dev fallback when{" "}
          <code>DATABASE_URL</code> is unset
        </li>
        <li>
          <strong>Neon Postgres</strong> — common in both dev and production
        </li>
        <li>
          <strong>Turso</strong> (libSQL) — edge-friendly SQLite-compatible
        </li>
        <li>
          <strong>Supabase Postgres</strong>
        </li>
        <li>
          <strong>Cloudflare D1</strong>
        </li>
        <li>
          <strong>Plain Postgres</strong>
        </li>
      </ul>
      <p>
        Never write SQLite-only syntax. Use the framework helpers for
        dialect-agnostic SQL:
      </p>
      <CodeBlock
        code={`import { getDbExec, isPostgres, intType } from "@agent-native/core/db/client";

// getDbExec() auto-converts ? params to $1 for Postgres
const client = getDbExec();
await client.execute({
  sql: "SELECT * FROM forms WHERE owner_email = ?",
  args: [email],
});

// Branch when syntax differs
const upsert = isPostgres()
  ? "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2"
  : "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)";`}
      />

      <h2 id="hosting-agnostic">Hosting agnostic</h2>
      <p>The server runs on Nitro, which compiles to any deployment target:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>Node.js — local dev, traditional servers</li>
        <li>Cloudflare Workers/Pages</li>
        <li>Netlify Functions/Edge</li>
        <li>Vercel Serverless/Edge</li>
        <li>Deno Deploy</li>
        <li>AWS Lambda</li>
        <li>Bun</li>
      </ul>
      <p>
        Never use Node-specific APIs (<code>fs</code>,{" "}
        <code>child_process</code>, <code>path</code>) in server routes or
        plugins. These don't exist in Workers/edge environments. Scripts in{" "}
        <code>scripts/</code> run in Node.js and can use Node APIs freely.
      </p>
      <p>
        Never assume a persistent server process. Serverless and edge
        environments are stateless — no in-memory caches, no long-lived
        connections. Use the SQL database for all state.
      </p>

      <h2 id="hard-requirements">Hard requirements</h2>
      <p>These rules are never optional:</p>
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          <strong>Agent + UI parity</strong> — every feature works from both
          sides
        </li>
        <li>
          <strong>Four-area checklist</strong> — UI, script, skills, app-state
          for every feature
        </li>
        <li>
          <strong>All AI through the agent</strong> — no inline LLM calls, ever
        </li>
        <li>
          <strong>Data in SQL</strong> — all state in the database via Drizzle,
          not JSON files or localStorage
        </li>
        <li>
          <strong>Dialect-agnostic SQL</strong> — works on SQLite and Postgres
          without changes
        </li>
        <li>
          <strong>No Node.js assumptions</strong> — server code runs on any
          Nitro target
        </li>
        <li>
          <strong>No persistent process assumptions</strong> — stateless by
          default
        </li>
      </ol>
    </DocsLayout>
  );
}
