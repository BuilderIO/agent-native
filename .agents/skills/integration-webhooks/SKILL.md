---
name: integration-webhooks
description: >-
  Cross-platform pattern for handling messaging integration webhooks (Slack,
  Telegram, WhatsApp, email, etc.) on serverless hosts. Use when adding a new
  integration adapter, debugging dropped messages, or wiring long-running agent
  work into a webhook handler.
---

# Integration Webhooks

## Rule

Integration webhooks (Slack, Telegram, WhatsApp, email, Google Docs, etc.) must
**enqueue work to SQL and return 200 immediately**, then process the work in a
**separate fresh function execution** kicked off by a self-fired HTTP POST. A
recurring retry job sweeps anything that gets stuck. This pattern works on every
serverless host (Netlify, Vercel, Cloudflare Workers, Fly, Render, Node) without
relying on platform-specific background-execution features.

Do not run agent loops inside the webhook handler itself. Do not rely on
fire-and-forget `Promise`s after `return`ing from a serverless handler — they get
killed when the function freezes.

## Why

Messaging platforms expect a 200 response within a tight window — Slack will
retry after 3 seconds, and a retried event triggers duplicate agent runs. At the
same time, an agent loop replying to the message can take 30–60+ seconds because
it may make multiple LLM calls and tool calls.

Past attempts that don't work cross-host:

- **Fire-and-forget `Promise.then(...)` after returning** — Lambda/Vercel/CF
  freeze the execution context the moment the response goes out. The promise
  is silently killed, the user gets no reply, and there's no error in the
  logs.
- **Netlify Background Functions** — Netlify-only, requires a `-background`
  filename suffix, breaks on every other host.
- **Cloudflare `event.waitUntil()`** — CF Workers only, not portable.
- **Vercel Fluid / `after()`** — Vercel-only, gated behind specific runtimes.
- **A long-lived in-process queue** — fine on a single Node box, but on
  serverless every cold start gets a fresh queue and any pending work is
  lost.

The only universal answer: **persist the work, then trigger a brand new
function execution to do it.** SQL is the queue, a self-webhook is the trigger,
and a recurring job is the safety net.

## The Flow

```
┌──────────┐    1. POST /integrations/:platform/webhook
│ Platform │────────────────────────────────────────────►┌──────────────────┐
└──────────┘                                             │ Webhook handler  │
                                                         │ (function exec 1)│
                                                         └──────────────────┘
                                                                  │
                            2. INSERT INTO integration_pending_tasks
                                 (status='pending', payload=...)
                                                                  │
                            3. fetch(POST /integrations/_process-task)
                                 — fire-and-forget, NO await on body
                                                                  │
                            4. return 200 to platform ◄───────────┘

                                                         ┌──────────────────┐
                          5. POST arrives at processor   │ Processor        │
                             (separate fresh function)   │ (function exec 2)│
                                                         └──────────────────┘
                                                                  │
                            6. claimPendingTask(id) → status='processing'
                            7. runAgentLoop(...) — full timeout budget here
                            8. adapter.sendResponse(...) back to platform
                            9. markTaskCompleted(id)


                          ┌──────────────────────────────────────────────┐
                          │  Recurring job (every 60s) — safety net      │
                          │  Re-fires processor for tasks stuck in       │
                          │  'pending' or 'processing' beyond timeout.   │
                          │  Caps retries at 3 then marks 'failed'.      │
                          └──────────────────────────────────────────────┘
```

The webhook handler does as little as possible. The fresh function execution
that handles `_process-task` gets its own full timeout budget for the agent
loop.

## Key Files

| File                                                                    | Purpose                                                                |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `packages/core/src/integrations/plugin.ts`                              | Mounts `/_agent-native/integrations/*` routes                          |
| `packages/core/src/integrations/webhook-handler.ts`                     | Verifies signature, parses, enqueues task, fires processor             |
| `packages/core/src/integrations/pending-tasks-store.ts`                 | SQL queue: `insertPendingTask`, `claimPendingTask`, `markTaskCompleted`, `markTaskFailed` |
| `packages/core/src/integrations/pending-tasks-retry-job.ts`             | Recurring retry sweep (`startPendingTasksRetryJob`, `retryStuckPendingTasks`) |
| `packages/core/src/integrations/types.ts`                               | `PlatformAdapter`, `IncomingMessage`, `OutgoingMessage`                |
| `packages/core/src/integrations/adapters/{slack,telegram,whatsapp,email,google-docs}.ts` | One adapter per platform                                               |

