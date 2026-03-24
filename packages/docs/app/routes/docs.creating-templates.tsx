import DocsLayout from "../components/DocsLayout";
import CodeBlock from "../components/CodeBlock";

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "start-from-starter", label: "Start from the Starter" },
  { id: "project-structure", label: "Project Structure" },
  { id: "build-your-client", label: "Build Your Client" },
  { id: "add-api-routes", label: "Add API Routes" },
  { id: "add-scripts", label: "Add Scripts" },
  { id: "add-data-models", label: "Add Data Models" },
  { id: "write-agents-md", label: "Write AGENTS.md" },
  { id: "add-skills", label: "Add Skills" },
  { id: "onboarding", label: "Onboarding & API Keys" },
  { id: "publishing", label: "Publishing" },
];

export default function CreatingTemplatesDocs() {
  return (
    <DocsLayout toc={TOC}>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">
        Creating Templates
      </h1>
      <p className="mb-4 text-base text-[var(--fg-secondary)]">
        How to build and publish your own agent-native app template.
      </p>

      <h2 id="overview">Overview</h2>
      <p>
        Templates are complete, forkable agent-native apps that solve a specific
        use case. The analytics, content, slides, and video templates that ship
        with Agent-Native are all built this way. Anyone can create a template
        and share it with the community.
      </p>
      <p>A good template:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>Solves a real workflow end-to-end (not a toy demo)</li>
        <li>Works out of the box with example data</li>
        <li>
          Has a comprehensive <code>AGENTS.md</code> so the AI agent understands
          the architecture
        </li>
        <li>Includes scripts for key operations the agent can call</li>
        <li>
          Follows the five rules: files as database, all AI through agent chat,
          scripts for operations, SSE sync, agent can modify code
        </li>
      </ul>

      <h2 id="start-from-starter">Start from the starter</h2>
      <p>The fastest way to start is with the built-in starter template:</p>
      <CodeBlock
        code={`npx @agent-native/core create my-template`}
        lang="bash"
      />
      <p>
        This scaffolds a minimal agent-native app with the standard directory
        structure, a working dev server, file watching, SSE, and an example
        script. Build your template on top of this.
      </p>

      <h2 id="project-structure">Project structure</h2>
      <p>Every template follows the same convention:</p>
      <CodeBlock
        code={`my-template/
  app/                # React frontend
    routes/           # File-based page routes (auto-discovered)
      _index.tsx      # / (home page)
      settings.tsx    # /settings
    root.tsx          # App shell — <html>, <head>, <body>, providers
    entry.client.tsx  # Client hydration entry
    routes.ts         # Route config — flatRoutes()
    components/       # UI components
    components/ui/    # Reusable primitives (shadcn/ui)
    hooks/            # React hooks
    lib/utils.ts      # cn() utility

  server/             # Nitro API server
    routes/           # File-based API routes (auto-discovered by Nitro)
      [...page].get.ts # SSR catch-all (delegates to React Router)
    plugins/          # Server plugins (startup logic)
    lib/              # Shared server modules

  shared/             # Isomorphic types (imported by client & server)
    api.ts            # Shared interfaces

  scripts/            # Agent-callable scripts
    run.ts            # Script dispatcher (don't modify)
    *.ts              # Your scripts — one per operation

  data/               # File-based state (watched by SSE)
    .gitkeep          # Or seed data for the template

  .agents/skills/     # Agent skills — detailed guidance per topic

  AGENTS.md           # Master agent instructions
  react-router.config.ts # React Router config (ssr, appDirectory)
  package.json        # Scripts: dev, build, start, script, typecheck
  vite.config.ts      # Vite config (React Router + Nitro)
  tsconfig.json       # TypeScript config`}
        lang="text"
      />

      <h2 id="build-your-client">Build your client</h2>
      <p>
        The client uses React Router v7 framework mode with file-based routing.
        Pages go in <code>app/routes/</code>, global providers live in{" "}
        <code>app/root.tsx</code>, and React Query handles data fetching.
      </p>
      <CodeBlock
        code={`// app/root.tsx — App shell with providers
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFileWatcher } from "@agent-native/core";

const queryClient = new QueryClient();

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function Root() {
  useFileWatcher({ queryClient, queryKeys: ["items", "projects"] });
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}`}
      />
      <p>
        Routes are auto-discovered from <code>app/routes/</code> via{" "}
        <code>flatRoutes()</code>. Create a file to add a page:
      </p>
      <CodeBlock
        code={`// app/routes/_index.tsx → /
export default function Dashboard() {
  return <div>Home page</div>;
}

// app/routes/settings.tsx → /settings
export default function Settings() {
  return <div>Settings page</div>;
}`}
      />
      <p>
        The <code>useFileWatcher</code> hook connects to{" "}
        <code>/api/events</code> and invalidates react-query caches when files
        change. This is how the UI stays in sync when the agent modifies data.
      </p>

      <h2 id="add-api-routes">Add API routes</h2>
      <p>
        API routes serve data from files and handle mutations. They go in{" "}
        <code>server/routes/</code> as file-based routes:
      </p>
      <CodeBlock
        code={`// server/routes/api/items/index.get.ts
import { defineEventHandler } from "h3";
import { readdir, readFile, mkdir } from "node:fs/promises";
import path from "node:path";

export default defineEventHandler(async () => {
  const dir = "./data/items";
  await mkdir(dir, { recursive: true });
  const files = await readdir(dir);
  return Promise.all(
    files.filter(f => f.endsWith(".json")).map(async f => {
      const content = await readFile(path.join(dir, f), "utf-8");
      return JSON.parse(content);
    })
  );
});`}
      />
      <p>
        Each route file exports a default <code>defineEventHandler</code>. Both
        the UI and the agent can create items — the UI via{" "}
        <code>POST /api/items</code>, the agent by writing directly to{" "}
        <code>data/items/</code>. The SSE watcher ensures both paths trigger UI
        updates.
      </p>

      <h2 id="add-scripts">Add scripts</h2>
      <p>
        Scripts are the agent's toolbox. Each script handles one operation —
        fetching data from an API, generating content, processing files, etc:
      </p>
      <CodeBlock
        code={`// scripts/import-data.ts
import { parseArgs } from "@agent-native/core";
import { writeFile, mkdir } from "node:fs/promises";

export const meta = () => [
      { title: "Creating Templates — Agent-Native" },
      {
        name: "description",
        content:
          "How to create and publish your own agent-native app templates.",
      },
    ];

export default async function importData(args: string[]) {
  const { url, name } = parseArgs(args);
  if (!url) { console.error("--url is required"); process.exit(1); }

  const res = await fetch(url);
  const data = await res.json();

  const slug = name ?? "imported";
  await mkdir("./data/imports", { recursive: true });
  await writeFile(\`./data/imports/\${slug}.json\`, JSON.stringify(data, null, 2));
  console.log(\`Imported \${Array.isArray(data) ? data.length + " records" : "data"} to data/imports/\${slug}.json\`);
}`}
        lang="typescript"
      />
      <CodeBlock
        code={`# The agent can run this
pnpm script import-data --url https://api.example.com/data --name users`}
        lang="bash"
      />
      <p>
        Scripts should write their output to <code>data/</code> — the SSE
        watcher will notify the UI. Use <code>console.log</code> for output the
        agent can see. Use <code>console.error</code> and{" "}
        <code>process.exit(1)</code> for errors.
      </p>

      <h2 id="add-data-models">Add data models</h2>
      <p>
        Seed your template with example data so it works immediately. Put JSON
        files in <code>data/</code> matching the structure your API routes
        expect:
      </p>
      <CodeBlock
        code={`data/
  items/
    example-1.json     # {"id": "example-1", "title": "...", "status": "active"}
    example-2.json
  config.json          # App-level config
  sync-config.json     # (optional) Firestore sync glob patterns`}
        lang="text"
      />
      <p>
        Keep your data models simple — flat JSON files, one per entity. The
        agent can grep, read, and modify them. Deeply nested structures or
        binary formats make it harder for the agent to work with the data.
      </p>

      <h2 id="write-agents-md">Write AGENTS.md</h2>
      <p>
        This is the most important file in your template. <code>AGENTS.md</code>{" "}
        tells the AI agent how your app works, what it can and can't do, and how
        to make changes:
      </p>
      <CodeBlock
        code={`# My Template — Agent-Native App

## Architecture

This is an **@agent-native/core** application.

### Core Principles

1. **Files as database** — All state in \`data/\`. No traditional DB.
2. **All AI through agent chat** — No inline LLM calls.
3. **Scripts for operations** — \`pnpm script <name>\` for complex work.
4. **SSE sync** — File watcher keeps UI in sync.
5. **Agent can update code** — Edit components, routes, scripts.

### Directory Structure

\\\`\\\`\\\`
app/             # React frontend (file-based routing in app/routes/)
server/          # Nitro API server
scripts/         # Agent-callable scripts
data/            # File-based state
\\\`\\\`\\\`

### Available Scripts

- \`pnpm script import-data --url <url>\` — Import data from API
- \`pnpm script generate-report --id <id>\` — Generate a report

### Data Model

Items are stored as \`data/items/<id>.json\`:
\\\`\\\`\\\`json
{ "id": "...", "title": "...", "status": "active" }
\\\`\\\`\\\`

### Key Patterns

- API routes in \`server/routes/\` serve files from \`data/\`
- UI delegates AI work via \`sendToAgentChat()\`
- Scripts write results to \`data/\` — SSE updates the UI`}
        lang="markdown"
      />
      <p>
        Be specific about your data models, available scripts, and key patterns.
        The better your <code>AGENTS.md</code>, the better the agent will work
        with your template.
      </p>

      <h2 id="add-skills">Add skills</h2>
      <p>
        For complex topics that don't fit in <code>AGENTS.md</code>, create
        skills in <code>.agents/skills/</code>. Each skill is a Markdown file
        with detailed guidance for a specific topic:
      </p>
      <CodeBlock
        code={`# .agents/skills/bigquery/SKILL.md

## BigQuery Integration

### Column Reference
- \`event_name\` — The event type (string)
- \`event_timestamp\` — Microsecond timestamp (int64)
- \`user_pseudo_id\` — Anonymous user ID (string)

### Common Queries
...

### Gotchas
- Always use \`event_date\` partition filter to avoid full table scans
- Timestamps are in microseconds, not milliseconds`}
        lang="markdown"
      />
      <p>
        Skills let you give the agent deep domain knowledge for specific
        integrations or patterns without bloating your main{" "}
        <code>AGENTS.md</code>.
      </p>

      <h2 id="onboarding">Onboarding & API keys</h2>
      <p>
        If your template needs API keys or external service configuration,
        document them in a <code>.env.example</code> file:
      </p>
      <CodeBlock
        code={`# .env.example
BIGQUERY_PROJECT_ID=your-project-id
STRIPE_SECRET_KEY=sk_live_...
OPENAI_API_KEY=sk-...`}
        lang="bash"
      />
      <p>
        When users fork your template, they copy <code>.env.example</code> to{" "}
        <code>.env</code>
        and fill in their own values. Keep the number of required keys minimal —
        the template should work with example data before any keys are
        configured.
      </p>

      <h2 id="publishing">Publishing</h2>
      <p>To share your template:</p>
      <ol className="list-decimal space-y-2 pl-5">
        <li>Push your template to a public GitHub repo</li>
        <li>
          Make sure it works with <code>pnpm install && pnpm dev</code>
        </li>
        <li>
          Include seed data in <code>data/</code> so it works without API keys
        </li>
        <li>
          Write a clear README explaining what the template does and how to
          configure it
        </li>
      </ol>
      <p>
        Community templates can be shared via GitHub. The agent-native CLI
        supports creating from any git repo:
      </p>
      <CodeBlock
        code={`npx @agent-native/core create my-app --template github:user/repo`}
        lang="bash"
      />
    </DocsLayout>
  );
}
