---
name: actions
description: >-
  How to create and run agent actions. Actions are the single source of truth
  for app operations — the agent calls them as tools and frontend code calls
  them through client hooks. Use when creating a new action, adding an API
  integration, or wiring up frontend data fetching.
scope: dev
metadata:
  internal: true
---

# Agent Actions

## Rule

Actions in `actions/` are the **single source of truth** for app operations. The agent calls them as tools, the frontend calls them through `useActionQuery` / `useActionMutation`, and the framework owns the HTTP transport behind those hooks — no duplicate `/api/` routes.

Before creating any custom route for app data, check `actions/` and the action table in `AGENTS.md`. An action already exists? Call it directly. Missing? Create or update a `defineAction`. **Stop trigger:** about to add a file under `server/routes/api/` (or middleware to guard one)? Check it against the exception list in *Custom `/api/` Routes* below first — even if you already started the route.

## Keep Actions Deterministic

An action may call a provider API, validate data, and persist records without being an AI feature — keep it deterministic, focused, and independently useful to the agent. Don't put LLM calls or a second model runtime in ordinary actions (`completeText()` in `delegate-to-agent` is the one narrow exception).

When a workflow is research, analysis, generation, recommendation, or synthesis — or spans several provider calls and writes — route it to the AgentSidebar via `sendToAgentChat({ openSidebar: true })` and let the agent orchestrate focused actions instead of hiding an AI-shaped workflow behind one opaque `generate-*`/`create-*` action just because its implementation happens to be deterministic.

## How to Create an Action

```ts
// actions/list-meals.ts
import { z } from "zod";
import { defineAction } from "@agent-native/core/action";
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

`schema` (Zod or Standard Schema-compatible) gives runtime validation, TS inference for `run()` args, and an auto-generated JSON Schema for the tool. `.describe()` each param, `.optional()` for optional ones, `z.enum([...])` for constrained values, `z.coerce.number()` for numeric HTTP params — but write an explicit boolean parser instead of `z.coerce.boolean()`, which treats `"false"` as truthy.

Use Drizzle's query builder, not raw SQL/`getDbExec()`/dialect-specific imports, unless Drizzle can't express the query. Never hardcode API keys/tokens/secrets — read via `readAppSecret` / `resolveCredential` / OAuth helpers; `process.env` is deploy-level config only.

**Decision order:** existing action → extend/create a `defineAction` → custom route as last resort (*Custom `/api/` Routes* below). Actions are already callable by agents, CLIs, hooks, HTTP, and MCP/A2A — don't wrap them in an umbrella REST API.

## Keep the Action Surface Small and Orthogonal

Every agent-exposed action is a tool in the model's context window; more tools degrades tool-selection quality. Add the fewest, most orthogonal actions that cover the capability.

- **One orthogonal `update` per resource**, not one per field — `update-<thing>` taking an optional-fields patch, not `update-<thing>-name` + `update-<thing>-order` + …
- **Reach for a generic escape hatch before minting a new read action** — the `provider-api-catalog`/`docs`/`request` trio for provider data (`references/provider-apis.md`), `db-query` for ad hoc app-data reads in dev.
- **`agentTool: false`** hides a UI-only/programmatic action from the model while keeping it frontend/HTTP-callable — not `toolCallable: false`, which only blocks the sandboxed extension bridge and leaves the action visible everywhere else; reserve that one for high-blast-radius operations.
- **Delete or hide stale actions** once the UI stops using them; `pnpm actions:audit` advisory-flags likely-dead/redundant ones (`references/examples.md`).

## The `http` Option

Controls HTTP exposure:

| Value | Behavior | Use for |
| --- | --- | --- |
| _(omitted)_ | `POST /_agent-native/actions/:name` | Write operations (default) |
| `{ method: "GET" }` | `GET /_agent-native/actions/:name` | Read-only queries |
| `{ method: "PUT"/"DELETE" }` | matching verb | Update / delete |
| `{ method: "GET", path: "x" }` | custom route path | Non-default path |
| `false` | never exposed as HTTP | `navigate`, `view-screen`, internal |

Mutating actions (anything but `GET`) auto-refresh the UI on success — don't call `refresh-screen` after a normal action. Overrides (`readOnly`, `parallelSafe`) and exact trigger rules: `references/action-fields.md`.

## Return Values

Return **structured data** (objects, arrays), never `JSON.stringify()` — the framework serializes the response and only tries to parse a returned string as JSON, which isn't the same contract.

```ts
run: async (args) => await fetchEvents(args.from, args.to); // good
run: async (args) => JSON.stringify(await fetchEvents(...)); // bad
```

Reach for `outputSchema` (validate the return), `_agentImages` (attach images the agent can see), `authorize` (gate who may call it), or `needsApproval` (require human sign-off per call) only when the action needs that guarantee — examples in `references/action-fields.md`.

## Frontend Hooks

Use hooks from `@agent-native/core/client`, not hand-written `fetch("/_agent-native/actions/...")`.

```ts
import { useActionQuery, useActionMutation, callAction } from "@agent-native/core/client/hooks";

