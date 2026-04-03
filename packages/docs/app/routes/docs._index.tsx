import DocsLayout from "../components/DocsLayout";
import CodeBlock from "../components/CodeBlock";
import { templates } from "../components/TemplateCard";

const TOC = [
  { id: "start-from-a-template", label: "Start from a Template" },
  { id: "choose-a-template", label: "Choose a Template" },
  { id: "start-from-scratch", label: "Start from Scratch" },
  { id: "project-structure", label: "Project Structure" },
  { id: "configuration", label: "Configuration" },
  { id: "architecture-principles", label: "Architecture Principles" },
];

export default function DocsIndex() {
  return (
    <DocsLayout toc={TOC}>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">
        Getting Started
      </h1>
      <p className="mb-4 text-base text-[var(--fg-secondary)]">
        The fastest way to get started is to pick a template and customize it.
        Templates are complete, production-ready apps — not starter kits. You
        get a working app in under a minute and start making it yours.
      </p>

      <h2 id="start-from-a-template">Start from a Template</h2>
      <p>Pick a template and create your app:</p>
      <CodeBlock
        code="npx @agent-native/core create my-app --template mail"
        lang="bash"
      />
      <p>Then run it:</p>
      <CodeBlock code={`cd my-app\npnpm install\npnpm dev`} lang="bash" />
      <p>
        That's it — you have a full email client running locally with an AI
        agent built in. Open the agent panel, ask it to do something, and watch
        it work.
      </p>
      <p>
        From here, use your AI coding tool (Claude Code, Cursor, Windsurf, etc.)
        to customize it. The agent instructions in <code>AGENTS.md</code> are
        already set up so any tool understands the codebase.
      </p>

      <h2 id="choose-a-template">Choose a Template</h2>
      <p>
        Each template is a complete app with UI, agent actions, database schema,
        and AI instructions ready to go. Replace <code>mail</code> in the
        command above with any template name:
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Template</th>
              <th>Replaces</th>
              <th>Flag</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.slug}>
                <td>
                  <a
                    href={`/templates/${t.slug}`}
                    className="font-medium text-[var(--accent)]"
                  >
                    {t.name}
                  </a>
                </td>
                <td>{t.replaces.replace(/^Replaces or augments /, "")}</td>
                <td>
                  <code>--template {t.slug}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Browse the{" "}
        <a href="/templates" className="text-[var(--accent)]">
          template gallery
        </a>{" "}
        for live demos and detailed feature lists.
      </p>

      <h2 id="start-from-scratch">Start from Scratch</h2>
      <p>
        If you want a blank canvas instead of a template, create a project
        without the <code>--template</code> flag:
      </p>
      <CodeBlock code="npx @agent-native/core create my-app" lang="bash" />
      <p>
        This gives you the framework scaffolding — React frontend, Nitro
        backend, agent panel, and database — but no domain-specific code. Good
        for building something entirely new.
      </p>

      <h2 id="project-structure">Project Structure</h2>
      <p>
        Every agent-native app — whether from a template or from scratch —
        follows the same structure:
      </p>
      <CodeBlock
        code={`my-app/
  app/             # React frontend (routes, components, hooks)
  server/          # Nitro API server (routes, plugins)
  actions/         # Agent-callable actions
  .agents/         # Agent instructions and skills`}
        lang="text"
      />
      <p>
        Templates add domain-specific code on top of this: database schemas in{" "}
        <code>server/db/</code>, API routes in <code>server/routes/api/</code>,
        and actions in <code>actions/</code>.
      </p>

      <h2 id="configuration">Configuration</h2>
      <p>
        Templates come pre-configured. If you're starting from scratch, here are
        the config files:
      </p>
      <CodeBlock
        code={`// vite.config.ts
import { defineConfig } from "@agent-native/core/vite";
export default defineConfig();`}
      />
      <CodeBlock
        code={`// tsconfig.json
{ "extends": "@agent-native/core/tsconfig.base.json" }`}
        lang="json"
      />
      <CodeBlock
        code={`// tailwind.config.ts
import type { Config } from "tailwindcss";
import preset from "@agent-native/core/tailwind";

export default {
  presets: [preset],
  content: ["./app/**/*.{ts,tsx}"],
} satisfies Config;`}
      />

      <h2 id="architecture-principles">Architecture Principles</h2>
      <p>
        These principles apply to all agent-native apps. Understanding them
        helps you customize templates or build from scratch:
      </p>
      <ol className="list-decimal space-y-3 pl-5">
        <li>
          <strong>Agent + UI are equal partners</strong> — Everything the UI can
          do, the agent can do, and vice versa. They share the same database and
          always stay in sync. You don't think about "the agent" and "the app"
          separately — you think about them together.
        </li>
        <li>
          <strong>Context-aware</strong> — The agent always knows what you're
          looking at. If an email is open, it knows which one. If you select
          text and hit Cmd+I, it can act on just that selection.
        </li>
        <li>
          <strong>Skills-driven</strong> — Core functionalities have
          instructions so the agent doesn't explore from scratch every time.
          When you add a feature, you update all four areas: UI, actions,
          skills/instructions, and application state.
        </li>
        <li>
          <strong>Inter-agent communication</strong> — Agents can discover and
          call each other via the A2A protocol. Tag your analytics agent from
          the mail app to pull data into a draft.
        </li>
        <li>
          <strong>Fully portable</strong> — Any SQL database Drizzle supports,
          any hosting backend Nitro supports, any AI coding tool. These are
          non-negotiable.
        </li>
        <li>
          <strong>Fork and customize</strong> — Single-tenant apps you clone and
          evolve. The agent can modify the app's own code — components, routes,
          styles, actions — so it gets better over time.
        </li>
      </ol>
    </DocsLayout>
  );
}
