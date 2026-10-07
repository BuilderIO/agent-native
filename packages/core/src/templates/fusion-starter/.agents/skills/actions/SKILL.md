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

An action may call a provider API, validate data, and persist records without being an AI feature — keep it deterministic, focused, and independently useful to the agent. Don't put LLM calls or a second model runtime in app actions.

When a workflow is research, analysis, generation, recommendation, or synthesis — or spans several provider calls and writes — route it to the AgentSidebar via `sendToAgentChat({ openSidebar: true })` and let the agent orchestrate focused actions instead of hiding an AI-shaped workflow behind one opaque `generate-*`/`create-*` action just because its implementation happens to be deterministic.

## How to Create an Action

**One action per file, default-exported. The filename is the action name** (kebab-case): `actions/list-meals.ts` is the `list-meals` action. Don't put several `defineAction`s as named exports in one file — the registry keys actions by filename and only the default export is registered, so extra named exports never become callable and won't match `.generated/action-types.d.ts`.

```ts
// actions/list-meals.ts
import { z } from "zod";
import { defineAction } from "@agent-native/core/action";
import { getDb } from "../server/db/index.js";
import { meals } from "../server/db/schema.js";

export default defineAction({
  description: "List all meals",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const db = getDb();
    const rows = await db.select().from(meals);
    return rows; // Return objects/arrays, NOT JSON.stringify()
  },
});
```

`schema` (Zod or Standard Schema-compatible) gives runtime validation, TS inference for `run()` args, and an auto-generated JSON Schema for the tool. Write it so an agent can call the tool correctly on the first try: `.describe()` every param and state enum values and the default in that text (`z.enum(["open","closed"]).default("open").describe('Filter status: "open" or "closed"; defaults to "open"')`); mark a field `.optional()` only when the action truly tolerates its absence — a silent default the caller cannot see is a required field in disguise; name the primary id the same way across a family (`create-/get-/update-/delete-<thing>` all take `id`, not a mix of `id` and `<thing>Id`), and if one action must differ, accept both with `.or()`; give nested objects a real schema, never a prose description; keep the one-line `description` complete enough to call the tool without a second lookup, because compact catalogs and `tool-search` show only that line. Use `z.coerce.number()` for numeric HTTP params, but write an explicit boolean parser instead of `z.coerce.boolean()`, which treats `"false"` as truthy.

Use Drizzle's PostgreSQL query builder, not raw SQL/`getDbExec()` or direct driver imports, unless Drizzle can't express the query. Never hardcode API keys/tokens/secrets - read via `readAppSecret` / `resolveCredential` / OAuth helpers; `process.env` is deploy-level config only.

**Decision order:** existing action → extend/create a `defineAction` → custom route as last resort (*Custom `/api/` Routes* below). Actions are already callable by agents, CLIs, hooks, HTTP, and MCP/A2A — don't wrap them in an umbrella REST API.

## Keep the Action Surface Small and Orthogonal

Every agent-exposed action is a tool in the model's context window; more tools degrades tool-selection quality. Add the fewest, most orthogonal actions that cover the capability.

- **One orthogonal `update` per resource**, not one per field — `update-<thing>` taking an optional-fields patch, not `update-<thing>-name` + `update-<thing>-order` + …
- **Reach for a generic escape hatch before minting a new read action** — the `provider-api-catalog`/`docs`/`request` trio for provider data (`references/provider-apis.md`), `db-query` for ad hoc app-data reads in dev.
- **`agentTool: false`** hides a UI-only/programmatic action from the model while keeping it frontend/HTTP-callable — not `toolCallable: false`, which only blocks the sandboxed extension bridge and leaves the action visible everywhere else; reserve that one for high-blast-radius operations.
- **Delete or hide stale actions** once you confirm neither the UI nor an agent workflow uses them.

## Key Actions — One Index, Every Surface

Document the app's primary actions in the `AGENTS.md` action table. For first-turn loading, add those action names to the plugin's `initialToolNames` (`INITIAL_TOOL_NAMES` in some templates), or mark the full starter set `deferLoading: false` on the actions. When one action opts into per-action eager loading, unmarked actions are deferred; the remaining actions stay discoverable through `tool-search`.

When MCP is enabled, its `Key tools` line is generated from `mcp.keyToolNames ?? initialToolNames` and filtered to the actions served on that surface. A configured `mcp.keyToolNames` overrides the advertised MCP/WebMCP key list; it does not change the in-app agent's first-turn list. Keep the advertised subset consistent with the primary actions in the `AGENTS.md` table and the external catalog; the table may also document other in-app actions. Do not hand-write another action list in `mcp.instructions`, a skill, or an external skill; describe when to use actions there.

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

