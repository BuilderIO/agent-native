# Action Field Reference

Full detail on the less-common `defineAction` fields and automatic behaviors.
Read this when you need output validation, authorization, human approval,
image results, or the exact rules for the auto-refresh behavior — the happy
path in SKILL.md doesn't need any of these.

## Screen Refresh (automatic)

The framework auto-refreshes the UI after any successful mutating action. On completion of a non-`GET` action, the framework emits a change event with `source: "action"` that the client's `useDbSync` picks up and uses to invalidate `["action"]` React Query keys — so `list-*` / `get-*` hooks refetch without a full page reload. In-process calls emit directly; dev-mode `pnpm action ...` calls also write a durable marker so the web server sees child-process action changes.

Rules:

- `http: { method: "GET" }` → read-only, does NOT trigger a refresh (inferred automatically).
- Any other action (default `POST`, `PUT`, `DELETE`, or `http: false`) → treated as mutating, triggers a refresh on success.
- To override the inference on an unusual action (e.g. a `POST` that only reads), pass `readOnly: true` on the action definition.
- To let a mutating action run concurrently with other same-turn tool calls, pass `parallelSafe: true`. Only do this when the action is internally concurrency-safe and order-independent (for example, it uses an app-level lock or idempotent upsert semantics). Mutating actions remain serialized by default.

Agents do NOT need to call `refresh-screen` after a normal action — it's already handled. `refresh-screen` is only needed when the agent mutates data via a path the framework can't see (e.g. writing to an external system the app mirrors) or when the agent wants to pass a `scope` hint for narrower invalidation.

## Returning Images the Agent Can See (`_agentImages`)

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

## Validating Return Values (`outputSchema`)

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

## Authorization (`authorize`)

`authorize` decides whether the caller may run the action at all. It wraps
`run`, so it holds at **all six dispatch sites** — agent tool, HTTP, frontend
hook, MCP, A2A, CLI — unlike `needsApproval`, which is honoured only in the
agent loop. Use `authorize` for "not everyone may do this"; use `needsApproval`
to ask a human to bless one call a permitted caller is already allowed to make.

```ts
import { coachAccess } from "../lib/access.js"; // defineAppRoles(...)

export default defineAction({
  description: "Archive a client roster.",
  schema: z.object({ id: z.string() }),
  authorize: coachAccess.requireAny("coach-admin"),
  run: async (args) => {
    /* ... */
  },
});
```

The wrappers compose as `validate input -> authorize -> run -> validate output
-> audit`: the gate sits inside input validation, so a guard reading `args` gets
the parsed, coerced value, and auditing is outermost, so denials are recorded.

A guard that throws denies with its own message; returning `false` denies
generically; anything else (including `undefined`) allows. A guarded action
needs a user identity, so an unattended CLI/cron caller with no user email is
denied. `authorize` gates the operation; `accessFilter` / `assertAccess` still
scope which rows a permitted caller may touch. See the `authentication` skill
for `defineAppRoles` and the `sharing` skill for row scoping.

## Human-in-the-Loop Approval (`needsApproval`)

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
