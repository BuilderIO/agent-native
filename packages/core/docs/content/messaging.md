---
title: "Messaging"
description: "Talk to your agent from Slack, email, Telegram, or WhatsApp — same agent, same memory, same tools."
---

# Messaging

Connect your agent to Slack, email, Telegram, or WhatsApp so you can chat with it from the apps you already use. It's the same agent — same memory, same tools, same threads — just reachable from more places.

> **Using the Dispatch template?** All of this is wired up for you in **Settings → Messaging**. Click to connect each platform — you don't need to read the rest of this page unless you're customizing or building your own template. See [Dispatch](/docs/dispatch) or the [Dispatch template reference](/docs/template-dispatch).

## What you can do {#what-you-can-do}

- **Email your agent** at an address like `agent@yourcompany.com` — it replies in-thread, just like a coworker would.
- **CC your agent** on a thread — it'll read along and jump in when you ask.
- **DM the agent on Slack**, or `@mention` it in any channel.
- **Message the agent on Telegram or WhatsApp** from your phone.
- **Same agent, same memory.** Whatever you tell it on Slack is remembered when you email it later. The web chat and external messages share one thread history.

## Set up Slack {#slack}

### What you'll need

- A Slack workspace where you can install apps (admin access)
- About 5 minutes

### Steps

1. Go to **[api.slack.com/apps](https://api.slack.com/apps)** and click **Create New App** → **From scratch**. Name it (e.g. "Agent") and pick your workspace.
2. In the left sidebar, open **OAuth & Permissions**. Under **Bot Token Scopes**, add:
   - `chat:write` — lets the agent send messages
   - `app_mentions:read` — lets the agent see when it's @-mentioned (optional)
   - `im:history` — lets the agent read DMs sent to it
   - `assistant:write` — optional; lets Slack show native "is thinking..." status in assistant threads
   - `users:read.email` — optional; helps templates such as Mail verify Slack sender email for draft-queue identity
3. Click **Install to Workspace** at the top of that page. Slack will give you a **Bot User OAuth Token** that starts with `xoxb-`. Copy it.
4. Go to **Basic Information** in the sidebar and copy the **Signing Secret**.
5. Open your app's settings (or your hosting provider's environment variable panel) and paste:
   - `SLACK_BOT_TOKEN` — the `xoxb-…` token
   - `SLACK_SIGNING_SECRET` — the signing secret
   - `SLACK_ALLOWED_TEAM_IDS` — recommended in production; comma-separated Slack workspace/team IDs allowed to send events
   - `SLACK_ALLOWED_API_APP_IDS` — recommended for multi-workspace apps; comma-separated Slack app IDs allowed to use this signing secret
6. Back in Slack, open **Event Subscriptions**, toggle it on, and paste this Request URL:

   ```text
   https://your-app.example.com/_agent-native/integrations/slack/webhook
   ```

   Then under **Subscribe to bot events**, add `message.im` (for DMs) and optionally `app_mention` (for channel mentions). Save.

7. Send your bot a DM in Slack. It should reply.

### Tips

- **Channel mentions** — the bot only responds in channels when it's @-mentioned, to avoid noise.
- **DMs** — every DM is treated as a private conversation with the agent.
- **Same identity, all channels** — if a Slack user has the same email as a registered user in your app, the agent treats them as the same person.
- **Production allowlists** — set `SLACK_ALLOWED_TEAM_IDS` and, for shared Slack apps, `SLACK_ALLOWED_API_APP_IDS` so a valid signing secret cannot be reused by an unexpected workspace.

## Set up Telegram {#telegram}

### What you'll need

- The Telegram app on your phone
- About 3 minutes

### Steps

