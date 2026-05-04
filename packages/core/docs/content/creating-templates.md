---
title: "Creating Templates"
description: "How to create and publish your own agent-native app templates."
---

# Creating Templates

Templates are complete, forkable agent-native apps that solve a real workflow. The first-party templates are built with the same framework surface you use: React routes for the UI, Drizzle SQL for data, actions for operations, workspace resources for agent behavior, and polling sync so the agent and UI stay aligned.

A good template:

- Solves one workflow end-to-end, with useful seed data or an empty-state flow.
- Stores durable state in SQL, not JSON files.
- Defines app operations as `defineAction()` actions.
- Exposes navigation and selection through application state.
- Ships a clear `AGENTS.md` plus focused skills for non-obvious workflows.
- Registers onboarding steps for required providers and secrets.
- Works as a standalone app and as part of a multi-app workspace.

## Start from Starter {#start-from-starter}

Use the CLI-only Starter scaffold when you want a blank app with the framework wiring already in place:

```bash
pnpm dlx @agent-native/core create my-template --template starter --standalone
```

For a workspace with multiple apps, run the picker and include Starter with any domain templates you want:

```bash
pnpm dlx @agent-native/core create my-platform
```

Starter gives you auth, the agent sidebar, SQL-backed resources, tools, application state, actions, and polling sync. You add the domain model and product UI.

## Project Structure {#project-structure}

Every template follows the same broad layout:

```text
my-template/
  app/
    root.tsx              # HTML shell and providers
    routes/               # React Router file routes
    components/           # Template UI
    hooks/                # UI state and data hooks

  actions/
    *.ts                  # defineAction operations

  server/
    db/schema.ts          # Drizzle schema
    plugins/db.ts         # additive migrations
    plugins/*.ts          # startup integrations
    routes/api/*.ts       # custom routes only when actions are not enough

  shared/
    types.ts              # shared client/server types

  .agents/skills/
    <skill>/SKILL.md      # agent guidance for complex workflows

  AGENTS.md               # template-specific agent instructions
  package.json
  react-router.config.ts
  vite.config.ts
```

Do not add a `data/` directory for application state. Durable app data belongs in SQL, and the UI reads it through actions or typed server handlers.

## Model Data In SQL {#data-models}

Define domain tables with the framework Drizzle helpers so schemas stay portable across SQLite, Postgres, D1, Turso, Supabase, and Neon:

```ts
// server/db/schema.ts
import {
  table,
  text,
  integer,
  now,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";

export const projects = table("projects", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  status: text("status", {
    enum: ["draft", "active", "archived"],
  })
    .notNull()
    .default("draft"),
  sortOrder: integer("sort_order").notNull().default(0),
  ...ownableColumns(),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const projectShares = createSharesTable("project_shares", "project");
```

Schema changes must be additive. Add tables and columns through `runMigrations()` in `server/plugins/db.ts`; never use destructive SQL, `drizzle-kit push`, table renames, or column drops.

```ts
// server/plugins/db.ts
import { runMigrations } from "@agent-native/core/db/migrations";

export default runMigrations([
  {
    id: "001_create_projects",
    sql: `CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      sort_order INTEGER NOT NULL DEFAULT 0,
      owner_email TEXT NOT NULL,
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  },
]);
```

Use the [Database](/docs/database) and [Security](/docs/security) docs before adding schemas that hold user or org data.

## Define Operations As Actions {#actions}

Actions are the single source of truth for app behavior. The agent calls them as tools, the frontend calls them through hooks or HTTP, and other apps can reach them through MCP/A2A.

```ts
// actions/create-project.ts
import { defineAction } from "@agent-native/core";
import { getDb } from "@agent-native/core/db";
import { nanoid } from "nanoid";
import { z } from "zod";
import * as schema from "../server/db/schema";

export default defineAction({
  description: "Create a project.",
  schema: z.object({
    title: z.string().min(1).describe("Project title"),
  }),
  run: async ({ title }, ctx) => {
    const db = getDb();
    const id = nanoid();
    await db.insert(schema.projects).values({
      id,
      title,
      ownerEmail: ctx.userEmail,
      orgId: ctx.orgId,
    });
    return { id, title };
  },
});
```

Use `http: { method: "GET" }` or `readOnly: true` for read-only actions. Use `parallelSafe: true` only for mutating actions that are safe to run concurrently with same-turn tool calls. Use `toolCallable: false` for high-blast-radius actions that should not run from sandboxed tools.

## Build The UI {#ui}

Routes live in `app/routes/` and use React Router v7 file routing. Query data through actions or API handlers, and make mutations optimistic by default.

```tsx
import { useActionMutation, useActionQuery } from "@agent-native/core/client";

export default function ProjectsPage() {
  const { data: projects = [] } = useActionQuery("list-projects", {});
  const create = useActionMutation("create-project");

  return (
    <button onClick={() => create.mutate({ title: "Launch plan" })}>
      New project ({projects.length})
    </button>
  );
}
```

Wire polling once near the app shell so React Query caches refresh when the agent, another tab, or an action changes data:

```tsx
import { useDbSync } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";

