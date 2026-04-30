# Overnight QA Critical Findings

Generated: 2026-04-30 by autonomous QA sweep (overnight round 2).

## Severity legend

- CRITICAL: data integrity / security / multi-tenant correctness
- HIGH: user-facing breakage
- MEDIUM: subtle correctness or UX gap
- LOW: minor cleanup
- FEATURE GAP: documented but not implemented

---

## Findings

### 1. [CRITICAL] Shared mutable request-state variables in agent-chat-plugin

**File:** `packages/core/src/server/agent-chat-plugin.ts:2199, 2343, 2984–2991`

**Variables:**

- `_currentRequestOrigin` (line 2199)
- `_currentRunOwner` (line 2343)
- `_currentRunUserApiKey` (line 2984)
- `_currentRunThreadId` (line 2985)
- `_currentRunSystemPrompt` (line 2986)
- `_currentRunEngine` (line 2990)
- `_currentRunModel` (line 2991)

**Symptom:** Under concurrent requests on any long-lived Node process (production, Netlify Functions with warm containers), request B's `prepareRun()` call (line 3120) overwrites all these variables while request A's tool calls are still executing. The closures in `automationTools`, `notificationTools`, `progressTools`, and `fetchTool` — created once at plugin startup, lines 2350–2387 — all capture `() => _currentRunOwner`, not the value at the moment they were created. So if two chat requests interleave, automations and fetch tools for request A will execute with request B's owner/email/API key.

**Root cause:** All seven variables are plugin-closure-scoped `let` bindings (one per plugin instance) rather than per-request scoped. `prepareRun()` at line 3120 mutates them unconditionally on each request. The tool-entry callbacks close over the live binding, not a snapshot.

**Reproduce:** Open two browser tabs simultaneously for two different users. Each sends a message that triggers an automation or tool fetch call. Observe that one user's automation may fire with the other user's email (check automation `owner` column in DB or server logs).

**Proposed fix:** Move all seven variables into `runWithRequestContext` (the `AsyncLocalStorage` already used at line 4282). Create a per-request context store like `{ owner, apiKey, threadId, systemPrompt, engine, model, requestOrigin }` and pass it through the request lifecycle. The tool-entry callbacks need refactoring: either pass context as a parameter, or make them factories called per-request rather than once at startup. The `_runSendByThread` Map (line 2980) already handles thread-keyed state correctly — the same pattern should apply to all these variables.

**Risk if not fixed:** Cross-user data leakage. Automation tools, fetch-tool secret resolution, and notification tools execute under the wrong user identity. Secrets scoped to user A can be sent to user B's request. System prompt from user B's session can overwrite the debug `_debug` metadata (line 2887–2892) saved to user A's thread.

---

### 2. [CRITICAL] Concurrent CLI tool calls corrupt global console/stdout patching

**File:** `packages/core/src/server/action-discovery.ts:104–169`, `packages/core/src/agent/production-agent.ts:441`

**Symptom:** When the agent makes multiple tool calls in one turn (very common — Anthropic models frequently return multiple tool-call blocks), `production-agent.ts:441` runs them all concurrently via `Promise.all`. Each tool call invokes either `wrapDefaultExport` (line 104) or `wrapCliScript` (line 91 in agent-chat-plugin.ts). Both monkey-patch `console.log`, `console.error`, `process.stdout.write`, and `process.exit` on the shared global object immediately before the call, and restore them in `finally`.

**Root cause:** The save/restore pattern is:

```
origLog = console.log          // A saves real log
console.log = captureA         // A installs capture
// B runs concurrently:
origLog2 = console.log         // B saves captureA (not real log!)
console.log = captureB         // B installs captureB
// A's finally:
console.log = origLog          // A restores to real log
// B's finally:
console.log = origLog2         // B "restores" captureA — now captureA is permanently installed
```

After two concurrent tool calls complete, the real `console.log` is never restored. All subsequent server logs silently disappear into whichever capture buffer last ran. On a busy server this is every request with multiple tool blocks.