A create/update result is read by more than the caller. These keys are well-known and survive result truncation:

- `id` — the created or updated record. Pair it with a pure, synchronous `link` builder on the action (`link: (result) => ({ url: buildDeepLink({ app, view, params: { id: result.id } }), label })`) so MCP hosts and the desktop app surface an "Open …" deep link that lands in the editing view focused on the record; returning `url`/`urlPath` in the result works too.
- `nextRequiredAction` — the name of the next **tool** to call when the operation is one step of a flow the agent should keep driving (`nextRequiredAction: "update-slide"`). Never phrase it as waiting for the user: an MCP/WebMCP/A2A caller cannot receive an in-app answer. The agent loop keeps this field in continuation prompts even when the rest of a large result is dropped, and MCP callers see it as `Next: …`.
- `message`/`summary` — the one-line status external callers read; everything else stays in the structured result.
- `designSystem` — when a record can link a brand or design system, expose it as `designSystem: AgentDesignSystemContext | null` via `loadAgentDesignSystemContext(id, getDesignSystemAction)` from core's shared `design-system-agent-context`. Reads get the bounded summary (`scope: "summary"`, with a `next` line naming the full read); only the create action and `get-design-system` itself pass `{ full: true }`. `status: "unavailable"` is not `null`: keep the id and the message. Print it in text results with `formatAgentDesignSystemContext`; do not name the field anything else.

For actions that attach a `chatUI` renderer, use `chatUI.projectResult` to return
only the small structured fields the renderer needs. `chatUI.when` is evaluated
against the full successful result first; the projection is used live and saved
for interrupted-run recovery.

An action that hands control back to the user (question form, intake dialog) sets `endsTurn: true`; that hides it from MCP/WebMCP/A2A unless `mcpTool: true` is explicit — `references/action-fields.md`. For external-agent integrations, use the external-agents documentation slug listed by `agent-native-docs`.

Reach for `outputSchema` (validate the return), `_agentImages` (attach images the agent can see), `authorize` (gate who may call it), or `needsApproval` (require human sign-off per call) only when the action needs that guarantee — examples in `references/action-fields.md`.

### Write receipts

A write action that can check its own effect returns a plain-object result with a reserved `_receipt`, so the final answer is reconciled with what the write did, not with the model's reading of a JSON string that may be truncated:

```ts
import type { WriteReceipt } from "@agent-native/core/action";

const _receipt: WriteReceipt = {
  changed: true,
  verified: false,
  summary: "Saved; panel 3 returned no rows.",
  checks: [{ id: "panel-3", ok: false, detail: "0 rows" }],
};
return { id, _receipt };
```

`verified` is `true` (the effect was observed), `false` (checked and did not hold), or `"unverified"` (could not be checked); `checks` and `warnings` are optional. The agent loop reads the receipt before the result is stringified and truncated (summary 200 chars, 8 checks, 5 warnings):

- `verified: false` or `changed: false` forces one honest-reconciliation retry per turn: the model must say what the receipt shows and may not call the change visible or working. If the retry is spent, the answer is prefixed with the receipt block.
- `verified: "unverified"` only prefixes that note; no retry.
- A receipt that is present but malformed counts as `unverified`, never clean. `changed: false` also records the call as `completedSideEffect: false`.
- Set `subject` (the stable target, such as a dashboard id) so a later `changed: true, verified: true` receipt for the same subject can supersede an earlier flagged one in the same turn. When the earlier receipt had failing or unverified `checks`, the later receipts (from this action or another that writes the same subject) must carry an `ok: true` check with the same `id` for each; a receipt without checks never clears one that had them. A flagged receipt with no failing checks is superseded only by the same action. Receipts without a `subject` are never superseded.

A receipt is not an error channel. A write that did not achieve the requested state throws (`fail()`); return `changed: false` only for a benign no-op, such as the record already being in the requested state.

## Frontend Hooks

