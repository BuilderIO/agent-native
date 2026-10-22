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
- If a successful call hands control to the user — it renders a question, an intake form, or anything else the turn must wait on — pass `endsTurn: true` and make it the first or only call in the turn. It stops subsequent model steps and later calls, but cannot undo calls emitted before it. Without it a completion guard sees a turn that legitimately paused as one that failed to finish. `endsTurn: true` also hides the action from MCP, WebMCP, and A2A callers by default (`isActionExposedToExternalAgents` in core `action.ts`) — an external host has no in-app chat to receive the answer on. Pass `mcpTool: true` alongside it only when an external caller can complete the same operation without that answer.
- Read results persist in the browser per signed-in user and org, so a revisit paints the last result before it refetches. Pass `persistInBrowser: false` on a read that must not outlive the page (secrets, one-time codes, another user's private data). Mutations never persist.
- MCP hosts read tool annotations to decide how carefully to treat a call. Every MCP catalog advertises declared `mcpAnnotations` (`readOnlyHint`, `destructiveHint`, `openWorldHint`, optional `idempotentHint`); otherwise `/mcp` derives only `readOnlyHint` and an approval-based `destructiveHint`. Declare them on every action MCP advertises that is not read-only, with `destructiveHint: true` when it removes, overwrites, or replaces user content — recoverable Trash included — and mark idempotency-key-guarded writes `idempotentHint: true`. A contract test fails on a new undeclared write.

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

- `"warn"` (default) — `console.warn` the issues and return the **original** result unchanged. Non-breaking, with one exception: a connection request or stop signal thrown while the result is checked (from a transform or refinement) still ends the call as that signal, with a framework message in place of its own.
- `"strict"` — throw `ActionOutputContractError` (`errorCode: "output_contract_violation"`) so a buggy action surfaces loudly.
- `"fallback"` — return `outputFallback` in place of the invalid result.

On success the validated value is returned, so coercion/defaults on `outputSchema` apply. Omit `outputSchema` and behavior is byte-for-byte unchanged (no wrapping).

The strict error and such a signal run after `run()`, so they carry `effect`: `"committed"` once a write entered its handler, in the call or in one nested in it (even under a read-only action), and `"none"` otherwise. Writes are classified from the validated arguments, defaults applied. The agent loop, the plan-mode registry, HTTP action routes, and MCP prepare each call once (validated arguments plus that classification) and run exactly that preparation: approval, plan mode, write blocking, batching, and replay all read it, and the run does not parse the arguments again. Preparation reads the validated arguments once into a frozen, plain-data snapshot and hashes it; each gate and `run()` gets its own copy of that snapshot, never the snapshot itself, so mutating `args` in a gate or a handler changes nothing anyone else reads. Validated arguments must therefore be plain data: objects, arrays, strings, numbers, booleans, `null`, `undefined`, BigInts, and valid Dates. A schema whose output holds anything else (a getter or setter, a `Map` or `Set`, a class instance, a function) makes every call fail as invalid. Preparation, its refusals and the per-consumer copies cover calls the agent loop, plan mode, HTTP action routes, and MCP dispatch; a direct `action.run()` (one action composing another, the dev action bridge) gets schema validation only. A call whose arguments are invalid fails before any of them and never reaches the handler. Every reuse of a call's outcome keys on the snapshot's hash, never on the raw input: a continued turn replays a call only when it recorded a committed effect for the same hash, reads are reused only for the same hash, and an interrupted write recovers only a result recorded for the same hash, otherwise it stops instead of running again. The message names only declared field paths and issue codes, never output values, and tells the caller not to retry a committed write. A connection request keeps its `provider`, `reason`, `appId`, and `source` in its fields, in its message, and in HTTP `details`.

MCP clients see no `outputSchema` by default. Set `mcpOutputSchema: true` (requires `outputErrorStrategy: "strict"`) only after auditing that every real result matches: the tool then advertises the schema as MCP sees it (an array root becomes `{ items }`, linked actions gain `openLink`/`url`), and each `structuredContent` is validated against it before it is returned. Roots must be an object, an object-only union, or an array, and schemas with transforms cannot opt in. The advertised schema allows for MCP's redaction (embed ticket fields dropped; a string holding an embed start URL arrives as `"[hidden embed URL]"`, so required fields stay required). A schema is refused at definition time if it uses a keyword or `format` the check cannot enforce (`not`, `$async`, an unknown format), if redaction could break its `const`, `enum`, or `uniqueItems`, or if a linked action's root limits its property names or count.

## Authorization (`authorize`)

`authorize` decides whether the caller may run the action at all. It wraps
`run`, so it holds at **all six dispatch sites** — agent tool, HTTP, frontend
hook, MCP, A2A, CLI. Use `authorize` for "not everyone may do this"; use
`needsApproval` to ask a human to bless one call a permitted caller is already
allowed to make.

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
scope which rows a permitted caller may touch. Use `agent-native-docs` to find
the current authentication and sharing documentation when adding role checks.

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

When the gate is truthy and the call isn't yet approved, the loop emits an `approval_required` event and **stops the turn — `run()` never executes**. A predicate gates conditionally (e.g. only external recipients) and **fails closed**: a throw is treated as "approval required". It receives its own copy of the prepared snapshot of the validated arguments, defaults applied, and the approval binds to the snapshot's hash, so an approved call runs only with the arguments that were approved (a Date binds by its time). The human approves via the chat UI's Approve affordance, which re-issues the turn with the call's `approvalKey`, and only then does the action run.

Approval is given in the app, so HTTP never grants it. The HTTP action route and the generated Workers entry run a gated call only for the proven app UI (a frontend call from the signed-in user, same origin, holding the short-lived UI capability; `isProvenUiRequest`, the proof `uiOnly` uses) or the app's MCP directory widget. Every other direct HTTP caller (bearer or API key, MCP OAuth token, org service token, extension iframe, or mobile app) gets `409 approval_required`, and a service identity can never approve. A2A tasks use their separate approval flow. The task pauses until its owner approves, then replays the approved tool call under its approval lease. The shared client presents the capability with every write from a signed-in session (minted once per user, reused for nine minutes, never for reads or public pages), so a gated button works on its first request. A call without proof gets `403 ui_capability_required`; the client then re-mints and retries once, which is only the fallback for an expired or rejected capability. The agent loop, plan mode registry, HTTP action route, generated Workers entry, and MCP dispatch evaluate the gate through `preparedCallNeedsApproval`, so a throwing predicate asks there too. The local `pnpm action ...` CLI calls `handler.run()` directly and does not evaluate `needsApproval`. Treat it as a local development tool, not an approval boundary. A caller that must run unattended needs a different action, never a bypass of the gate.

**Keep approvals rare** — the default is off and almost every action should leave it off. The canonical example is Mail's `send-email` (`needsApproval: true`). See the `security` skill and the Human Approval doc.
