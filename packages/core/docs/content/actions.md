---
title: "Actions"
description: "defineAction — the single definition that becomes an agent tool, a typesafe frontend mutation, an HTTP endpoint, an MCP tool, and a CLI command."
---

# Actions

Actions are the single source of truth for anything your app does. Define an action once with `defineAction()`, drop it in `actions/`, and it's immediately available as:

- **An agent tool** — the agent sees it with a zod-derived JSON Schema and can call it in chat.
- **A typesafe React mutation** — `useActionMutation("name")` on the frontend, types inferred from the schema.
- **An HTTP endpoint** — `POST /_agent-native/actions/<name>` (auto-mounted by the framework).
- **An MCP tool** — exposed to Claude Desktop, ChatGPT remote-MCP, and any other MCP client.
- **An A2A tool** — called by other agent-native apps over A2A.
- **A CLI command** — `pnpm action <name>` for scripting and dev loops.

One definition, six consumers. This is rung 3 of the [ladder](/docs/what-is-agent-native#the-ladder).

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
  http: { method: "GET", path: "leads/:leadId" }, // optional override
  run: async ({ leadId }) => {
    return await db.select().from(leads).where(eq(leads.id, leadId));
  },
});
```

- **`http: { method: "GET" | "POST" | "PUT" | "DELETE" }`** — default `POST`. `GET` actions are auto-marked `readOnly` so successful calls don't trigger a UI poll-refresh.
- **`http: { path: "..." }`** — override the route path under `/_agent-native/actions/`. Defaults to the filename.
- **`http: false`** — disable the HTTP endpoint entirely. Agent + CLI only.
- **`readOnly: true`** — explicitly skip the poll-refresh even for POST actions that don't mutate.

### Tools callability {#tool-callable}

Tools (Alpine.js mini-apps that run inside sandboxed iframes — see [Tools](/docs/tools)) call actions via `appAction(name, params)`. Because a shared tool's HTML/JS executes inside the *viewer's* session, an action invoked from a tool runs with the viewer's permissions, secrets, and SQL scope. For high-blast-radius operations, that is too much trust to grant by default.

Use the `toolCallable` flag to control this:

```ts
export default defineAction({
  description: "Delete the current user's account.",
  toolCallable: false, // never callable from a tool iframe
  schema: z.object({ confirm: z.literal("yes") }),
  run: async () => { /* ... */ },
});
```

| Value          | Behavior                                                                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `true`         | Explicit allow. Recommended for any action a tool legitimately needs to call.                                                                             |
| `false`        | Explicit deny. The tools bridge returns 403; the action is still callable normally from the UI, agent, CLI, MCP, and A2A.                                 |
| `undefined`    | Implicit allow with a one-shot deprecation warning. Existing actions keep working; the warning surfaces during dev so you can migrate to an explicit flag. |

Enforcement: the parent host (`ToolViewer.tsx` / `EmbeddedTool.tsx`) tags every outbound action call from a tool iframe with the header `X-Agent-Native-Tool-Bridge: 1`. The action route layer reads this header and applies the rule above. Regular UI/agent/CLI/A2A calls do not carry the header and are unaffected. The header is set by the React host; the iframe's user-authored content cannot spoof it because the bridge sanitizes iframe-supplied headers.

Set `toolCallable: false` for actions that:
- delete or transfer ownership of any account/org,
- change auth state (sign-out-all sessions, rotate tokens),
- modify org membership (invite/remove members, change roles),
- change resource visibility or grant share access (the framework's built-in `share-resource`, `unshare-resource`, and `set-resource-visibility` are already opted out).

## Calling it from the UI {#ui}

Two hooks, both in `@agent-native/core/client`. Types are inferred from your `defineAction` schemas — no manual type declarations.

### `useActionMutation` {#use-action-mutation}

For actions that change state:

```tsx
import { useActionMutation } from "@agent-native/core/client";

const { mutate, isPending } = useActionMutation("replyToEmail");

<Button
  disabled={isPending}
  onClick={() => mutate({ emailId, body: "Thanks!" })}
>
  Send Reply
</Button>;
```

On success, the framework emits a poll event so every `useActionQuery`/`useDbSync` consumer refetches automatically. See [Real-Time Sync](/docs/key-concepts#polling-sync).

### `useActionQuery` {#use-action-query}

For read-only GET actions:

```ts
import { useActionQuery } from "@agent-native/core/client";

const { data, isLoading } = useActionQuery("getLead", { leadId });
```

The query is cached under `["action", "getLead", { leadId }]` and auto-invalidated on any mutating action that completes.

## Calling it from the CLI {#cli}

Every action is runnable via `pnpm action`:

```bash
pnpm action replyToEmail --emailId thread-123 --body "Thanks!"
```

Flags are parsed into the shape your schema expects. Useful for agent-dev loops, scripts, and cron.

## Calling it from another agent (A2A) {#a2a}

If your app is an [A2A](/docs/a2a-protocol) peer, other agent-native apps discover your actions automatically and can call them by name. Same-origin deploys skip JWT signing; cross-origin uses a shared `A2A_SECRET`.

## Exposing it over MCP {#mcp}

With MCP enabled, your actions show up in the framework's MCP server at `/_agent-native/mcp`. Any MCP client — Claude Desktop, ChatGPT remote MCP, etc. — can connect and see them as tools. See [MCP Protocol](/docs/mcp-protocol).

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
      const res = await fetch(
        `${process.env.APP_URL}/api/emails?label=${navigation.label}`,
      );
      screen.emailList = await res.json();
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