const { data: meals } = useActionQuery("list-meals", { date: "2025-01-01" }); // GET, types auto-inferred
const { mutate } = useActionMutation("log-meal");                             // POST/PUT/DELETE
mutate({ name: "Salad", calories: 350 });
const people = await callAction("search-people", { query }, { method: "GET" }); // imperative (debounce, prefetch)
```

Don't add manual generics like `useActionQuery<Meal[]>(...)` — types come from `.generated/action-types.d.ts`. Mutations auto-invalidate all `["action"]` query keys, so GET queries refetch.

## How to Run (Agent)

```bash
pnpm action my-action --input data/source.json --output data/result.json
```

The default template dispatches through core's `runScript()` in `actions/run.ts`. Action names are lowercase-with-hyphens (`pnpm action my-action` → `actions/my-action.ts`).

After adding or changing several related actions, smoke-test **once** (one
happy-path call that proves the wire-up), then typecheck once. Do not run
`pnpm action …` for every method unless a smoke test failed and you need to
isolate which action broke.

## CRUD + Drizzle

Before hunting through `node_modules` for DB helpers, read the app's schema map
when it exists:

1. `server/db/schema.ts` or `drizzle/schema.ts` — where tables live + migrate commands
2. `drizzle/crud-action-example.ts` or `server/db/crud-action-example.ts` — copy-paste list/create/update/delete pattern

DB client: `getDb` / `schema` from `server/db/index.ts` or `server/db.ts`.

## Custom `/api/` Routes

Complete exception list — justified only when the caller isn't your own UI/agent, or the payload isn't JSON: **file uploads** (actions take JSON, not multipart), **streaming** (SSE/chunked needing direct H3 control), **webhooks**, **OAuth callbacks** (fixed redirect URL patterns), **public unauthenticated endpoints** (SEO/OG images, share links), **binary/non-JSON responses**.

Everything else — CRUD, settings, search, list/detail reads, auth state, anything the UI fetches as JSON — is an action. Needing middleware to scope a route to the current user is itself a signal it should be an action. First-party templates still carry a shrinking, grandfathered set of older `/api/*` CRUD routes (`guard:no-action-twin-routes` ratchets it down) — not license to add new ones.

## Do / Don't

- **Do** keep one action, one job; document a reusable action (when to use it, key args, return fields to preserve) in `AGENTS.md` once it's called from outside one narrow screen; promote workflow-heavy actions (provider-backed, cross-app, MCP/A2A, multi-step) into a skill.
- **Do** use `fail()` for user-friendly errors and import primitives from `@agent-native/core`(`/action`) instead of redefining them; use the core `upload-image` action or `uploadFile()` for durable images/files — never base64 into SQL, markdown, or action results.
- **Don't** re-export actions as REST — `/_agent-native/actions/:name` is already the REST surface; duplicating it under `/api/*` hides the operation from agents.
- **Don't** reach for provider integrations, `outputSchema`, `authorize`, `needsApproval`, or `_agentImages` without checking `references/` first — each has sharp edges covered there, not here.

## Troubleshooting

- **Action not found** — filename must match the command (`pnpm action foo-bar` → `actions/foo-bar.ts`).
- **Args not parsing** — use `--key value` / `--key=value`; boolean flags are `--flag` (sets `"true"`).
- **Frontend 405** — `http.method` doesn't match the hook (`useActionQuery` for GET, `useActionMutation` for POST/PUT/DELETE).
- **Frontend gets undefined** — action must return structured data, not `JSON.stringify()`.

## References

- `references/provider-apis.md` — wiring a credentialed provider (HubSpot, Gong, Slack, …) for querying, reporting, or cross-source research.
- `references/action-fields.md` — `outputSchema`, `authorize`, `needsApproval`, `_agentImages`, and exact auto-refresh rules.
- `references/examples.md` — a second worked example, the legacy `parameters`/bare-export patterns, and `pnpm actions:audit`.

## Related Skills

- **storing-data** — Actions read/write data in SQL
- **delegate-to-agent** — The agent invokes actions via `pnpm action <name>`
- **real-time-sync** — Database writes from actions trigger change events to update the UI
- **adding-a-feature** — Actions are area 2 of the four-area checklist
- **client-methods** — Client code uses named helpers/hooks instead of raw REST calls