1. Open Telegram and message **[@BotFather](https://t.me/BotFather)**.
2. Send `/newbot` and follow the prompts to name your bot. BotFather will reply with an **HTTP API token**. Copy it.
3. In your app's environment variables, set:
   - `TELEGRAM_BOT_TOKEN` — the token from BotFather
4. After deploying, register the webhook by `POST`ing to your app at:

   ```text
   POST https://your-app.example.com/_agent-native/integrations/telegram/setup
   ```

   This tells Telegram to send messages to your app's webhook. You only need to do this once per deployment.

5. Find your bot in Telegram (search for the username BotFather gave you) and send it a message.

## Set up Email {#email}

Email is the most powerful integration — your agent gets its own address, replies in-thread, can be CC'd on conversations, and uses the sender's email as their identity. No `/link` command needed.

### What you'll need

- A domain you control (or you can use a free Resend subdomain — see below)
- An account with **Resend** or **SendGrid** to handle inbound + outbound mail
- About 10 minutes

### Steps (with Resend — easiest)

1. Sign up at **[resend.com](https://resend.com)**. The free tier is enough to get started.
2. Pick how the agent's email address will look:
   - **Easiest:** use a free `<your-slug>.resend.app` address — no DNS needed.
   - **Branded:** add a custom domain (like `yourcompany.com`) in Resend's **Domains** page and follow the DNS steps.
3. In Resend, open **Webhooks** → **Add Endpoint** and point it at:

   ```text
   https://your-app.example.com/_agent-native/integrations/email/webhook
   ```

   Subscribe to the **`email.received`** event. Resend will give you a signing secret — copy it.

4. In your app's environment variables, set:
   - `EMAIL_AGENT_ADDRESS` — the address the agent receives mail at (e.g. `agent@yourcompany.com`)
   - `RESEND_API_KEY` — your Resend API key
   - `EMAIL_INBOUND_WEBHOOK_SECRET` — the signing secret from Resend (recommended; used for signature verification)

5. Send an email to the agent's address. It'll reply in the same thread.

### Steps (with SendGrid)

1. Sign up at **[sendgrid.com](https://sendgrid.com)**.
2. Add the MX record for your domain so inbound mail flows to SendGrid:
   ```text
   MX  yourcompany.com  →  mx.sendgrid.net  (priority 10)
   ```
3. Open **Settings → Inbound Parse**, click **Add Host & URL**, and set the destination to:

   ```text
   https://your-app.example.com/_agent-native/integrations/email/webhook
   ```

4. Set environment variables:
   - `EMAIL_AGENT_ADDRESS` — the address the agent receives at
   - `SENDGRID_API_KEY` — your SendGrid API key
   - `EMAIL_INBOUND_WEBHOOK_SECRET` — optional Svix signing secret if you've configured signed webhooks

5. Send an email to the agent's address.

### Tips

- **CC the agent** to bring it into a thread. When the agent is CC'd it will reply-all so the whole thread sees the response.
- **Threading just works** — the agent uses standard `Message-ID` / `In-Reply-To` / `References` headers, so replies stay in the right thread in any email client.
- **Identity is the sender's email.** If `alice@acme.com` emails the agent, that _is_ her identity — no link or signup flow.
- **Rich responses** — markdown in the agent's response is rendered as HTML in the email.
- **Allowed domains** — restrict who can email the agent by setting `allowedDomains` in the integration's config; messages from other domains are dropped.
- **Rate limit** — 20 inbound messages per hour per sender.

## Set up WhatsApp {#whatsapp}

### What you'll need

- A Meta (Facebook) developer account
- A phone number you can dedicate to the bot
- About 15 minutes (Meta's setup has the most steps)

### Steps

1. Go to the **[Meta Developer Portal](https://developers.facebook.com/)**, click **Create App**, and pick the **Business** type.
2. Add the **WhatsApp** product to your app and configure a phone number to use as the sender.
3. From the WhatsApp setup page, grab:
   - **Access token** (the temporary one is fine for testing; generate a permanent token before going live)
   - **Phone number ID**
4. Pick any random string to use as a verify token — you'll enter the same value in two places below.
5. In your app's environment variables, set:
   - `WHATSAPP_ACCESS_TOKEN` — your access token
   - `WHATSAPP_PHONE_NUMBER_ID` — the phone number ID
   - `WHATSAPP_VERIFY_TOKEN` — the random string you picked
6. Back in Meta's WhatsApp config, open the webhook section and set:

   ```text
   Callback URL:  https://your-app.example.com/_agent-native/integrations/whatsapp/webhook
   Verify token:  the same random string you set as WHATSAPP_VERIFY_TOKEN
   ```

   Subscribe to the `messages` field.

7. Send a WhatsApp message to the bot's phone number.

## Use Dispatch as your agent's central inbox {#dispatch}

If you're running multiple agent-native apps (mail, calendar, analytics, etc.), the recommended pattern is to set up messaging on **[Dispatch](/docs/dispatch)** (see also the [template reference](/docs/template-dispatch)) and let it route work to your domain apps over [A2A](/docs/a2a-protocol).

Why this is nice:

- **One agent, one inbox.** All your channels (Slack, email, Telegram, WhatsApp) flow into Dispatch. You only set up integrations once.
- **Dispatch delegates.** Ask "summarize last week's signups" — Dispatch calls the analytics agent. Ask "draft a reply to Alice" — Dispatch calls the mail agent.
- **Clicks, not config.** Dispatch's **Settings → Messaging** page has connect buttons for every platform with the env-var fields built in.

If you don't need an orchestrator, any single template can wire up messaging directly using the env vars on this page.

---

## For developers {#for-developers}

Everything below is the technical reference. If you've finished the setup steps above, you can stop here unless you're customizing the integration plugin or building your own adapter.

### How it works {#how-it-works}

Inbound platform webhooks use a cross-platform SQL-queue pattern so they work on every serverless host (Netlify, Vercel, Cloudflare Workers, Fly, Render, Node) without relying on platform-specific background-execution APIs.

1. The platform `POST`s to `/_agent-native/integrations/<platform>/webhook`. The handler verifies the signature, parses the payload into an `IncomingMessage`, and **inserts a row into `integration_pending_tasks`** with `status='pending'`.
2. The handler fires a fire-and-forget `POST /_agent-native/integrations/process-task` and returns `200` immediately, well inside Slack's 3-second SLA.
3. The processor endpoint runs in a **fresh function execution** with its own full timeout budget. It atomically claims the task (`pending` → `processing` via `claimPendingTask`), runs the agent loop, posts the reply through the adapter, and marks the task `completed`.
4. A recurring retry job (`startPendingTasksRetryJob`, every 60s) sweeps tasks stuck in `pending` >90s or `processing` >5min and re-fires the processor. Capped at 3 attempts, then marked `failed`.

```text
Platform → /webhook → verify + parse → INSERT pending task ──► return 200
                                                  │
                                                  └─ fetch /process-task (fire-and-forget)
                                                                │
                                                  fresh exec ──► claim → agent loop → adapter.sendResponse → completed

   (every 60s) retry job: sweep stuck tasks → re-fire /process-task (≤3 attempts)
```

Inbound and outbound conversations live in the same SQL thread, so you can continue a Slack DM from the web UI or vice versa.

#### Why this pattern (and not the platform-native shortcuts) {#why-this-pattern}

Serverless functions freeze the moment the response is sent. Anything still running — including a fire-and-forget Promise, a deferred LLM call, or an in-flight tool — gets killed mid-execution. The only way to keep an agent loop alive is to start a **new** function execution for it, which is what the self-fired `/process-task` POST does.

Do NOT use any of these alternatives:

- **Netlify Background Functions** — Netlify-only, requires a `-background.ts` filename suffix, breaks on every other host.
- **Cloudflare `event.waitUntil()`** — CF Workers only, not portable.
- **Vercel `after()` / Fluid** — Vercel-only, gated behind specific runtimes.
- **Naked fire-and-forget Promises after `return`** — silently killed when the function freezes; no error in the logs, the user just never gets a reply.

The SQL-queue + self-webhook + retry-job combination is the only thing that works identically on every supported host. The retry job is the safety net — never assume the initial dispatch flushed before the function froze.

### The integrations plugin {#plugin}

The plugin auto-mounts when no custom version exists. To customize, create:

```ts
// server/plugins/integrations.ts
import { createIntegrationsPlugin } from "@agent-native/core/server";
import { scriptRegistry } from "../../agent.config";

export default createIntegrationsPlugin({
  actions: scriptRegistry,
  systemPrompt: "You are a helpful assistant...",
});
```

Which platforms are active depends on which env vars are set. The plugin registers webhook routes for each one under `/_agent-native/integrations/`.

### Webhook URLs {#webhook-urls}

```text
/_agent-native/integrations/slack/webhook
/_agent-native/integrations/telegram/webhook
/_agent-native/integrations/whatsapp/webhook
/_agent-native/integrations/email/webhook
```

Telegram also exposes a one-time setup endpoint:

```text
POST /_agent-native/integrations/telegram/setup
```

### Environment variables {#env-vars}

| Platform | Required                                                                     | Optional                                              |
| -------- | ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| Slack    | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`                                    | `SLACK_ALLOWED_TEAM_IDS`, `SLACK_ALLOWED_API_APP_IDS` |
| Telegram | `TELEGRAM_BOT_TOKEN`                                                         | —                                                     |
| Email    | `EMAIL_AGENT_ADDRESS`, plus one of `RESEND_API_KEY` or `SENDGRID_API_KEY`    | `EMAIL_INBOUND_WEBHOOK_SECRET`                        |
| WhatsApp | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | —                                                     |

All credentials live in env vars — never the database, never source code. Use the sidebar settings UI or your hosting provider's env panel.

### Threading and identity {#threading-and-identity}

Each external conversation maps to a persistent thread in the agent-native database:

- **Slack DM** → one thread per Slack user.
- **Slack channel @mention** → one thread per channel.
- **Telegram chat** → one thread per Telegram chat.
- **WhatsApp conversation** → one thread per WhatsApp number.
- **Email** → threading derived from `Message-ID` / `In-Reply-To` / `References` headers.

External threads appear in the web UI alongside web-originated threads, tagged with their source platform. Identity resolution: when a Slack/email user matches a registered user (typically by email), they're linked to that account.

### Security {#security}

Every incoming webhook is signature-verified before processing:

- **Slack** — HMAC-SHA256 of the body using `SLACK_SIGNING_SECRET`, checked against the `X-Slack-Signature` header. The first time you save a Request URL in Slack's Event Subscriptions panel, Slack POSTs a `url_verification` challenge to it; the framework's adapter detects this and replies with the `challenge` value automatically, so the URL flips green in Slack without any extra work on your end.
- **Telegram** — secret token set when registering the webhook.
- **WhatsApp** — Meta's verification challenge (using `WHATSAPP_VERIFY_TOKEN`) plus payload signature.
- **Email** — Svix-style signature verification when `EMAIL_INBOUND_WEBHOOK_SECRET` is set (Resend and SendGrid both use this format). If the secret is unset, the webhook is accepted but a warning is logged.

The email adapter also enforces:

- **Allowed domains** — optional `allowedDomains` array in the integration's `integration_configs` row; senders outside the list are dropped.
- **Rate limit** — in-memory limiter at 20 inbound messages per sender per hour.

### Proactive sends {#proactive-sends}

The agent can send messages on its own initiative (notifications, reminders, scheduled summaries) by calling the `send-platform-message` action with a `platform` field of `"slack"`, `"telegram"`, `"whatsapp"`, or `"email"`. The action lives in the Dispatch template at `actions/send-platform-message.ts` and you can copy/adapt it for any template.

### Custom adapters {#custom-adapters}

To add a new messaging platform, implement the `PlatformAdapter` interface:

```ts
import type { PlatformAdapter } from "@agent-native/core/server";

const myAdapter: PlatformAdapter = {
  platform: "discord",

  // Verify the incoming webhook is authentic
  verifyRequest(request: Request): Promise<boolean> {
    // Validate signature headers
  },

  // Extract the message text and thread context
  parseMessage(body: unknown): Promise<{
    text: string;
    threadId: string;
    senderId: string;
    metadata?: Record<string, unknown>;
  }> {
    // Parse platform-specific payload
  },

  // Post the agent's response back
  sendResponse(threadId: string, text: string): Promise<void> {
    // Call the platform's API
  },
};
```

Register it in your integrations plugin:

```ts
export default createIntegrationsPlugin({
  actions: scriptRegistry,
  systemPrompt: "You are a helpful assistant...",
  adapters: [myAdapter],
});
```

Reference implementations live in `packages/core/src/integrations/adapters/` (`slack.ts`, `telegram.ts`, `whatsapp.ts`, `email.ts`) — the email adapter is the most complete example, including signature verification, threading, rate limiting, and HTML rendering.

### Reliability via Dispatch + A2A continuations {#reliability}

When [Dispatch](/docs/dispatch) delegates a request to another app over [A2A](/docs/a2a-protocol#continuations), the continuation-recovery flow guarantees the user gets a Slack/email reply even if the downstream agent crashes mid-execution. The original webhook task stays in `processing` until the continuation either resolves or the retry sweep marks it stuck; either way, the platform thread gets a final reply rather than going silent.

This means a multi-app workspace fronted by Dispatch is more resilient than a single template wired to messaging directly — failures in any one downstream app degrade to a graceful error message instead of a dropped reply. See [A2A continuations](/docs/a2a-protocol#continuations) for the full delivery-guarantee story.

### Common pitfalls {#pitfalls}

- **Don't double-read the request body.** h3 v2's body stream is consume-once: if you call `readBody(event)` after the framework has already parsed `event.node.req.body` (or vice versa), the second read hangs the request indefinitely. This shows up most often with Resend and SendGrid — both stream the inbound payload and the dangling read never resolves, the platform times out, and the webhook gets retried until it dedups. If you wrap the framework's webhook handler in your own middleware, pass the already-parsed `IncomingMessage` via the `incoming` option rather than letting the handler re-parse.
- **Don't run agent loops inside the webhook handler.** The handler must enqueue and return — the agent loop runs in the processor's fresh execution. Putting it inline guarantees serverless freeze kills the run.
- **Don't rely on dedup memory across cold starts.** The dedup key lives in the SQL `(platform, external_event_key)` unique index, not an in-process Map. If you replace the queue, keep the SQL-level dedup or duplicate Slack retries will trigger duplicate agent runs.
- **Keep the self-webhook URL reachable.** The processor URL is built from `APP_URL` / `URL` / `DEPLOY_URL` / `BETTER_AUTH_URL`, falling back to the inbound request headers. On preview deploys with rewritten hostnames, set one of these explicitly or the dispatch will hit a 404.

### See also {#see-also}

- [Dispatch](/docs/dispatch) — concept overview for using a central inbox across apps
- [Dispatch template reference](/docs/template-dispatch) — recommended central inbox for multi-app workspaces
- [A2A Protocol](/docs/a2a-protocol) — how Dispatch delegates work to other agents, including continuation recovery
- [Agent Mentions](/docs/agent-mentions) — `@`-mentioning agents inside the web chat