**Reproduce:** Send a message that causes two CLI tool calls in one agent turn (e.g., `db-schema` + `docs-search`). After the response, check that `console.log("ping")` still prints to server stdout.

**Proposed fix:** Replace global monkey-patching with one of:

1. Spawn each CLI invocation in a subprocess (child_process) and capture stdout/stderr there — fully isolated, no globals touched.
2. AsyncLocalStorage-based interception: install one global interceptor that reads `AsyncLocalStorage.getStore()` to decide where to route output, rather than swapping the function pointer.

**Risk if not fixed:** Progressive loss of server-side logging on any multi-tool-call agent turn. Hard to diagnose because logs disappear silently. On long-lived processes, eventually all server console output is captured into a stale buffer and never printed.

---

### 3. [MEDIUM] `canManage` in ShareButton shows management UI for users with undefined role

**File:** `packages/core/src/client/sharing/ShareButton.tsx:229–230`

**Symptom:** The expression `canManage = data?.role === "owner" || data?.role === "admin" || !data?.role` evaluates to `true` when `data` is defined but `data.role` is `undefined` or `null`. This can happen when the shares endpoint returns a record with no role field (e.g., a shares table entry missing `principalType` resolution). The management panel is shown to that user.

**Root cause:** The `!data?.role` branch was written as a loading-state guard: "if we don't have data yet, assume manage access to avoid flicker." But the condition does not distinguish between `data === undefined` (not yet loaded) and `data.role === undefined` (loaded but no role). Once data arrives with an unexpected shape, the branch fires incorrectly.

**Server-side impact:** `assertAccess` in the actions layer still enforces authorization correctly, so no actual data mutation is possible. This is a UI-only exposure of controls the server will reject.

**Proposed fix:**

```ts
// Before:
const canManage =
  data?.role === "owner" || data?.role === "admin" || !data?.role;

// After:
const canManage = data?.role === "owner" || data?.role === "admin";
// Loading state: gate on data === undefined separately where needed
```

**Risk if not fixed:** Users who encounter broken share records see a manage panel they cannot actually use. Confusing UX, and if server-side guards are ever weakened the gap becomes exploitable.

---

### 4. [MEDIUM] `highestShareRole` performs unbounded table scan on every read/write

**File:** `packages/core/src/sharing/access.ts:160–167`

**Symptom:** `highestShareRole` selects ALL rows from `sharesTable` for a given `resourceId` with no filter on `principalId` and no LIMIT clause. For a resource shared with many principals (e.g., a public org-wide resource), this returns every grant ever made and iterates them in application code.

**Root cause:**

```ts
const rows = await db
  .select()
  .from(reg.sharesTable)
  .where(eq(reg.sharesTable.resourceId, resourceId)); // no LIMIT, no principal filter
```

This query runs on every authorization check (every read and write to any shared resource). The in-application loop at lines 169+ filters to the current user/org, but the full table scan still hits the DB and transfers all rows over the wire.

**Proposed fix:** Push the `principalId` filter into the SQL query — filter on `(principalId = userEmail OR principalId = orgId)` before returning. If both are null/anonymous, short-circuit and return `null` immediately at line 162 rather than querying. Add a DB index on `(resourceId, principalId)` if not already present.

**Risk if not fixed:** Quadratic performance on high-grant resources. Worst case: an org-shared resource with 1,000 members returns 1,000 rows on every page load. Hot path — called for every read, write, and list of ownable resources.

---

### 5. [FEATURE GAP] Cmd+I text selection capture not implemented

**File:** `packages/core/src/client/AgentPanel.tsx:1606–1616`

**Symptom:** CLAUDE.md and AGENTS.md document: "If the user selects text and hits Cmd+I to focus the agent, the agent knows what text is selected and can act on just that." The Cmd+I handler (line 1607) only calls `focusAgentChat()`. There is zero call to `window.getSelection()` anywhere in this flow, and no mechanism to pass a selection to the composer.

**Root cause:** The feature was designed and documented but never implemented.

**Proposed implementation:**

