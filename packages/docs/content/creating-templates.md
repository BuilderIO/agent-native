---
title: "Creating Templates"
description: "How to create and publish your own agent-native app templates."
---

# Creating Templates

How to build and publish your own agent-native app template.

## Overview {#overview}

Templates are complete, forkable agent-native apps that solve a specific use case. The analytics, content, slides, and video templates that ship with Agent-Native are all built this way. Anyone can create a template and share it with the community.

A good template:

- Solves a real workflow end-to-end (not a toy demo)
- Works out of the box with example data
- Has a comprehensive `AGENTS.md` so the AI agent understands the architecture
- Includes actions for key operations the agent can call
- Follows the core rules: data in SQL, all AI through agent chat, actions for operations, real-time sync, agent can modify code

## Start from the starter {#start-from-starter}

The fastest way to start is with the built-in starter template:

```bash
npx @agent-native/core create my-template
```

This scaffolds a minimal agent-native app with the standard directory structure, a working dev server, file watching, SSE, and an example action. Build your template on top of this.

## Project structure {#project-structure}

Every template follows the same convention:

```text
my-template/
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

  actions/            # Agent-callable actions
    run.ts            # Action dispatcher (don't modify)
    *.ts              # Your actions — one per operation

  data/               # File-based state (watched by SSE)
    .gitkeep          # Or seed data for the template

  .agents/skills/     # Agent skills — detailed guidance per topic

  AGENTS.md           # Master agent instructions
  react-router.config.ts # React Router config (ssr, appDirectory)
  package.json        # Scripts: dev, build, start, action, typecheck
  vite.config.ts      # Vite config (React Router + Nitro)
  tsconfig.json       # TypeScript config
```

## Build your client {#build-your-client}

The client uses React Router v7 framework mode with file-based routing. Pages go in `app/routes/`, global providers live in `app/root.tsx`, and React Query handles data fetching.

```ts
// app/root.tsx — App shell with providers
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDbSync } from "@agent-native/core";

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
  useDbSync({ queryClient, queryKeys: ["items", "projects"] });
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}
```

Routes are auto-discovered from `app/routes/` via `flatRoutes()`. Create a file to add a page:

```ts
// app/routes/_index.tsx → /
export default function Dashboard() {
  return <div>Home page</div>;
}

// app/routes/settings.tsx → /settings
export default function Settings() {
  return <div>Settings page</div>;
}
```

The `useDbSync` hook (formerly `useFileWatcher`) polls `/_agent-native/poll` and invalidates react-query caches when data changes. This is how the UI stays in sync when the agent modifies data.

## Add API routes {#add-api-routes}

API routes serve data from files and handle mutations. They go in `server/routes/` as file-based routes:

```ts
// server/routes/api/items/index.get.ts
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
});
```

Each route file exports a default `defineEventHandler`. Both the UI and the agent can create items — the UI via `POST /api/items`, the agent by writing directly to `data/items/`. The SSE watcher ensures both paths trigger UI updates.

## Add actions {#add-actions}

Actions are the agent's toolbox. Each action handles one operation — fetching data from an API, generating content, processing files, etc:

```typescript
// actions/import-data.ts
import { parseArgs } from "@agent-native/core";
import { writeFile, mkdir } from "node:fs/promises";

export default async function importData(args: string[]) {
  const { url, name } = parseArgs(args);
  if (!url) { console.error("--url is required"); process.exit(1); }

  const res = await fetch(url);
  const data = await res.json();

  const slug = name ?? "imported";
  await mkdir("./data/imports", { recursive: true });
  await writeFile(`./data/imports/${slug}.json`, JSON.stringify(data, null, 2));
  console.log(`Imported ${Array.isArray(data) ? data.length + " records" : "data"} to data/imports/${slug}.json`);
}
```

```bash
# The agent can run this
pnpm action import-data --url https://api.example.com/data --name users
```

Scripts should write their output to `data/` — the SSE watcher will notify the UI. Use `console.log` for output the agent can see. Use `console.error` and `process.exit(1)` for errors.

## Add data models {#add-data-models}

Seed your template with example data so it works immediately. Put JSON files in `data/` matching the structure your API routes expect:

```text
data/
  items/
    example-1.json     # {"id": "example-1", "title": "...", "status": "active"}
    example-2.json
  config.json          # App-level config
  sync-config.json     # (optional) Firestore sync glob patterns
```

Keep your data models simple — flat JSON files, one per entity. The agent can grep, read, and modify them. Deeply nested structures or binary formats make it harder for the agent to work with the data.

## Write AGENTS.md {#write-agents-md}

This is the most important file in your template. `AGENTS.md` tells the AI agent how your app works, what it can and can't do, and how to make changes:

````markdown
# My Template — Agent-Native App

## Architecture

This is an **@agent-native/core** application.

### Core Principles

1. **Data lives in SQL** — All state in SQL via Drizzle ORM.
2. **All AI through agent chat** — No inline LLM calls.
3. **Actions for operations** — `pnpm action <name>` for complex work.
4. **Real-time sync** — Polling keeps UI in sync with agent changes.
5. **Agent can update code** — Edit components, routes, actions.

### Directory Structure

```
app/             # React frontend (file-based routing in app/routes/)
server/          # Nitro API server
actions/         # Agent-callable actions
data/            # File-based state
```

### Available Actions

- `pnpm action import-data --url <url>` — Import data from API
- `pnpm action generate-report --id <id>` — Generate a report

### Data Model

Items are stored as `data/items/<id>.json`:
```json
{ "id": "...", "title": "...", "status": "active" }
```

### Key Patterns

- API routes in `server/routes/` serve files from `data/`
- UI delegates AI work via `sendToAgentChat()`
- Actions write results to `data/` — SSE updates the UI
````

Be specific about your data models, available actions, and key patterns. The better your `AGENTS.md`, the better the agent will work with your template.

## Add skills {#add-skills}

For complex topics that don't fit in `AGENTS.md`, create skills in `.agents/skills/`. Each skill is a Markdown file with detailed guidance for a specific topic:

```markdown
# .agents/skills/bigquery/SKILL.md

## BigQuery Integration

### Column Reference
- `event_name` — The event type (string)
- `event_timestamp` — Microsecond timestamp (int64)
- `user_pseudo_id` — Anonymous user ID (string)

### Common Queries
...

### Gotchas
- Always use `event_date` partition filter to avoid full table scans
- Timestamps are in microseconds, not milliseconds
```

Skills let you give the agent deep domain knowledge for specific integrations or patterns without bloating your main `AGENTS.md`.

## Onboarding & API keys {#onboarding}

If your template needs API keys or external service configuration, document them in a `.env.example` file:

```bash
# .env.example
BIGQUERY_PROJECT_ID=your-project-id
STRIPE_SECRET_KEY=sk_live_...
OPENAI_API_KEY=sk-...
```

When users fork your template, they copy `.env.example` to `.env` and fill in their own values. Keep the number of required keys minimal — the template should work with example data before any keys are configured.

## Publishing {#publishing}

To share your template:

1. Push your template to a public GitHub repo
2. Make sure it works with `pnpm install && pnpm dev`
3. Include seed data in `data/` so it works without API keys
4. Write a clear README explaining what the template does and how to configure it

Community templates can be shared via GitHub. The agent-native CLI supports creating from any git repo:

```bash
npx @agent-native/core create my-app --template github:user/repo
```