export function AppSync() {
  const queryClient = useQueryClient();
  useDbSync({ queryClient });
  return null;
}
```

## Add Application State {#application-state}

Application state is how the agent knows what the user is seeing. At minimum, add:

- A UI hook that writes `navigation` state when routes, selected records, filters, or editor selections change.
- A `view-screen` action that reads that state and returns the current screen snapshot.
- A `navigate` action that writes a one-shot `navigate` command for the UI to consume.

```ts
// actions/navigate.ts
import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description: "Navigate the UI.",
  schema: z.object({
    view: z.enum(["home", "project"]),
    projectId: z.string().optional(),
  }),
  run: async (args) => {
    await writeAppState("navigate", args);
    return { ok: true };
  },
});
```

See [Context Awareness](/docs/context-awareness) for the full pattern.

## Use API Routes Sparingly {#api-routes}

Prefer actions for app operations. Create custom Nitro routes only for surfaces that cannot be actions cleanly:

- File upload or binary streaming.
- Public anonymous pages and webhooks.
- OAuth callbacks and provider-specific protocol handlers.
- Server-rendered public content.

Custom routes that touch ownable data must call `getSession(event)` and wrap database work in `runWithRequestContext({ userEmail, orgId }, fn)` before using access helpers.

## Write Agent Instructions {#write-agents-md}

`AGENTS.md` is the agent's map of your app. Keep it specific and operational:

```markdown
# My Template

## Product Model

Projects are the top-level resource. They contain tasks and notes.

## Navigation State

- `navigation.view`: `home` or `project`
- `navigation.projectId`: selected project when on a project page

## Actions

| Action           | Purpose                     |
| ---------------- | --------------------------- |
| `list-projects`  | List accessible projects    |
| `create-project` | Create a project            |
| `update-project` | Rename or archive a project |

## Rules

- Use `view-screen` before acting on "this project" if the current screen is unclear.
- Use actions for project changes; do not write raw SQL unless debugging.
- For shared projects, check access through framework sharing helpers.
```

Update `AGENTS.md` whenever you add a new action, route, state key, or recurring workflow.

## Add Skills {#skills}

Use skills for detailed patterns that would bloat `AGENTS.md`: provider-specific APIs, import/export formats, complex editing flows, or domain terminology.

```markdown
---
name: project-imports
description: How to import projects from the legacy CSV export.
---

# Project Imports

Use this skill when the user uploads a legacy project CSV.

## Rules

- Validate required columns before creating rows.
- Use `create-project` for each project so ownership and sync are correct.
- Save rejected rows as a note attached to the import summary.
```

Store template skills in `.agents/skills/<name>/SKILL.md`. If users should be able to edit the guidance at runtime, surface it through workspace resources as well.

## Register Setup Steps {#onboarding}

If a template needs an API key, OAuth connection, or provider account, register an onboarding step instead of burying the requirement in a README.

```ts
// server/plugins/onboarding.ts
import { defineNitroPlugin } from "@agent-native/core/server";
import { registerOnboardingStep } from "@agent-native/core/onboarding";

export default defineNitroPlugin(() => {
  registerOnboardingStep({
    id: "github",
    title: "Connect GitHub",
    description: "Needed to import repositories and pull requests.",
    order: 100,
    methods: [
      {
        id: "token",
        kind: "form",
        primary: true,
        label: "Save token",
        payload: {
          fields: [
            { key: "GITHUB_TOKEN", label: "GitHub token", secret: true },
          ],
        },
      },
    ],
    isComplete: () => !!process.env.GITHUB_TOKEN,
  });
});
```

See [Onboarding & API Keys](/docs/onboarding).

## Make It Workspace-Ready {#workspace-ready}

Templates should fit naturally into [Multi-App Workspaces](/docs/multi-app-workspace), usually coordinated by [Dispatch](/docs/dispatch).

Checklist:

- Mount A2A through the framework agent chat plugin or `mountA2A()` so sibling apps can call your agent.
- Keep the agent card descriptions specific enough for Dispatch to route work accurately.
- Register required secrets/onboarding so setup appears in the sidebar and Dispatch can manage shared credentials.
- Keep cross-cutting instructions in workspace `AGENTS.md` or workspace resources, not copied into every app.
- Use sharing/access helpers for all ownable resources so org-scoped workspaces stay isolated.

## Publish A Template {#publishing}

Before sharing:

1. Run `pnpm install`, `pnpm typecheck`, and the template's tests.
2. Verify it works with no optional provider keys configured.
3. Check auth, sharing, and two-user data isolation.
4. Document required env vars and onboarding steps.
5. Include examples or seed rows through additive migrations, not tracked runtime data files.

Community templates can be created from a GitHub repo:

```bash
pnpm dlx @agent-native/core create my-app --template github:user/repo
```