1. In the `handleKeyDown` callback (line 1608), capture `window.getSelection()?.toString().trim()` before calling `focusAgentChat()`.
2. If the selection is non-empty, either:
   - Pre-populate the composer input with a quoted block (e.g., `> {selection}\n\n`) so the user can see what context is included, OR
   - Write the selection to `application_state` under a key like `pending-selection-context` and have the agent system prompt include it on the next turn.
3. Document the format in AGENTS.md.

**Risk if not fixed:** Users who follow documentation by selecting text and pressing Cmd+I get no selection context passed to the agent. Feature is silently broken.

---

### 6. [MEDIUM] `process.env` mutation race in action-routes for AGENT_USER_EMAIL / AGENT_ORG_ID / AGENT_USER_TIMEZONE

**File:** `packages/core/src/server/agent-chat-plugin.ts:4258–4279`

**Symptom:** Lines 4259–4279 mutate `process.env.AGENT_USER_EMAIL`, `process.env.AGENT_ORG_ID`, and `process.env.AGENT_USER_TIMEZONE` as a back-compat shim for CLI scripts/actions that read `process.env` directly. On concurrent requests this is a race: request B's mutation overwrites request A's value before A's CLI tool calls read it.

**Root cause:** `process.env` is a single shared object. The `runWithRequestContext` at line 4282 correctly scopes per-request identity in AsyncLocalStorage, but any legacy code that reads `process.env.AGENT_USER_EMAIL` directly (rather than calling `getRequestUserEmail()`) will see whichever request last wrote the key.

**Recommended sweep:** `grep -rn 'process\.env\.AGENT_USER_EMAIL\|process\.env\.AGENT_ORG_ID\|process\.env\.AGENT_USER_TIMEZONE' packages/ templates/` — migrate all direct readers to `getRequestUserEmail()` / `getRequestOrgId()`, then remove the `process.env` mutation lines. The `// guard:allow-env-mutation` comments at those lines are an existing acknowledgment that this is a known debt.

**Risk if not fixed:** Under concurrent load, a CLI action for user A reads user B's email from `process.env`, causing wrong-user data writes. Lower probability than finding #1 but same blast radius when it occurs.

---

### 7. [LOW] `/generate-title` endpoint has no rate limiting

**File:** `packages/core/src/server/agent-chat-plugin.ts:3807–3866`

**Symptom:** Any authenticated user can POST to `/_agent-native/agent/generate-title` (or `/${routePath}/generate-title`) in a tight loop. Each request invokes the Anthropic API directly (line 3837) with the platform key (or user BYO key). The endpoint has authentication via `getOwnerFromEvent` (line 3814) but no per-user rate limit.

**Root cause:** No rate limiting middleware applied. Max tokens is capped at 30 per call (line 3845), so individual calls are cheap, but volume is uncapped.

**Recommended fix:** Add a simple per-user in-memory counter (Map keyed by user email, reset on interval) or a DB-backed counter. A reasonable limit: 10 title-gen calls per minute per user. Alternatively, generate the title client-side from the first N characters when the endpoint is not available, which is already the fallback at line 3834.

**Risk if not fixed:** A malicious authenticated user can exhaust the platform's Anthropic API credits by spamming this endpoint. Low severity on BYO-key users (costs them), higher on shared-key production deployments.

---

### 8. [MEDIUM — ACCESSIBILITY] `<span role="button">` for tab close X in MultiTabAssistantChat

**File:** `packages/core/src/client/MultiTabAssistantChat.tsx:1209–1229`

**Symptom:** The tab-close X button is a `<span role="button">` (line 1209). Spans are not keyboard-focusable by default (no `tabIndex`), so keyboard users cannot close tabs. The global `agent-native.css` rule `button { cursor: pointer }` does not apply to this span.

**Root cause:** The outer element at line 1204 is a `<button>` (the tab itself), and the close X is nested inside it as a styled span with `role="button"`. Nesting an interactive `role="button"` inside a `<button>` is also invalid HTML (interactive content inside interactive content).

