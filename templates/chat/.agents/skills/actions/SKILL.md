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

Actions in `actions/` are the **single source of truth** for app operations. The agent calls them as tools, and the frontend calls them through `useActionQuery` / `useActionMutation`. The framework owns the HTTP transport behind those hooks. No duplicate `/api/` routes needed.

Before creating any custom REST/API route for app data, inspect `actions/` and the action table in `AGENTS.md`. If an action already exists, call it directly from the agent or with `useActionQuery` / `useActionMutation` from the UI. If the capability is missing, create or update a `defineAction`. Do not add `/api/*`, `server/routes/*`, or other pass-through endpoints whose main job is to call, repackage, or re-export an action.

## Why

Actions give the agent callable tools with structured input/output, AND they give the frontend a typed client contract through hooks. One implementation serves both the agent and the UI. They keep the agent's chat context clean, they're reusable, and they can be tested independently.

## Keep the Action Surface Small and Orthogonal

Every agent-exposed action is a tool in the model's context window. There is a real cost to each one: more tools means more for the model to read, disambiguate, and choose between, which degrades tool-selection quality. Treat the action list like an API you have to maintain — add the fewest, most orthogonal actions that cover the capability, not one per UI affordance.

- **Prefer one CRUD-style `update` over N per-field actions.** A single `update-<thing>` that takes a patch of optional fields beats `update-<thing>-name`, `update-<thing>-order`, `update-<thing>-color`, … The agent (and the UI) pass only the fields that change. Same for `create`/`delete` — one orthogonal action per resource, not one per code path.
- **Reach for a generic query / escape hatch before minting a new read action.** If the agent needs more or different data, do not add `get-<thing>-by-x`, `list-<thing>-filtered-by-y`, etc. For provider data, expose the shared `provider-api-catalog` / `provider-api-docs` / `provider-api-request` trio (see `templates/dispatch/actions/`) so the agent can hit any endpoint or filter without a new action each time. For app data in dev, the `db-query` tool already answers arbitrary read questions.
- **Hide UI-only or purely programmatic actions from the model with `agentTool: false`.** An action that only the frontend or an HTTP/cron caller needs should not spend a slot in the model's tool list. `agentTool: false` keeps it callable from `useActionMutation` / `callAction` / `/_agent-native/actions/<name>` while removing it from every agent tool surface (in-app assistant, MCP, A2A).
- **`agentTool: false` is NOT `toolCallable: false`.** They are different switches:
  - `agentTool: false` → hidden from the **model entirely** (it is no longer a tool the agent can see or call). Still frontend/HTTP-callable.
  - `toolCallable: false` → only blocks the **sandboxed extension ("tools") iframe bridge** (`appAction(...)`). The action stays fully visible to the model, the UI, the CLI, MCP, and A2A. Use it for high-blast-radius operations (account/org/auth changes), not for trimming the tool list.
- **Remove or hide stale actions.** When the UI stops using an action, delete it or set `agentTool: false` — do not leave it exposed to the model as dead tool weight. The advisory audit below helps you spot these.

### Audit Script (Advisory)

`pnpm actions:audit [template ...]` (or `node scripts/audit-template-actions.mjs`) statically scans a template's `actions/` and prints two kinds of suggestions:

1. **Likely UI-dead** — HTTP-exposed mutating actions whose name is never referenced under `app/` (candidates to delete or mark `agentTool: false`).
2. **Likely redundant clusters** — groups like `update-foo-name` / `update-foo-order` that could collapse into one orthogonal `update-foo`.