## Routes

All under `/_agent-native/integrations/`:

| Method | Path                       | Purpose                                                       |
| ------ | -------------------------- | ------------------------------------------------------------- |
| POST   | `/:platform/webhook`       | Platform pings this. Verifies, enqueues, returns 200 quickly. |
| POST   | `/_process-task`           | Self-webhook target. Claims a task and runs the agent loop.   |
| GET    | `/status`                  | All integrations status (settings UI).                        |
| GET    | `/:platform/status`        | One platform's status.                                        |
| POST   | `/:platform/enable`        | Enable an integration.                                        |
| POST   | `/:platform/disable`       | Disable an integration.                                       |
| POST   | `/:platform/setup`         | Platform-specific setup (e.g. Telegram webhook registration). |

## SQL Schema

The pending-task queue lives in `integration_pending_tasks`:

```sql
CREATE TABLE IF NOT EXISTS integration_pending_tasks (
  id                 TEXT    PRIMARY KEY,
  platform           TEXT    NOT NULL,
  external_thread_id TEXT    NOT NULL,
  payload            TEXT    NOT NULL,   -- JSON-serialized IncomingMessage
  owner_email        TEXT    NOT NULL,
  org_id             TEXT,
  status             TEXT    NOT NULL,   -- pending | processing | completed | failed
  attempts           INTEGER NOT NULL DEFAULT 0,
  error_message      TEXT,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  completed_at       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pending_tasks_status_created
  ON integration_pending_tasks(status, created_at);
```

The store layer creates this lazily on first use via `ensureTable()` and uses
`intType()` from `db/client.ts` so it works on both SQLite and Postgres.

`claimPendingTask` is the critical concurrency primitive: it atomically flips
`pending` → `processing` and increments `attempts`, returning `null` if another
worker beat us to it. Both the initial fire-and-forget call and the retry job
funnel through the same processor endpoint, and `claimPendingTask` is what
prevents the same task from being processed twice.

## Adding a New Platform Adapter

1. **Implement `PlatformAdapter`** in `packages/core/src/integrations/adapters/<platform>.ts`:

   ```ts
   export function myPlatformAdapter(): PlatformAdapter {
     return {
       platform: "myplatform",
       label: "MyPlatform",
       getRequiredEnvKeys: () => [
         { name: "MYPLATFORM_TOKEN", label: "MyPlatform Bot Token", scope: "global" },
       ],
       async handleVerification(event) {
         // Platform-specific challenge response, if any
         return { handled: false };
       },
       async verifyWebhook(event) {
         // HMAC / signing-secret check — return false on mismatch
         return true;
       },
       async parseIncomingMessage(event) {
         // Map raw payload → IncomingMessage, or null to ignore
         return null;
       },
       async sendResponse(message, context) {
         // POST back to the platform's API
       },
       formatAgentResponse(text) {
         return { text, platformContext: {} };
       },
       async getStatus(baseUrl) {
         return { platform: "myplatform", label: "MyPlatform", enabled: false, configured: false };
       },
     };
   }
   ```

2. **Register it** in `getDefaultAdapters()` inside `plugin.ts`. The webhook,
   queue, processor, and retry job are shared infrastructure — you do not
   write any of that per-adapter.

3. **Declare required env keys** so the secrets/onboarding UI surfaces them.
   See `secrets` and `onboarding` skills.

4. **Update the platform's webhook URL** to point at
   `${baseUrl}/_agent-native/integrations/<platform>/webhook`. For platforms
   with a registration API (Telegram), implement `POST /:platform/setup`.

The adapter is **only** responsible for:

