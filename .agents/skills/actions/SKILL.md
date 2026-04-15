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

Use `defineAction` with a Zod schema (required for new actions):

```ts
// actions/list-meals.ts
import { z } from "zod";
import { defineAction } from "@agent-native/core";
import { getDb } from "../server/db/index.js";
import { meals } from "../server/db/schema.js";

export default defineAction({
  description: "List all meals",
  schema: z.object({
    date: z.string().describe("Filter by date (YYYY-MM-DD)"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    // args is fully typed: { date: string }
    const db = getDb();
    const rows = await db.select().from(meals);
    return rows; // Return objects/arrays, NOT JSON.stringify()
  },
});
```

The `schema` field accepts a Zod schema (or any Standard Schema-compatible library). It provides runtime validation with clear error messages (400 for HTTP, error result for agent), full TypeScript type inference for `run()` args, and auto-generated JSON Schema for the agent's tool definition. `zod` is a dependency of all templates.

Tips:
- Use `.describe()` for parameter descriptions
- Use `.optional()` for optional params
- Use `z.coerce.number()` / `z.coerce.boolean()` for params that arrive as strings from HTTP
- Use `z.enum(["draft", "published"])` for constrained values

The legacy `parameters` field (plain JSON Schema object) still works as a fallback but does not provide runtime validation or type inference.

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

### Screen Refresh (automatic)

The framework auto-refreshes the UI after any successful mutating action. On completion of a non-`GET` action, the server emits a poll event that the client's `useDbSync` picks up and uses to invalidate `["action"]` React Query keys — so `list-*` / `get-*` hooks refetch without a full page reload.

Rules:

- `http: { method: "GET" }` → read-only, does NOT trigger a refresh (inferred automatically).
- Any other action (default `POST`, `PUT`, `DELETE`, or `http: false`) → treated as mutating, triggers a refresh on success.
- To override the inference on an unusual action (e.g. a `POST` that only reads), pass `readOnly: true` on the action definition.

Agents do NOT need to call `refresh-screen` after a normal action — it's already handled. `refresh-screen` is only needed when the agent mutates data via a path the framework can't see (e.g. writing to an external system the app mirrors) or when the agent wants to pass a `scope` hint for narrower invalidation.

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
  // Types are auto-inferred from the action's schema + return type — no manual generic needed
  const { data: meals } = useActionQuery("list-meals", {
    date: "2025-01-01",
  });
  return <ul>{meals?.map((m) => <li key={m.id}>{m.name}</li>)}</ul>;
}
```

### `useActionMutation` — for POST/PUT/DELETE actions

```ts
import { useActionMutation } from "@agent-native/core/client";

function AddMealButton() {
  // Types are auto-inferred — no manual generic needed
  const { mutate } = useActionMutation("log-meal");
  return (
    <button onClick={() => mutate({ name: "Salad", calories: 350 })}>
      Log Meal
    </button>
  );
}
```

**Do NOT use manual type generics** like `useActionQuery<Meal[]>(...)`. Types are inferred automatically from `.generated/action-types.d.ts`, which is auto-generated by a Vite plugin.

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
import { z } from "zod";
import { defineAction } from "@agent-native/core";

export default defineAction({
  description: "List calendar events",
  schema: z.object({
    from: z.string().describe("Start date"),
    to: z.string().describe("End date"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    return await fetchEvents(args.from, args.to);
  },
});
```

**Write action (POST, default):**

```ts
import { z } from "zod";
import { defineAction } from "@agent-native/core";

export default defineAction({
  description: "Log a meal",
  schema: z.object({
    name: z.string().describe("Meal name"),
    calories: z.coerce.number().describe("Calorie count"),
  }),
  run: async (args) => {
    // args.calories is a number — z.coerce.number() handles string-to-number conversion from HTTP
    const meal = await insertMeal(args);
    return meal;
  },
});
```

**Agent-only action:**

```ts
import { z } from "zod";
import { defineAction } from "@agent-native/core";

export default defineAction({
  description: "Navigate the UI to a view",
  schema: z.object({
    view: z.string().describe("Target view"),
  }),
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