It is **advisory only**: it always exits 0, never fails CI, and uses conservative heuristics, so expect some false positives (e.g. an action the agent calls but the UI doesn't). Use it as a prompt to review, not a gate.

## How to Create an Action

Use `defineAction` with a Zod schema (required for new actions):

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

The `schema` field accepts a Zod schema (or any Standard Schema-compatible library). It provides runtime validation with clear error messages (400 for HTTP, error result for agent), full TypeScript type inference for `run()` args, and auto-generated JSON Schema for the agent's tool definition. `zod` is a dependency of all templates.

When an action reads or writes app data, use Drizzle's query builder and portable operators from `drizzle-orm`. Do not use raw SQL, `getDbExec()`, or dialect-specific schema imports in normal actions unless there is a documented reason Drizzle cannot express the query.

When an action calls an external service, never hardcode API keys, bearer
tokens, webhook URLs, signing secrets, OAuth refresh tokens, private
Builder/internal data, or customer data. Read user/org/workspace credentials
from `readAppSecret`, `resolveCredential`, OAuth token helpers, or the provider
API credential adapter. Use `process.env` only for explicitly deploy-level
configuration, and keep examples to obvious placeholders.

Tips:
- Use `.describe()` for parameter descriptions
- Use `.optional()` for optional params
- Use `z.coerce.number()` for numeric params that arrive as strings from HTTP.
  For booleans, use an explicit string parser/helper instead of
  `z.coerce.boolean()` because JavaScript treats any non-empty string,
  including `"false"`, as truthy.
- Use `z.enum(["draft", "published"])` for constrained values

The legacy `parameters` field (plain JSON Schema object) still works as a fallback but does not provide runtime validation or type inference.

## Decision Order

When you need app data or a mutation:

1. **Use an existing action** if one already performs the operation.
2. **Create or extend a `defineAction`** when the agent and UI both need a new operation.
3. **Create a custom route only for route-only concerns** such as uploads, streaming, webhooks, OAuth callbacks, or a non-JSON protocol.

Do not build an umbrella REST API to make actions "easier" to call. Actions are already callable by agents, CLIs, React hooks, HTTP, MCP/A2A exposure, and external hosts through the framework.

## Flexible Provider APIs

For provider integrations used in ad hoc analysis, querying, reporting, or
cross-source research, do not hardcode every provider endpoint as a separate
rigid action and do not encode one lookback window, filter shape, or pagination
strategy as the only path the agent can take. Expose the shared provider API
action trio instead:

- `provider-api-catalog`: lists provider base URLs, auth style, credential keys,
  docs/spec URLs, placeholders, and examples without exposing secrets.
- `provider-api-docs`: fetches public provider docs/spec/changelog URLs when
  the exact endpoint, filter operator, payload shape, or pagination contract is
  uncertain. Registered docs URLs are curated starting points. Use
  `responseMode: "markdown"` for clean readable docs, or
  `responseMode: "matches"` with `search: { query | terms | regex }` for
  compact snippets instead of flooding context with raw HTML.
- `provider-api-request`: makes a constrained authenticated HTTP request to the
  provider host, injects configured credentials, blocks private/internal URLs,
  and redacts secrets.

Use `@agent-native/core/provider-api` as the shared substrate. A template should
only add a thin credential adapter when it has app-specific credential lookup
rules. If the app stores a built-in provider's OAuth grant under a narrower
local provider id, use the runtime's `oauthProviderOverrides` instead of
duplicating the provider config. If credentials are stored on shareable/resource
rows rather than in the shared credential or OAuth-token stores, build a resolver
that enforces those access checks before exposing raw provider requests. Keep
`provider-api-request` `http: false` unless you have a separate UI permission
model for arbitrary provider writes. Specific actions such as `search-records`,
`search-emails`, or `sync-source` are convenience shortcuts, not capability
limits; agents should fall back to the provider API trio when a question
requires an endpoint or filter that the shortcut does not model.

This is a framework tenet. The safety boundary should be provider host
allow-listing, credential scoping, auth injection, private-network blocking,
secret redaction, and user/org access checks, not an artificially small set of
hand-authored read actions. If the upstream provider API supports a capability,
the agent should normally be able to reach it through `provider-api-request`
with the user's configured credentials. For large responses, expose staging
(`stageAs`, `itemsPath`, pagination, and `query-staged-dataset`) or sandboxed
code execution so the agent can reduce data without flooding context.

For broad provider questions, cross-source joins, corpus-wide mention/search
work, classification, or any answer where absence matters, design the action
surface for full coverage instead of convenience-only samples. The agent should
be able to fetch every relevant page or an explicitly bounded cohort, stage or
save the raw provider response outside chat, and then use
`query-staged-dataset`, `run-code`, or provider-side search to count, join,
grep, classify, and aggregate. Tool descriptions and AGENTS.md guidance should
teach agents to report source, filters, time window, row/record counts,
pagination status, truncation, failed pages, and uncovered gaps. They must not
turn default limits, sampled rows, truncated excerpts, or aborted calls into a
confident "none found", "all records", or exhaustive conclusion.

For public web pages and docs, prefer the token-efficient path: `web-search`
to find likely URLs, `web-request` or `provider-api-docs` with clean
`responseMode` output to read a page, and `run-code` with `webRead()` /
`webFetch()` when you need to grep, aggregate, or compare many pages before
returning a small result.

For LONG compute, `run-code` supports durable background executions: pass
`background: true` and the code is enqueued to a `sandbox_executions` row and
executed out-of-band with a generous budget (default 10 min), surviving the
hosted agent run's ~40s soft timeout. The call returns
`{ executionId, status: "queued" }` immediately with polling guidance; check
progress with `run-code` `{ executionId }` (or the `get-code-execution` tool
where registered) — results persist after completion. Use background for big
cross-source joins, multi-page provider sweeps, and heavy analysis scripts;
keep quick scripts in the default foreground mode. Agents should continue
other work between polls, and on `failed`/`timed_out` split the computation or
persist intermediate progress with `workspaceWrite` and re-run.

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

The framework auto-refreshes the UI after any successful mutating action. On completion of a non-`GET` action, the framework emits a change event with `source: "action"` that the client's `useDbSync` picks up and uses to invalidate `["action"]` React Query keys — so `list-*` / `get-*` hooks refetch without a full page reload. In-process calls emit directly; dev-mode `pnpm action ...` calls also write a durable marker so the web server sees child-process action changes.

Rules:

- `http: { method: "GET" }` → read-only, does NOT trigger a refresh (inferred automatically).
- Any other action (default `POST`, `PUT`, `DELETE`, or `http: false`) → treated as mutating, triggers a refresh on success.
- To override the inference on an unusual action (e.g. a `POST` that only reads), pass `readOnly: true` on the action definition.
- To let a mutating action run concurrently with other same-turn tool calls, pass `parallelSafe: true`. Only do this when the action is internally concurrency-safe and order-independent (for example, it uses an app-level lock or idempotent upsert semantics). Mutating actions remain serialized by default.

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

### Returning Images the Agent Can See (`_agentImages`)

An action's return object may include the well-known optional field
`_agentImages` to attach vision images (screenshots, chart previews, rendered
designs) to the tool result. The agent literally sees them — enabling visual
self-review loops — while the field itself is stripped from the JSON text the
model reads.

```ts
run: async ({ dashboardId }) => {
  const shot = await renderDashboardPng(dashboardId); // Buffer
  return {
    dashboardId,
    panelCount: 6,
    _agentImages: [
      // Either a public https URL (preferred — the provider fetches it)…
      { url: "https://cdn.example.com/previews/dash-1.png", label: "overview" },
      // …or base64 without a data: prefix (mediaType required; a full
      // data:image/png;base64,… URL in `data` is also accepted and parsed).
      { data: shot.toString("base64"), mediaType: "image/png" },
    ],
  };
},
```

Rules and limits:

- Shape: `Array<{ url?: string; data?: string; mediaType?: string; label?: string }>`.
  Each entry needs `url` (https only) **or** `data`. Supported media types:
  `image/jpeg`, `image/png`, `image/gif`, `image/webp`.
- Caps: max **4 images** per result; max **~2MB of base64** per image.
  Over-cap or invalid entries never fail the call — they become text notes in
  the result telling the model what was dropped and why.
- Persistence: the run ledger stores only the string result plus compact
  `[image: …]` notes (URLs verbatim; base64 as a byte-count placeholder) —
  never the payload. Images are re-attached only for the live turn; replayed
  history is text-only, so prefer stable `url` images the model can re-request.
- Engine support: native Anthropic and vision-capable AI-SDK providers
  (anthropic, openai, google, openrouter) receive real image blocks; other
  paths (Builder gateway, non-vision providers) degrade to the text notes.
- External MCP tools need no changes — standard MCP `image` content parts are
  converted automatically under the same caps.

### Validating Return Values (`outputSchema`)

`schema` validates inputs; `outputSchema` validates what the action **returns**. Pass any Standard Schema-compatible schema (Zod, Valibot, ArkType) and the framework validates the result _after_ `run()` resolves — input validated before `run`, output after.

```ts
export default defineAction({
  description: "Summarize a thread.",
  schema: z.object({ threadId: z.string() }),
  outputSchema: z.object({ summary: z.string(), messageCount: z.number() }),
  outputErrorStrategy: "warn", // default; "strict" | "fallback"
  // outputFallback: { summary: "", messageCount: 0 }, // used only by "fallback"
  run: async ({ threadId }) => {
    /* ... */
  },
});
```

- `"warn"` (default) — `console.warn` the issues and return the **original** result unchanged. Non-breaking.
- `"strict"` — throw a clear error so a buggy action surfaces loudly.
- `"fallback"` — return `outputFallback` in place of the invalid result.

On success the validated value is returned, so coercion/defaults on `outputSchema` apply. Omit `outputSchema` and behavior is byte-for-byte unchanged (no wrapping).

### Human-in-the-Loop Approval (`needsApproval`)

For high-consequence, outward-facing, hard-to-undo actions (sending an email, charging a card, deleting an account), set `needsApproval` so the agent **cannot** run the action without a human approving the specific call:

```ts
export default defineAction({
  description: "Send an email via Gmail.",
  schema: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
  needsApproval: true, // boolean, or (args, ctx) => boolean | Promise<boolean>
  run: async (args) => {
    /* ...actually send... */
  },
});
```

When the gate is truthy and the call isn't yet approved, the loop emits an `approval_required` event and **stops the turn — `run()` never executes**. A predicate gates conditionally (e.g. only external recipients) and **fails closed**: a throw is treated as "approval required". The human approves via the chat UI's Approve affordance, which re-issues the turn with the call's `approvalKey`, and only then does the action run.

**Keep approvals rare** — the default is off and almost every action should leave it off. The canonical example is Mail's `send-email` (`needsApproval: true`). See the `security` skill and the Human Approval doc.

## Frontend Hooks

The frontend calls actions using React Query hooks from `@agent-native/core/client`. Components should not hand-write `fetch("/_agent-native/actions/...")`; add or reuse a client hook/helper instead. Use `callAction` from the same package for imperative cases that do not fit a hook, such as debounced search, prefetching, or non-React event handlers.

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

### `callAction` — for imperative client code

```ts
import { callAction } from "@agent-native/core/client";

const people = await callAction("search-people", { query }, { method: "GET" });
```

Prefer hooks in React data flows. Use `callAction` when a hook would be awkward;
do not hand-write action route fetches in components.

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

When the agent needs a durable image or file URL, call the core `upload-image`
action or use `uploadFile()` in server code. Do not write base64 into SQL,
markdown, deck/design JSON, or action results. `_agentImages` on action results
is for ephemeral vision previews only, not persistence.

If it's a standard CRUD operation, data query, or a wrapper around an action, use the action instead.

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
- **Use `agentTool: false`** for UI-only / programmatic actions that should NOT be a tool in the model's context window. It stays frontend/HTTP-callable but is hidden from the agent. Distinct from `toolCallable: false`, which only blocks the sandboxed extension iframe bridge.
- **Document reusable actions.** If a new action should be called by agents outside one narrow screen, update `AGENTS.md` with when to use it, important args, and which return fields to preserve.
- **Promote workflow-heavy actions to skills.** If the action is part of a provider-backed, cross-app, MCP/A2A, or multi-step workflow, create or update a skill in `.agents/skills/` and add app-skill visibility (`internal`, `exported`, or `both`) when it should ship through a marketplace.
- **Use `loadEnv()`** only for deploy-level configuration. User/org/workspace
  credentials belong in the encrypted secrets/credential/OAuth stores, never as
  hardcoded literals or shared env fallbacks.
- **Use `fail()`** for user-friendly error messages (exits with message, no stack trace).
- **Import action primitives from `@agent-native/core/action`** and CLI helpers such as `parseArgs()` from `@agent-native/core` — do not redefine framework utilities locally.
- **Do not re-export actions as REST.** The mounted `/_agent-native/actions/:name` endpoint is the REST surface; duplicating it under `/api/*` creates drift and hides the operation from agents.

## Common Patterns

**Read action (GET):**

```ts
import { z } from "zod";
import { defineAction } from "@agent-native/core/action";

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
import { defineAction } from "@agent-native/core/action";

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
import { defineAction } from "@agent-native/core/action";

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
- **real-time-sync** — Database writes from actions trigger change events to update the UI
- **adding-a-feature** — Actions are area 2 of the four-area checklist
- **client-methods** — Client code uses named helpers/hooks instead of raw REST calls