- platform-specific verification (signatures, challenges)
- payload → `IncomingMessage` mapping
- agent text → platform format
- delivering the response back to the platform

It does **not** know about the queue, the processor, retries, or the agent
loop. Those are handled by the shared webhook handler.

## Long-Running Agent Work

The processor endpoint runs in a fresh function execution with its own full
timeout (typically 30–60s on Netlify/Vercel, longer on background-friendly
hosts). That budget is dedicated entirely to the agent loop — there is no
platform-side timer racing it.

If a single agent run might exceed the function timeout (large multi-step
plans, deep delegation chains), the agent should:

1. Send an interim acknowledgement back to the platform so the user knows the
   request landed (`adapter.sendResponse({ text: "Working on it..." })`).
2. Persist intermediate state in chat-thread data, application state, or a
   recurring job so the next invocation can pick up where this one left off.

The retry job will only re-fire tasks stuck in `processing` for over 5 minutes,
so a normal long-running reply is safe.

## Cross-Platform Considerations

- **No platform-specific background APIs.** No `waitUntil`, no
  `-background.ts` filenames, no Vercel `after()`. The pattern works
  identically on every host because it only uses `fetch()` and SQL.
- **No assumed runtime.** The processor endpoint is a normal H3 handler under
  `/_agent-native/`. It runs wherever the rest of the framework runs.
- **No persistent in-memory state.** The dedup map in the webhook handler is
  best-effort only; the SQL queue is the source of truth. Any cold start
  loses the dedup map but the queue stays consistent.
- **Postgres + SQLite both supported.** `claimPendingTask` uses `RETURNING` on
  Postgres and a re-read on SQLite. No platform-specific SQL.
- **Self-webhook URL resolution.** The processor URL is built from
  `WEBHOOK_BASE_URL`, `APP_URL`, or `URL` env vars (with `localhost:3000` as
  the dev fallback). Templates that change their public URL must keep one of
  these set.

## Why Fire-and-Forget on Serverless Is Unreliable

Even though the webhook handler does `fetch(processorUrl, ...)` without
awaiting the response body, that initial dispatch is **not** guaranteed to
complete before the function freezes. In practice it usually does — the TCP
connect + write happens quickly — but the recurring retry job is the safety
net for the cases where:

- The serverless platform froze the handler before the outbound `fetch`
  flushed its bytes.
- The processor function 502'd or cold-started slow enough to time out.
- The processor itself was killed mid-agent-loop (function timeout, container
  shutdown, deploy mid-run).

Tasks stuck in `pending` for >90s or `processing` for >5min get re-fired up to
3 times. After 3 attempts they're marked `failed` permanently so we stop
spamming the processor.

**Never assume the initial fire-and-forget succeeded.** Always rely on the
queue + retry job for at-least-once delivery.

## Debugging Checklist

1. **Platform sent the webhook?** Check the platform's delivery logs (Slack
   admin, Telegram `getWebhookInfo`).
2. **Webhook handler returned 200?** If not, the platform retries — look for
   duplicate task rows. Signature failures return 401.
3. **Task in the queue?** `SELECT * FROM integration_pending_tasks WHERE
   external_thread_id = '...' ORDER BY created_at DESC LIMIT 5`.
4. **Status?** `pending` means the processor never picked it up — check that
   `_process-task` is reachable from the box itself (the self-fetch must work
   over the public URL). `processing` for over 5 minutes means the processor
   died mid-run — the retry job will pick it up.
5. **Failed?** Check `error_message` and `attempts`. After 3 attempts the row
   is parked at `failed` and won't be retried.
6. **Reply not delivered?** The processor likely succeeded but
   `adapter.sendResponse` failed — check the adapter's outbound logs.

## Related Skills

- `server-plugins` — How `/_agent-native/` routes get mounted
- `recurring-jobs` — Pattern the retry job follows
- `actions` — When to use an action vs a webhook
- `secrets` — Registering platform tokens
- `onboarding` — Surfacing setup steps for each platform
- `delegate-to-agent` — How the processor invokes the agent loop
