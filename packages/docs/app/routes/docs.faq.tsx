import { Link } from "react-router";
import DocsLayout from "../components/DocsLayout";

const TOC = [
  { id: "general", label: "General" },
  { id: "what-is-agent-native", label: "What is agent-native?" },
  { id: "how-is-this-different", label: "How is this different from...?" },
  { id: "do-i-need-to-know-ai", label: "Do I need to know AI/ML?" },
  { id: "is-this-open-source", label: "Is this open source?" },
  { id: "development", label: "Development" },
  { id: "which-ai-tools-work", label: "Which AI coding tools work?" },
  { id: "can-i-use-my-own-database", label: "Can I use my own database?" },
  { id: "where-can-i-deploy", label: "Where can I deploy?" },
  { id: "can-i-use-existing-code", label: "Can I use existing code?" },
  { id: "architecture", label: "Architecture" },
  { id: "why-polling-not-websockets", label: "Why polling, not WebSockets?" },
  {
    id: "why-no-inline-llm-calls",
    label: "Why no inline LLM calls?",
  },
  { id: "why-single-tenant", label: "Why single-tenant?" },
  { id: "why-framework-not-library", label: "Why a framework, not a library?" },
  { id: "agent-capabilities", label: "Agent Capabilities" },
  { id: "can-the-agent-modify-code", label: "Can the agent modify code?" },
  {
    id: "can-agents-talk-to-each-other",
    label: "Can agents talk to each other?",
  },
  {
    id: "what-can-the-agent-see",
    label: "What can the agent see?",
  },
  { id: "templates", label: "Templates" },
  {
    id: "what-templates-are-available",
    label: "What templates are available?",
  },
  { id: "can-i-customize-templates", label: "Can I customize templates?" },
  { id: "can-i-build-from-scratch", label: "Can I build from scratch?" },
];

export const meta = () => [
  { title: "FAQ — Agent-Native" },
  {
    name: "description",
    content:
      "Frequently asked questions about agent-native apps, development, architecture, and templates.",
  },
];

function FAQ({
  id,
  question,
  children,
}: {
  id: string;
  question: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <h3 id={id} className="mb-2 text-lg font-semibold">
        {question}
      </h3>
      {children}
    </div>
  );
}

function SectionDivider({ id, label }: { id: string; label: string }) {
  return (
    <h2 id={id} className="mb-4 mt-8 first:mt-0">
      {label}
    </h2>
  );
}