**Fix:** Replace the `<span role="button">` with a proper `<button>` element. Add `type="button"` to prevent form submission, `tabIndex={0}`, and move the `onClick` to the button. This matches the pattern used for the tab-add button at line 1235. The outer `<button>` will need restructuring to avoid nesting.

**Risk if not fixed:** Keyboard users cannot close tabs. Screen readers announce incorrect semantics.

---

### 9. [MEDIUM — UI] HistoryPopover and HelpPopover may clip inside `overflow-hidden` containers

**File:** `packages/core/src/client/AgentPanel.tsx:1708` (overflow-hidden panel), `packages/core/src/client/AgentPanel.tsx:1732` (overflow-hidden flex wrapper)

**Symptom:** The agent sidebar panel renders with `overflow-hidden` (lines 1708, 1732). Any Radix Popover components rendered inside that container (HistoryPopover, HelpPopover) that do not use a portal will have their popover content clipped by the `overflow-hidden` boundary.

**Fix:** Ensure any Popover inside the sidebar uses `<PopoverContent>` with the Radix portal behavior (the default in Radix UI — verify that no custom wrapper is suppressing it via `container` prop). If a custom container prop points to the sidebar div, change it to render into `document.body`.

**Risk if not fixed:** History and help popovers are visually clipped, appearing cut off or invisible depending on scroll position and container bounds.

---

### 10. [LOW] `sidebarWidth` prop change after mount is silently ignored

**File:** `packages/core/src/client/AgentPanel.tsx:1490–1498, 1440–1461`

**Symptom:** The `useEffect` at line 1490 that reads `SIDEBAR_STORAGE_KEY` from `localStorage` has an empty dependency array (`[]`, line 1498), running only on mount. The `sidebarWidth` prop (default 380, line 1440) initializes the `useState` at line 1461, but if the prop changes after initial render, the `useEffect` never re-runs and the width is not updated.

**Root cause:** Mount-only effect. The `sidebarWidth` prop is not in the effect's dep array, so React never re-runs the local-storage read when the parent passes a new value.

**Fix:** Either:

1. Add `sidebarWidth` to the effect dep array (and handle the case where a saved localStorage value should take precedence over the prop), OR
2. Remove the `sidebarWidth` prop from the component if it is genuinely intended as a mount-only default — document this clearly so callers know it cannot be changed reactively.

**Risk if not fixed:** Low — in practice `sidebarWidth` is probably set once at app mount and never changes. But it creates a confusing API contract where the prop appears reactive but is not.

---

## Summary for prioritization

| #   | Severity    | Fix complexity | Fix scope                                                               |
| --- | ----------- | -------------- | ----------------------------------------------------------------------- |
| 1   | CRITICAL    | High           | packages/core/src/server/agent-chat-plugin.ts (widespread refactor)     |
| 2   | CRITICAL    | High           | packages/core/src/server/action-discovery.ts + agent-chat-plugin.ts     |
| 3   | MEDIUM      | Trivial        | packages/core/src/client/sharing/ShareButton.tsx:229                    |
| 4   | MEDIUM      | Medium         | packages/core/src/sharing/access.ts:164–167                             |
| 5   | FEATURE GAP | Medium         | packages/core/src/client/AgentPanel.tsx:1609                            |
| 6   | MEDIUM      | Medium         | packages/core/src/server/agent-chat-plugin.ts:4259–4279 + template grep |
| 7   | LOW         | Easy           | packages/core/src/server/agent-chat-plugin.ts:3807                      |
| 8   | MEDIUM      | Easy           | packages/core/src/client/MultiTabAssistantChat.tsx:1209                 |
| 9   | MEDIUM      | Easy           | AgentPanel.tsx + PopoverContent portal check                            |
| 10  | LOW         | Easy           | packages/core/src/client/AgentPanel.tsx:1490                            |

Findings #1 and #2 are the most urgent — both are concurrency bugs in core framework code that affect all templates simultaneously under any real production load. They were not introduced by a recent change; they are structural issues in how the plugin was architected. Recommend fixing before the next hosted production traffic increase.
