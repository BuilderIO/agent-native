---
name: actions
description: >-
  How to create and run agent actions. Actions are the single source of truth
  for app operations — the agent calls them as tools, the frontend calls them
  as HTTP endpoints. Use when creating a new action, adding an API integration,
  or wiring up frontend data fetching.
---

# Agent Actions

## Rule

Actions in `actions/` are the **single source of truth** for app operations. The agent calls them as tools, and the framework auto-exposes them as HTTP endpoints at `/_agent-native/actions/:name`. The frontend calls those endpoints using React Query hooks. No duplicate `/api/` routes needed.

## Why

Actions give the agent callable tools with structured input/output, AND they give the frontend type-safe HTTP endpoints automatically. One implementation serves both the agent and the UI. They keep the agent's chat context clean, they're reusable, and they can be tested independently.

## How to Create an Action

Use `defineAction` (required for new actions):

```ts
// actions/list-meals.ts
import { defineAction } from "@agent-native/core";
import { getDb } from "../server/db/index.js";
import { meals } from "../server/db/schema.js";

export default defineAction({
  description: "List all meals",
  parameters: {
    date: { type: "string", description: "Filter by date (YYYY-MM-DD)" },
  },
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const rows = await db.select().from(meals);
    return rows; // Return objects/arrays, NOT JSON.stringify()
  },
});
```

### The `http` Option

Controls how the action is exposed as an HTTP endpoint:

| Value                     | Behavior                                                    | Use for                          |
| ------------------------- | ----------------------------------------------------------- | -------------------------------- |
| _(omitted)_               | Auto-exposed as `POST /_agent-native/actions/:name`         | Write operations (default)       |
| `{ method: "GET" }`       | Auto-exposed as `GET /_agent-native/actions/:name`          | Read-only queries                |
| `{ method: "PUT" }`       | Auto-exposed as `PUT /_agent-native/actions/:name`          | Update operations                |
| `{ method: "DELETE" }`    | Auto-exposed as `DELETE /_agent-native/actions/:name`       | Delete operations                |
| `{ method: "GET", path: "custom" }` | Auto-exposed as `GET /_agent-native/actions/custom` | Custom route path                |
| `false`                   | Agent-only, never exposed as HTTP                           | `navigate`, `view-screen`, internal actions |

### Return Values

Actions should return **structured data** (objects, arrays) — not `JSON.stringify()`. The framework serializes the response automatically. If you return a string, the framework tries to parse it as JSON for a clean response.

```ts
// Good — return structured data
run: async (args) => {
  const events = await fetchEvents(args.from, args.to);
  return events;
}

// Bad — don't stringify
run: async (args) => {
  const events = await fetchEvents(args.from, args.to);
  return JSON.stringify(events, null, 2);
}
```

## Frontend Hooks

The frontend calls action endpoints using React Query hooks from `@agent-native/core/client`:

### `useActionQuery` — for GET actions

```ts
import { useActionQuery } from "@agent-native/core/client";

function MealList() {
  const { data: meals } = useActionQuery<Meal[]>("list-meals", {
    date: "2025-01-01",
  });
  return <ul>{meals?.map((m) => <li key={m.id}>{m.name}</li>)}</ul>;
}
```

### `useActionMutation` — for POST/PUT/DELETE actions

```ts
import { useActionMutation } from "@agent-native/core/client";

function AddMealButton() {
  const { mutate } = useActionMutation<Meal>("log-meal");
  return (
    <button onClick={() => mutate({ name: "Salad", calories: 350 })}>
      Log Meal
    </button>
  );
}
```

Mutations automatically invalidate all `["action"]` query keys on success, so GET queries refetch.

## How to Run (Agent)

```bash
pnpm action my-action --input data/source.json --output data/result.json
```

## Action Dispatcher

The default template uses core's `runScript()` in `actions/run.ts`:

```ts
import { runScript } from "@agent-native/core";
runScript();
```

This is the canonical approach for new apps. Action names must be lowercase with hyphens only (e.g., `my-action`).

## When You Still Need Custom `/api/` Routes

Most operations should be actions. You only need custom routes in `server/routes/api/` for:

- **File uploads** — actions receive JSON params, not multipart form data
- **Streaming responses** — SSE or chunked responses that need direct H3 control
- **Webhooks** — external services POST to a specific URL
- **OAuth callbacks** — redirect-based flows that need specific URL patterns

If it's a standard CRUD operation or data query, use an action instead.

## Legacy Pattern (bare export)

Older actions use a bare async function export with `parseArgs`:

```ts
import { parseArgs, loadEnv, fail } from "@agent-native/core";

export default async function myAction(args: string[]) {
  loadEnv();
  const parsed = parseArgs(args);
  // ...
}
```

This still works but is not auto-exposed as HTTP. Prefer `defineAction` for all new actions.

## Guidelines

- **One action, one job.** Keep actions focused on a single operation. The agent composes multiple action calls for complex operations.
- **Return structured data.** Return objects/arrays, not `JSON.stringify()`.
- **Use `http: { method: "GET" }`** for read-only actions. Default is POST.
- **Use `http: false`** for agent-only actions (`navigate`, `view-screen`).
- **Use `loadEnv()`** if the action needs environment variables (API keys, etc.).
- **Use `fail()`** for user-friendly error messages (exits with message, no stack trace).
- **Import from `@agent-native/core`** — Don't redefine `parseArgs()` or other utilities locally.

## Common Patterns

**Read action (GET):**

```ts
import { defineAction } from "@agent-native/core";

export default defineAction({
  description: "List calendar events",
  parameters: {
    from: { type: "string", description: "Start date" },
    to: { type: "string", description: "End date" },
  },
  http: { method: "GET" },
  run: async (args) => {
    return await fetchEvents(args.from, args.to);
  },
});
```

**Write action (POST, default):**

```ts
import { defineAction } from "@agent-native/core";

export default defineAction({
  description: "Log a meal",
  parameters: {
    name: { type: "string", description: "Meal name" },
    calories: { type: "string", description: "Calorie count" },
  },
  run: async (args) => {
    const meal = await insertMeal(args);
    return meal;
  },
});
```

**Agent-only action:**

```ts
import { defineAction } from "@agent-native/core";

export default defineAction({
  description: "Navigate the UI to a view",
  parameters: {
    view: { type: "string", description: "Target view" },
  },
  http: false,
  run: async (args) => {
    await writeAppState("navigate", { command: "go", view: args.view });
    return "Navigated";
  },
});
```

## Troubleshooting

- **Action not found** — Check that the filename matches the command name exactly. `pnpm action foo-bar` looks for `actions/foo-bar.ts`.
- **Args not parsing** — Ensure args use `--key value` or `--key=value` format. Boolean flags use `--flag` (sets value to `"true"`).
- **Frontend getting 405** — The action's `http.method` doesn't match the hook. Use `useActionQuery` for GET actions, `useActionMutation` for POST/PUT/DELETE.
- **Frontend getting undefined** — Make sure the action returns structured data, not `JSON.stringify()`.

## Related Skills

- **storing-data** — Actions read/write data in SQL
- **delegate-to-agent** — The agent invokes actions via `pnpm action <name>`
- **real-time-sync** — Database writes from actions trigger poll events to update the UI
- **adding-a-feature** — Actions are area 2 of the four-area checklist