export default function FAQDocs() {
  return (
    <DocsLayout toc={TOC}>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">FAQ</h1>
      <p className="mb-4 text-base text-[var(--fg-secondary)]">
        Frequently asked questions about agent-native apps, development, and the
        framework.
      </p>

      {/* ── General ── */}
      <SectionDivider id="general" label="General" />

      <FAQ id="what-is-agent-native" question="What is agent-native?">
        <p>
          Agent-native is a framework for building apps where the AI agent and
          the UI are equal partners. They share the same database, the same
          state, and they always stay in sync. Everything the UI can do, the
          agent can do — and vice versa. See{" "}
          <Link
            to="/docs/what-is-agent-native"
            className="text-[var(--accent)]"
          >
            What Is Agent-Native?
          </Link>{" "}
          for the full explanation.
        </p>
      </FAQ>

      <FAQ
        id="how-is-this-different"
        question="How is this different from adding AI to an existing app?"
      >
        <p>
          Most apps bolt AI on as an afterthought — an autocomplete here, a chat
          sidebar there. The AI can't actually <em>do</em> things in the app. In
          an agent-native app, the agent is a first-class citizen. It can create
          emails, schedule events, build forms, generate slides, and modify the
          app's own code. The architecture is designed for this from the ground
          up.
        </p>
      </FAQ>

      <FAQ id="do-i-need-to-know-ai" question="Do I need to know AI/ML?">
        <p>
          No. You don't train models, fine-tune, or deal with embeddings. You
          build a regular web app with React, TypeScript, and SQL. The framework
          handles the agent integration — routing messages, running actions,
          syncing state. You write standard web code and the agent just works.
        </p>
      </FAQ>

      <FAQ id="is-this-open-source" question="Is this open source?">
        <p>
          Yes. The framework and all templates are open source. You can run
          everything locally, self-host, or use Builder.io's cloud for managed
          hosting, collaboration, and team features.
        </p>
      </FAQ>

      {/* ── Development ── */}
      <SectionDivider id="development" label="Development" />

      <FAQ
        id="which-ai-tools-work"
        question="Which AI coding tools work with agent-native?"
      >
        <p>
          Any AI coding tool that reads project instructions. The framework uses
          AGENTS.md as the universal standard and auto-creates symlinks for
          specific tools:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Claude Code</strong> — reads CLAUDE.md (symlinked from
            AGENTS.md)
          </li>
          <li>
            <strong>Cursor</strong> — reads .cursorrules (symlinked from
            AGENTS.md)
          </li>
          <li>
            <strong>Windsurf</strong> — reads .windsurfrules (symlinked from
            AGENTS.md)
          </li>
          <li>
            <strong>Codex, Gemini, and others</strong> — work via the embedded
            agent panel
          </li>
          <li>
            <strong>Builder.io</strong> — cloud-hosted agent with visual editing
            and collaboration
          </li>
        </ul>
      </FAQ>

      <FAQ id="can-i-use-my-own-database" question="Can I use my own database?">
        <p>
          Yes. Set <code>DATABASE_URL</code> and the framework auto-detects your
          database. Supported databases include SQLite, Postgres (Neon,
          Supabase, plain), Turso (libSQL), and Cloudflare D1. All SQL is
          dialect-agnostic via Drizzle ORM — the same code works everywhere.
        </p>
      </FAQ>

      <FAQ id="where-can-i-deploy" question="Where can I deploy?">
        <p>
          Anywhere. The server runs on Nitro, which compiles to any deployment
          target: Node.js, Cloudflare Workers/Pages, Netlify, Vercel, Deno
          Deploy, AWS Lambda, and Bun. You can also use Builder.io's hosting for
          managed deployments. See the{" "}
          <Link to="/docs/deployment" className="text-[var(--accent)]">
            Deployment guide
          </Link>
          .
        </p>
      </FAQ>

      <FAQ
        id="can-i-use-existing-code"
        question="Can I migrate an existing app to agent-native?"
      >
        <p>
          You can, but agent-native works best when built from the ground up.
          The architecture — shared database, polling sync, actions, application
          state — needs to be integrated throughout. Starting from a template
          and customizing it is the recommended path. Think of it like the shift
          from desktop-first to mobile-first: you <em>can</em> retrofit, but
          building native is better.
        </p>
      </FAQ>

      {/* ── Architecture ── */}
      <SectionDivider id="architecture" label="Architecture" />

      <FAQ
        id="why-polling-not-websockets"
        question="Why polling instead of WebSockets?"
      >
        <p>
          Polling works in every deployment environment — including serverless,
          edge, and container platforms where persistent connections aren't
          available. The framework polls every 2 seconds using a lightweight
          version counter. When changes are detected, React Query caches are
          invalidated and components re-render. It's simple, reliable, and
          universal. SSE is also supported as an alternative.
        </p>
      </FAQ>

      <FAQ
        id="why-no-inline-llm-calls"
        question="Why can't the UI call an LLM directly?"
      >
        <p>
          AI is non-deterministic — you need conversation flow to give feedback
          and iterate, not one-shot buttons. The agent has your full codebase,
          instructions, skills, and conversation history. An inline LLM call has
          none of that. Plus, routing everything through the agent means the app
          can be driven from Slack, Telegram, or another agent via{" "}
          <Link to="/docs/a2a-protocol" className="text-[var(--accent)]">
            A2A
          </Link>{" "}
          — not just the UI.
        </p>
      </FAQ>

      <FAQ id="why-single-tenant" question="Why single-tenant?">
        <p>
          Because the agent can modify code. In a multi-tenant SaaS, you can't
          let one customer's agent change the source code — it would affect
          everyone. With single-tenant, each organization gets their own fork.
          The agent can safely evolve the code, add integrations, and customize
          the app because it's <em>your</em> app. Per-user data isolation still
          exists within an organization via the <code>owner_email</code>{" "}
          convention.
        </p>
      </FAQ>

      <FAQ
        id="why-framework-not-library"
        question="Why is this a framework and not a library?"
      >
        <p>
          The shared database, polling sync, actions system, and application
          state all need to work together as a cohesive architecture. A library
          could give you pieces, but agent-native requires that the agent and UI
          are wired together from the ground up. Multiple agents need to be able
          to communicate, the UI needs to react to agent changes instantly, and
          the agent needs to understand what the user is looking at. That's an
          architecture, not a utility.
        </p>
      </FAQ>

      {/* ── Agent Capabilities ── */}
      <SectionDivider id="agent-capabilities" label="Agent Capabilities" />

      <FAQ
        id="can-the-agent-modify-code"
        question="Can the agent really modify the app's own code?"
      >
        <p>
          Yes, and it's a feature. Because every agent-native app is
          single-tenant — your team's own fork — the agent can safely edit
          components, routes, styles, and actions. There's no shared codebase to
          break. You ask "add a cohort analysis chart" and the agent builds it.
          You ask "connect to our Stripe account" and the agent writes the
          integration.
        </p>
      </FAQ>

      <FAQ
        id="can-agents-talk-to-each-other"
        question="Can agents talk to each other?"
      >
        <p>
          Yes, via the{" "}
          <Link to="/docs/a2a-protocol" className="text-[var(--accent)]">
            A2A (Agent-to-Agent) protocol
          </Link>
          . Every agent-native app automatically gets an A2A endpoint. From the
          mail app, you can tag the analytics agent to query data. An agent
          discovers what other agents are available, calls them over the
          protocol, and shows results in the UI. No configuration needed — the
          agent card is auto-generated from your template's actions.
        </p>
      </FAQ>

      <FAQ
        id="what-can-the-agent-see"
        question="What can the agent see in the app?"
      >
        <p>
          The agent always knows what the user is currently viewing. The UI
          writes navigation state to the database on every route change — which
          view is open, which item is selected. The agent reads this via the{" "}
          <code>view-screen</code> action before taking action. If an email is
          open, the agent knows which email. If a slide is selected, the agent
          knows which slide. See{" "}
          <Link to="/docs/context-awareness" className="text-[var(--accent)]">
            Context Awareness
          </Link>
          .
        </p>
      </FAQ>

      {/* ── Templates ── */}
      <SectionDivider id="templates" label="Templates" />

      <FAQ
        id="what-templates-are-available"
        question="What templates are available?"
      >
        <p>
          The framework ships with production-ready templates that you can use
          as daily drivers:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>
              <Link to="/templates/mail" className="text-[var(--accent)]">
                Mail
              </Link>
            </strong>{" "}
            — full-featured email client (like Superhuman)
          </li>
          <li>
            <strong>
              <Link to="/templates/calendar" className="text-[var(--accent)]">
                Calendar
              </Link>
            </strong>{" "}
            — Google Calendar + Calendly-style meeting links
          </li>
          <li>
            <strong>
              <Link to="/templates/content" className="text-[var(--accent)]">
                Content
              </Link>
            </strong>{" "}
            — Notion-style documents
          </li>
          <li>
            <strong>
              <Link to="/templates/slides" className="text-[var(--accent)]">
                Slides
              </Link>
            </strong>{" "}
            — presentation builder
          </li>
          <li>
            <strong>
              <Link to="/templates/video" className="text-[var(--accent)]">
                Video
              </Link>
            </strong>{" "}
            — video composition with Remotion
          </li>
          <li>
            <strong>
              <Link to="/templates/analytics" className="text-[var(--accent)]">
                Analytics
              </Link>
            </strong>{" "}
            — data platform (like Amplitude/Mixpanel)
          </li>
        </ul>
        <p>
          Each template is a complete app with UI, agent actions, database
          schema, and AI instructions. See all{" "}
          <Link to="/templates" className="text-[var(--accent)]">
            Templates
          </Link>
          .
        </p>
      </FAQ>

      <FAQ id="can-i-customize-templates" question="Can I customize templates?">
        <p>
          That's the whole point. Fork a template and customize it by asking the
          agent. "Add a priority field to forms." "Connect to our Salesforce
          instance." "Change the color scheme to match our brand." The agent
          modifies the code, and your app evolves over time.
        </p>
      </FAQ>

      <FAQ
        id="can-i-build-from-scratch"
        question="Can I build from scratch without a template?"
      >
        <p>
          Yes. Run <code>npx @agent-native/core create my-app</code> without the{" "}
          <code>--template</code> flag. You get the framework scaffolding —
          React frontend, Nitro backend, agent panel, database — but no
          domain-specific code. See{" "}
          <Link to="/docs" className="text-[var(--accent)]">
            Getting Started
          </Link>
          .
        </p>
      </FAQ>
    </DocsLayout>
  );
}
