---
title: "Actions"
description: "defineAction — the single definition that becomes an agent tool, typed frontend hooks, framework transport, an MCP tool, and a CLI command."
---

# Actions

Actions are the single source of truth for anything your app does. Define an action once with `defineAction()`, drop it in `actions/`, and it's immediately available as:

- **An agent tool** — the agent sees it with a zod-derived JSON Schema and can call it in chat.
- **Typesafe React hooks** — `useActionQuery("name")` and `useActionMutation("name")` on the frontend, types inferred from the schema.
- **Imperative client calls** — `callAction("name", params)` when a hook does not fit.
- **Framework transport** — auto-mounted by the framework behind those hooks and available to external HTTP clients.
- **An MCP tool** — exposed to Claude, ChatGPT custom MCP apps, Claude Desktop/Code, Cursor, Codex, and any other MCP client.
- **An A2A tool** — called by other agent-native apps over A2A.
- **A CLI command** — `pnpm action <name>` for scripting and dev loops.

One definition, seven consumers. This is rung 3 of the [ladder](/docs/what-is-agent-native#the-ladder).

## Defining an action {#defining}

```ts
// actions/reply-to-email.ts
import { defineAction } from "@agent-native/core";
import { z } from "zod";

export default defineAction({
  description: "Reply to an email thread in the user's voice.",
  schema: z.object({
    emailId: z.string().describe("The id of the email to reply to."),
    body: z.string().describe("The reply body, in markdown."),
  }),
  run: async ({ emailId, body }) => {
    await db.insert(replies).values({ emailId, body });
    return { ok: true, emailId };
  },
});
```

That's it. The framework auto-discovers every file in `actions/` and mounts them on startup.

### Schema options {#schemas}

`schema` accepts any [Standard Schema](https://standardschema.dev)-compatible library:

- **Zod** (v4) — most common, best type inference, auto-converts to JSON Schema.
- **Valibot** — minimal bundle size if that matters.
- **ArkType** — if you like the syntax.

The schema is converted to JSON Schema for the Claude API tool definition, _and_ used at runtime to validate inputs before `run()` fires. Invalid inputs never reach your handler.

### HTTP config {#http}

By default every action is exposed as `POST /_agent-native/actions/<name>`. Override with the `http` option:

```ts
export default defineAction({
  description: "Get details for a lead.",
  schema: z.object({ leadId: z.string() }),
  http: { method: "GET" },
  run: async ({ leadId }) => {
    return await db.select().from(leads).where(eq(leads.id, leadId));
  },
});
```

For a `GET` action, `leadId` is passed as a query param: `/_agent-native/actions/get-lead?leadId=abc`.

- **`http: { method: "GET" | "POST" | "PUT" | "DELETE" }`** — default `POST`. `GET` actions are auto-marked `readOnly` so successful calls don't trigger a UI poll-refresh.
- **`http: { path: "..." }`** — override the mounted URL under `/_agent-native/actions/`. Defaults to the filename. **Path overrides change the URL only for direct HTTP callers** — `useActionQuery`, `useActionMutation`, and `callAction` always call `/_agent-native/actions/<name>` regardless of this override, so overriding the path makes those hooks 404. Use path overrides only for external HTTP callers. Note also that `:param` route segments in the override path are **not** parsed into `run()` args — only query-string params and JSON body fields are.
- **`http: false`** — disable the HTTP endpoint entirely. Agent + CLI only.
- **`readOnly: true`** — explicitly skip the poll-refresh even for POST actions that don't mutate.
- **`parallelSafe: true`** — allow a mutating action to run concurrently with other same-turn tool calls. Only set this when the action is internally concurrency-safe and order-independent; mutating actions serialize by default.

### Keep the action surface small {#small-surface}

Every action the agent can see is a tool in the model's context window, and a long, overlapping tool list degrades the model's tool-selection quality. Design the action surface like an API you maintain, not one action per UI affordance:

- Prefer **one CRUD-style `update`** that takes a patch of optional fields over N per-field actions (`update-name`, `update-order`, `update-color`, …). The caller sends only what changed.
- Before adding a new read action per query/filter, reach for a generic escape hatch: the [provider API trio](/docs/template-dispatch) (`provider-api-catalog` / `provider-api-docs` / `provider-api-request`) for provider data, or the dev `db-query` tool for app data.
- Mark UI-only or programmatic actions [`agentTool: false`](#agent-tool) so they stay frontend/HTTP-callable without spending a slot in the model's tool list.
- Delete or hide actions the UI no longer uses instead of leaving them exposed to the model.

A repo-level advisory helper, `node scripts/audit-template-actions.mjs [template ...]` (alias `pnpm actions:audit`), statically scans a template's `actions/` and flags likely UI-dead actions and redundant per-field clusters. It is advisory only (always exits 0, never fails CI) and uses conservative heuristics, so review its suggestions rather than treating them as errors.

### Agent tool exposure {#agent-tool}

By default every action is exposed to the agent — the in-app assistant plus the app's MCP / A2A tool surfaces — as a callable tool. For an action that only the frontend (or an HTTP / cron caller) needs, set `agentTool: false` to keep it behind the framework's auth + action surface while removing it from every agent tool list:

```ts
export default defineAction({
  description: "Persist the user's sidebar width.",
  agentTool: false, // UI-only — not a tool in the model's context window
  schema: z.object({ widthPx: z.number() }),
  http: { method: "PUT" },
  run: async ({ widthPx }) => {
    /* ... */
  },
});
```

| Value       | Behavior                                                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `true`      | Allow (same as undefined). Useful for documenting intent.                                                                                                                                  |
| `false`     | **Hidden from the model entirely** — not in the agent's tool list, MCP, or A2A. Still callable from the UI (`useActionMutation` / `callAction`), CLI, and `/_agent-native/actions/<name>`. |
| `undefined` | **Default-allow.** The action is a normal agent tool.                                                                                                                                      |

`agentTool: false` is **not** the same as [`toolCallable: false`](#tool-callable):

- **`agentTool: false`** removes the action from the **model's** view. The model can no longer see or call it; the UI and HTTP can.
- **`toolCallable: false`** only blocks the sandboxed **extension iframe bridge** (`appAction(...)`). The action stays fully visible to the model, UI, CLI, MCP, and A2A. It exists for high-blast-radius operations (account/org/auth changes), not for trimming the tool list.

Reach for `agentTool: false` when you find yourself adding a UI-only or purely programmatic action, or when the UI stops using an action you'd otherwise leave exposed to the model.

### Extension callability {#tool-callable}

Extensions (Alpine.js mini-apps that run inside sandboxed iframes — see [Extensions](/docs/extensions)) call actions via `appAction(name, params)`. Because a shared extension's HTML/JS executes inside the _viewer's_ session, an action invoked from an extension runs with the viewer's permissions, secrets, and SQL scope. For high-blast-radius operations, that is too much trust to grant by default.

Use the `toolCallable` flag to control this (the flag name is kept for backward compatibility — it gates extension iframe callability):

```ts
export default defineAction({
  description: "Delete the current user's account.",
  toolCallable: false, // never callable from an extension iframe
  schema: z.object({ confirm: z.literal("yes") }),
  run: async () => {
    /* ... */
  },
});
```

| Value       | Behavior                                                                                                                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `true`      | Allow (same as undefined). Useful for documentation of intent.                                                                                                                                                                                    |
| `false`     | Explicit deny. The extension bridge returns 403; the action is still callable normally from the UI, agent, CLI, MCP, and A2A.                                                                                                                     |
| `undefined` | **Default-allow.** Extensions are intra-org and typically authored by trusted teammates, so the default trusts the org-level access controls. Set `false` only for genuinely auth-adjacent operations (account deletion, org membership changes). |

Enforcement: the parent host tags every outbound action call from an extension iframe with the header `X-Agent-Native-Tool-Bridge: 1`. The action route layer reads this header and applies the rule above. Regular UI/agent/CLI/A2A calls do not carry the header and are unaffected. The header is set by the React host; the iframe's user-authored content cannot spoof it because the bridge sanitizes iframe-supplied headers.

Set `toolCallable: false` for actions that:

- delete or transfer ownership of any account/org,
- change auth state (sign-out-all sessions, rotate tokens),
- modify org membership (invite/remove members, change roles),
- change resource visibility or grant share access (the framework's built-in `share-resource`, `unshare-resource`, and `set-resource-visibility` are already opted out).

### Run context (second argument) {#run-context}

`run` receives an optional second argument, `ctx`, carrying the resolved request identity and the surface that invoked the action. Read it instead of calling `getRequestUserEmail()` / `getRequestOrgId()` by hand, and pass the whole `ctx` to tracking:

```ts
export default defineAction({
  description: "Log an audit entry for the current request.",
  schema: z.object({ event: z.string() }),
  run: async (args, ctx) => {
    // ctx is undefined-safe: a 1-arg `run(args)` is still valid.
    const actor = ctx?.userEmail ?? "system";
    if (ctx?.caller === "frontend") {
      // tighter rules for browser-initiated calls, looser for "tool"/"cli"
    }
    await db.insert(audit).values({
      actor,
      orgId: ctx?.orgId ?? null,
      source: ctx?.caller ?? "unknown",
      event: args.event,
    });
    return { ok: true };
  },
});
```

`ActionRunContext` fields:

| Field         | Type                    | Notes                                                                                                                                                           |
| ------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `userEmail`   | `string \| undefined`   | Resolved request user. **Never defaulted to a dev identity** — `undefined` when the request has no authenticated user. Apply your own fallback if you need one. |
| `orgId`       | `string \| null`        | Resolved org id, or `null` when the request has no org.                                                                                                         |
| `caller`      | `ActionCaller`          | How the action was invoked (see below).                                                                                                                         |
| `send`        | `(event) => void`       | Optional. Emit an SSE event to the client. Only present inside the agent tool loop (`caller: "tool"`); `undefined` elsewhere.                                   |
| `attachments` | `AgentChatAttachment[]` | Files, images, and pasted text blocks submitted with the current agent turn. Populated only when `caller: "tool"`; `undefined` on all other surfaces.           |

`caller` is the union `"tool" | "http" | "frontend" | "cli" | "mcp" | "a2a"`:

| `caller`     | Set when…                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `"tool"`     | The in-app agent loop, a sub-agent / agent team, or an A2A request (A2A drives the same agent loop, so its tool calls are `"tool"`). |
| `"frontend"` | A browser call via `useActionMutation` / `useActionQuery` / `callAction` (tagged with the `X-Agent-Native-Frontend: 1` header).      |
| `"http"`     | A bare programmatic `POST` / `GET` to `/_agent-native/actions/<name>` without the frontend marker.                                   |
| `"cli"`      | `pnpm action <name>` (the CLI runner).                                                                                               |
| `"mcp"`      | An external agent over the MCP `tools/call` endpoint.                                                                                |
| `"a2a"`      | Reserved for a future direct A2A action dispatch. Today A2A runs through the agent loop, so those calls are `"tool"`.                |

`run` stays backward compatible: existing 1-argument handlers and handlers that only destructure `{ send }` continue to work unchanged.

### Access control in actions {#access-control}

User-owned tables must scope reads through `accessFilter` and writes through `assertAccess` — the same helpers the framework's sharing system uses. Here is a complete, paste-ready example:

```ts
// actions/create-lead.ts
import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import * as schema from "../server/db/schema.js";

export default defineAction({
  description: "Create a lead in the CRM.",
  schema: z.object({ name: z.string(), company: z.string() }),
  run: async ({ name, company }, ctx) => {
    const db = getDb();
    await db.insert(schema.leads).values({
      id: crypto.randomUUID(),
      name,
      company,
      ownerEmail: ctx?.userEmail ?? "system",
    });
    return { ok: true };
  },
});
```

For list and read actions, use `accessFilter` to scope the query to the current user and org. For actions that update or delete a specific row, use `assertAccess` to confirm the caller is allowed before writing. See [Security](/docs/security#access-guards) and [Sharing](/docs/sharing) for the full helper API.

## Calling it from the UI {#ui}

Two hooks, both in `@agent-native/core/client`. Types are inferred from your `defineAction` schemas — no manual type declarations.

### `useActionMutation` {#use-action-mutation}

For actions that change state:

```tsx
import { useActionMutation } from "@agent-native/core/client";

const { mutate, isPending } = useActionMutation("reply-to-email");

<Button
  disabled={isPending}
  onClick={() => mutate({ emailId, body: "Thanks!" })}
>
  Send Reply
</Button>;
```

On success, the framework emits a change event with `source: "action"` so `useActionQuery` consumers and active query observers refetch automatically. See [Live Sync](/docs/key-concepts#polling-sync).

### `useActionQuery` {#use-action-query}

For read-only GET actions:

```ts
import { useActionQuery } from "@agent-native/core/client";

const { data, isLoading } = useActionQuery("get-lead", { leadId });
```

The query is cached under `["action", "get-lead", { leadId }]` and auto-invalidated on any mutating action that completes.

## Calling it from the CLI {#cli}

Every action is runnable via `pnpm action`:

```bash
pnpm action reply-to-email --emailId thread-123 --body "Thanks!"
```

Flags are parsed into the shape your schema expects. Useful for agent-dev loops, scripts, and cron.

## Calling it from another agent (A2A) {#a2a}

If your app is an [A2A](/docs/a2a-protocol) peer, other agent-native apps discover your actions automatically and can call them by name. Same-origin deploys skip JWT signing; cross-origin uses a shared `A2A_SECRET`.

## Exposing it over MCP {#mcp}

With MCP enabled, your actions show up in the framework's MCP server at `/_agent-native/mcp`. Stdio/code developer clients can see the full connected action surface. Chat-style app hosts, including OAuth MCP Apps callers and generic authenticated remote HTTP/static-token callers, get a compact catalog containing app-facing builtins (`open_app`, `list_apps`, `ask_app`, and app-only embed helpers); action-specific MCP App resources stay out of that catalog unless an action explicitly sets `mcpApp.compactCatalog: true`. `publicAgent.expose` is still the opt-in for safe read/ingest tools outside that compact app catalog. See [MCP Protocol](/docs/mcp-protocol).

For UI-capable MCP hosts, an action can also declare an optional MCP Apps resource via the `mcpApp` field (and a matching `link`) so capable hosts render the result inline. The pattern mirrors the focused link we already return for external agents: the action exposes the operation, `link` points at the route with the right URL or deep-link params, and the embed helper uses that same target as the inline app. When an action's `link` and `mcpApp` should point at the same route, use `embedRoute()` to build both from one pure path builder.

```ts
import { embedRoute } from "@agent-native/core";

export default defineAction({
  description: "Create an email draft for review.",
  schema: z.object({ body: z.string() }),
  run: async ({ body }) => ({ body }),
  ...embedRoute({
    title: "Review draft",
    openLabel: "Open in Mail",
    path: ({ result }) => ({
      label: "Open draft in Mail",
      url: "/_agent-native/open?app=mail&view=inbox",
    }),
  }),
});
```

Keep `link` as the fallback for CLI and non-UI MCP clients; it is also the embed's launch target. The embed bridge — the signed embed-start session, transplant vs. controlled-frame rendering, the `ui/*` host bridge, CSP, and height clamping — is owned by [External Agents](/docs/external-agents#mcp-app-bridge).

## Standard actions {#standard-actions}

Every template should include these two for [context awareness](/docs/context-awareness):

### view-screen {#view-screen}

Reads the current navigation state, fetches contextual data, and returns a snapshot of what the user sees. The agent calls this when it needs a fresh look at the screen.

```ts
// actions/view-screen.ts
import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description: "Read the current screen state for context.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const navigation = await readAppState("navigation");
    const screen: Record<string, unknown> = { navigation };

    if (navigation?.view === "inbox") {
      screen.emailList = await listEmailsForLabel(navigation.label);
    }

    return screen;
  },
});
```

### navigate {#navigate}

Writes a one-shot navigation command to application state. The UI reads it, navigates, and deletes the entry.

```ts
// actions/navigate.ts
import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description: "Navigate the user to a view.",
  schema: z.object({
    view: z.string(),
    threadId: z.string().optional(),
  }),
  run: async (args) => {
    await writeAppState("navigate", args);
    return { ok: true };
  },
});
```

## Legacy CLI-style actions {#legacy-cli-actions}

The framework still supports older `export default async function(args)` actions that aren't wrapped in `defineAction` — useful for one-off dev scripts that don't need agent/HTTP exposure. These are CLI-only; they don't appear as agent tools, don't mount HTTP endpoints, and don't get typesafe frontend hooks.

```ts
// actions/debug-dump.ts — CLI-only
import { parseArgs } from "@agent-native/core";

export default async function main(args: string[]) {
  const { table } = parseArgs(args);
  // one-off script you wouldn't want the agent to call
}
```

New code should prefer `defineAction()`. Reach for this pattern only when you deliberately don't want the action exposed to agents or the UI.

### `parseArgs(args)` {#parseargs}

Helper for legacy-style actions. Parses CLI arguments in `--key value` or `--key=value` format:

```ts
import { parseArgs } from "@agent-native/core";

const args = parseArgs(["--name", "Steve", "--verbose", "--count=3"]);
// { name: "Steve", verbose: "true", count: "3" }
```

## Utility functions {#utility-functions}

| Function                | Returns   | Description                                           |
| ----------------------- | --------- | ----------------------------------------------------- |
| `loadEnv(path?)`        | `void`    | Load `.env` from project root (or custom path).       |
| `camelCaseArgs(args)`   | `Record`  | Convert kebab-case keys to camelCase.                 |
| `isValidPath(p)`        | `boolean` | Validate a relative path (no traversal, no absolute). |
| `isValidProjectPath(p)` | `boolean` | Validate a project slug (e.g. `my-project`).          |
| `ensureDir(dir)`        | `void`    | `mkdir -p` helper.                                    |
| `fail(message)`         | `never`   | Print to stderr and `exit(1)`.                        |

## What's next

- [**Drop-in Agent**](/docs/drop-in-agent) — `useActionMutation` / `useActionQuery` in React
- [**Context Awareness**](/docs/context-awareness) — the `view-screen` + `navigate` pattern in depth
- [**A2A Protocol**](/docs/a2a-protocol) — how other agents discover and call your actions
- [**MCP Protocol**](/docs/mcp-protocol) — exposing actions over MCP