Import from focused `@agent-native/core/client/*` entry points; the broad
`@agent-native/core/client` barrel is deprecated. Use action hooks, not
hand-written `fetch("/_agent-native/actions/...")`.

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
pnpm action log-meal --name "Salad" --calories 350
```

CLI flags become action input fields (`--key value` or `--key=value`); the runner does not read or write files for `--input` or `--output`. The default template dispatches through core's `runScript()` in `actions/run.ts`. Action names are lowercase-with-hyphens (`pnpm action my-action` → `actions/my-action.ts`).

After adding or changing several related actions, smoke-test **once** (one
happy-path call that proves the wire-up), then typecheck once. Do not run
`pnpm action …` for every method unless a smoke test failed and you need to
isolate which action broke.

## CRUD + Drizzle in this starter

Before hunting through `node_modules` for DB helpers, read:

1. `drizzle/START_HERE.md` — where tables live + migrate commands
2. `drizzle/crud-action-example.ts` — copy-paste list/create/update/delete pattern

DB client: `getDb` / `schema` from `server/db.ts`.

## Custom `/api/` Routes

Complete exception list — justified only when the caller isn't your own UI/agent, or the payload isn't JSON: **file uploads** (actions take JSON, not multipart), **streaming** (SSE/chunked needing direct H3 control), **webhooks**, **OAuth callbacks** (fixed redirect URL patterns), **public unauthenticated endpoints** (SEO/OG images, share links), **binary/non-JSON responses**.

Everything else — CRUD, settings, search, list/detail reads, auth state, anything the UI fetches as JSON — is an action. Needing middleware to scope a route to the current user is itself a signal it should be an action. Existing template `/api/*` CRUD routes are being migrated; do not add new ones.

## Do / Don't

- **Do** keep one action, one job; document a reusable action (when to use it, key args, return fields to preserve) in `AGENTS.md` once it's called from outside one narrow screen; promote workflow-heavy actions (provider-backed, cross-app, MCP/A2A, multi-step) into a skill.
- **Do** use `fail(message, { errorCode, statusCode })` for user-friendly errors and import primitives from `@agent-native/core`(`/action`) instead of redefining them; use the core `upload-image` action or `uploadFile()` for durable images/files — never base64 into SQL, markdown, or action results.
- **Do** signal failure by throwing, using `fail()` for expected caller-readable failures. Never return `{ error: ... }` as a failure result: a normal return is treated as a successful action. Reserve bare errors for unexpected internal faults.
- **Do** use `fail()` rather than a bare `Error` for caller-readable failures. It carries the action's message, `errorCode`, and `details` to the browser; unexpected errors become a generic 500. Reserve bare throws for internal faults.
- **Do** give `fail()` the status that matches the cause: it defaults to `400`, and `useActionQuery` retries only `429`, `502`, `503`, and `504`. Mutations do not retry; use transient statuses only for retryable failures.
- **Do** render `actionErrorMessage(error) ?? yourCopy` in UI, never bare `error.message`. The message keeps an `Action <name> failed:` prefix that belongs in a console, so a toast built from it reads "Action update-brand-kit failed: That name is taken." The helper returns only what the action wrote, and `undefined` when nothing did (network drop, proxy HTML page), which is why the fallback is not optional.
- **Do** pass a real `errorCode` when the agent should branch on the failure rather than re-read it. Codes other than the default `action_failed` are appended to the tool result as `(errorCode: not_found)`, on both the in-app agent and MCP; `details` and the status never reach either.
- **Don't** re-export actions as REST — `/_agent-native/actions/:name` is already the REST surface; duplicating it under `/api/*` hides the operation from agents.
- **Don't** reach for provider integrations, `outputSchema`, `authorize`, `needsApproval`, or `_agentImages` without checking `references/` first — each has sharp edges covered there, not here.

## Troubleshooting

- **Action not found / type mismatch** — filename must match the command (`pnpm action foo-bar` → `actions/foo-bar.ts`), and the action must be the file's **default** export. Multiple `defineAction` named exports in one file register only the default; split them into one file each.
- **Args not parsing** — use `--key value` / `--key=value`; boolean flags are `--flag` (sets `"true"`).
- **Frontend 405** — `http.method` doesn't match the hook (`useActionQuery` for GET, `useActionMutation` for POST/PUT/DELETE).
- **Frontend gets undefined** — action must return structured data, not `JSON.stringify()`.

## References

- `references/provider-apis.md` — wiring a credentialed provider (HubSpot, Gong, Slack, …) for querying, reporting, or cross-source research.
- `references/action-fields.md` — `outputSchema`, `authorize`, `needsApproval`, `_agentImages`, and exact auto-refresh rules.
- `references/examples.md` — a second worked example and legacy bare-export patterns.

## Related Skills

- **storing-data** — Actions read/write data in SQL
- **delegate-to-agent** — The agent invokes actions via `pnpm action <name>`
- **real-time-sync** — Database writes from actions trigger change events to update the UI
- **adding-a-feature** — Actions are area 2 of the four-area checklist
- **client-methods** — Client code uses named helpers/hooks instead of raw REST calls
