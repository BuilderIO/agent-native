import { Link } from "react-router";
import DocsLayout from "../components/DocsLayout";

const TOC = [
  { id: "what-is-an-agent-native-app", label: "What Is an Agent-Native App" },
  { id: "not-just-a-chatbot", label: "Not Just a Chatbot" },
  { id: "agent-ui-parity", label: "Agent + UI Parity" },
  { id: "what-makes-it-different", label: "What Makes It Different" },
  {
    id: "what-is-agent-native-development",
    label: "Agent-Native Development",
  },
  { id: "agents-as-first-class-developers", label: "Agents as Developers" },
  { id: "whole-team-development", label: "Whole-Team Development" },
  { id: "fork-and-customize", label: "Fork and Customize" },
  { id: "composable-agents", label: "Composable Agents" },
];

export const meta = () => [
  { title: "What Is Agent-Native? — Agent-Native" },
  {
    name: "description",
    content:
      "What agent-native apps are, what agent-native development means, and why every AI agent needs a management interface.",
  },
];

export default function WhatIsAgentNative() {
  return (
    <DocsLayout toc={TOC}>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">
        What Is Agent-Native?
      </h1>
      <p className="mb-4 text-base text-[var(--fg-secondary)]">
        Agent-native is a way of building software where the AI agent and the UI
        are equal partners. Everything the agent can do, the UI can do.
        Everything the UI can do, the agent can do.
      </p>

      <h2 id="what-is-an-agent-native-app">What is an agent-native app?</h2>
      <p>
        Think of agent-native apps as a layer on top of AI agents. An agent has
        skills, instructions, and tools. It can be autonomous and general
        purpose. The application sits on top of that and gives it structure.
      </p>
      <p>
        Importantly, agent-native does <strong>not</strong> mean "app that calls
        an LLM." That's the anti-pattern. A text box that sends a prompt and
        returns a response gives you no ability to give feedback, no way to
        understand what the agent is doing, and no way to customize its behavior
        with instructions and skills.
      </p>
      <p>
        An agent-native app gives you everything good about traditional
        applications — databases, dashboards, workflows, persistence,
        shareability — plus everything good about AI agents. The agent can do
        anything the UI can do, and the things it does persist to the UI so you
        can inspect them, visualize them, and share them.
      </p>

      <h2 id="not-just-a-chatbot">Not just a chatbot</h2>
      <p>
        A chat interface alone isn't enough. When you're building tools for
        people to actually use, you need more than a box for them to type a
        prompt into:
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>Discoverability</strong> — users need to know what the app can
          do without guessing prompts
        </li>
        <li>
          <strong>Workflows</strong> — structured flows for common tasks like
          composing emails, creating events, or building forms
        </li>
        <li>
          <strong>Visualization</strong> — charts, calendars, email threads, and
          slide decks are better as visual interfaces than text
        </li>
        <li>
          <strong>Persistence</strong> — a dashboard to come back to, data that
          doesn't disappear between sessions
        </li>
        <li>
          <strong>Shareability</strong> — share a form link, a slide deck URL,
          or a report with your team
        </li>
        <li>
          <strong>Speed</strong> — clicking a button is faster than typing a
          prompt for routine tasks
        </li>
      </ul>
      <p>
        Agent-native apps give you all of this while keeping the full power of
        the AI agent. The agent is always there — you can ask it to do anything.
        But the UI makes common workflows fast, visual, and accessible to
        everyone on the team.
      </p>

      <h2 id="agent-ui-parity">Agent + UI parity</h2>
      <p>
        This is the defining principle. Any application functionality should be
        able to be done by the agent <em>or</em> the UI:
      </p>
      <div className="my-6 overflow-hidden rounded-xl border border-[var(--border)]">
        <div className="grid grid-cols-2 divide-x divide-[var(--border)]">
          <div className="p-5">
            <div className="mb-2 text-sm font-semibold">From the UI</div>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Click buttons, fill forms, navigate views. The UI writes to the
              database and the agent can see the results.
            </p>
          </div>
          <div className="p-5">
            <div className="mb-2 text-sm font-semibold">From the agent</div>
            <p className="m-0 text-sm text-[var(--fg-secondary)]">
              Natural language, other agents via A2A, Slack, Telegram. The agent
              writes to the database and the UI updates automatically.
            </p>
          </div>
        </div>
      </div>
      <p>
        When the agent creates a draft email, it appears in the UI. When the
        user clicks "Send," the agent knows it was sent. There's no separate
        "agent world" and "UI world" — it's one system.
      </p>

      <h2 id="what-makes-it-different">What makes it different</h2>
      <p>
        Every agent ultimately needs a management interface. At the minimum, you
        need to understand what it's doing, inspect the data it's creating, and
        debug when things go wrong. That's just called an application.
      </p>
      <div className="my-6 overflow-hidden rounded-xl border border-[var(--border)]">
        <div className="grid gap-px bg-[var(--border)] sm:grid-cols-2">
          {(
            [
              [
                "Traditional apps with AI bolted on",
                "The AI is an afterthought. Limited to autocomplete, summaries, or a chat sidebar that can't actually do anything in the app.",
              ],
              [
                "Agent-native apps",
                "The agent is a first-class citizen. It shares the same database, the same state, and can do everything the UI can do — and vice versa.",
              ],
              [
                "Pure chat/agent interfaces",
                "Powerful but inaccessible. No dashboards, no workflows, no persistence. Non-developers can't use them effectively.",
              ],
              [
                "Agent-native apps",
                "Full application UI with discoverability, workflows, and visualization — plus the agent for anything that needs AI.",
              ],
            ] as const
          ).map(([title, desc], i) => (
            <div key={i} className="bg-[var(--bg)] p-4">
              <div className="mb-1 text-sm font-semibold">{title}</div>
              <p className="m-0 text-xs text-[var(--fg-secondary)]">{desc}</p>
            </div>
          ))}
        </div>
      </div>
      <p>
        The argument is simple: make your agents composable, think of them as
        applications. An analytics application, a slide generation application,
        a document application. Each one is a complete tool that humans and
        agents can both use.
      </p>

      <h2 id="what-is-agent-native-development">
        What is agent-native development?
      </h2>
      <p>
        Agent-native development means building with agents first. You build
        projects that work great when prompted from AI coding tools like Claude
        Code, Codex, Cursor, Windsurf, and Builder.io.
      </p>
      <p>
        The idea is that you build instructions and skills into the project as
        prerequisites. The agent will tend to do <em>better</em> than a human
        developer because you can encode rules like "when you add a feature,
        also add a skill for it" — things that humans will tend to forget or
        skip reading the docs for.
      </p>

      <h2 id="agents-as-first-class-developers">
        Agents as first-class developers
      </h2>
      <p>In an agent-native project:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>AGENTS.md</strong> gives every AI coding tool the same
          instructions — Claude Code, Cursor, Windsurf, and others all read the
          same file
        </li>
        <li>
          <strong>Skills</strong> teach the agent patterns for specific tasks —
          adding features, storing data, wiring real-time sync
        </li>
        <li>
          <strong>Agent PR reviewers</strong> can validate that the four-area
          checklist was followed, that skills were updated, and that the code
          matches the project's conventions
        </li>
        <li>
          <strong>Auto-maintained docs and tests</strong> — agents can be
          instructed to keep documentation up to date and tests passing, making
          it easier for humans to contribute
        </li>
      </ul>
      <p>
        This is similar to the shift from desktop-first to mobile-first
        development. Mobile-first didn't mean "no desktop" — it meant designing
        for mobile constraints first and then scaling up. Agent-native
        development means designing for agent workflows first and then making
        sure humans can work effectively too.
      </p>

      <h2 id="whole-team-development">Whole-team development</h2>
      <p>
        Agent-native development isn't just for developers. The goal is actual
        agent-native development as a team:
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>Designers</strong> can update designs directly in the code
          through the agent
        </li>
        <li>
          <strong>Product managers</strong> can update functionalities and
          requirements
        </li>
        <li>
          <strong>QA</strong> can test and prompt for fixes
        </li>
        <li>
          <strong>Anyone on the team</strong> can contribute through natural
          language
        </li>
      </ul>
      <p>
        The vision is to reduce handoffs and enable one-person-to-full-team
        productivity using real collaboration between humans and agents.
      </p>

      <h2 id="fork-and-customize">Fork and customize</h2>
      <p>
        Agent-native apps follow a single-tenant, fork-and-customize model. You
        start from a template — mail, calendar, analytics, slides — and make it
        yours:
      </p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>
          Pick a template on{" "}
          <Link to="/templates" className="text-[var(--accent)]">
            agentnative.com
          </Link>
        </li>
        <li>
          Start using it immediately as a hosted app (e.g. mail.agentnative.com)
        </li>
        <li>
          Fork it when you want to customize — "connect to our Stripe account",
          "add a cohort chart"
        </li>
        <li>The agent modifies the code to match your needs</li>
        <li>Deploy your fork to your own domain</li>
      </ol>
      <p>
        Because it's your app — not shared infrastructure — the agent can safely
        evolve the code over time. Your app keeps improving as you use it.
      </p>

      <h2 id="composable-agents">Composable agents</h2>
      <p>
        Agent-native apps can communicate with each other using the{" "}
        <Link to="/docs/a2a-protocol" className="text-[var(--accent)]">
          A2A protocol
        </Link>
        . From the mail app, you can tag the analytics agent to query data and
        include results in a draft. An agent discovers what other agents are
        available, calls them over the protocol, and shows results in the UI.
      </p>
      <p>
        This is why agent-native is a{" "}
        <strong>framework and not a library</strong>. The architecture — shared
        database, polling sync, actions, application state — needs to be built
        in from the ground up. You can migrate existing apps, but the best
        practice is to build agent-native from the start.
      </p>
      <p>
        See the{" "}
        <Link to="/docs/key-concepts" className="text-[var(--accent)]">
          Key Concepts
        </Link>{" "}
        doc for the full technical details.
      </p>
    </DocsLayout>
  );
}
