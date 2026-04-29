---
title: "Messaging"
description: "Talk to your agent from Slack, email, Telegram, or WhatsApp — same agent, same memory, same tools."
---

# Messaging

Talk to your agent from the platforms you already use. Send a Slack DM, reply to an email, message a Telegram bot, or ping over WhatsApp — same agent, same memory, same tools, same thread history as the web chat.

## Overview {#overview}

Messaging integrations let users reach their agent from external messaging platforms instead of opening the web UI. Whichever platform a message comes in on, the agent processes it with the same system prompt, the same actions, and the same database — and replies in the same thread.

Each integration works through webhooks. The platform delivers incoming messages over HTTP, the agent processes them in the background, and the response is posted back. No polling, no long-lived connections.

> Note: this doc is specifically about platforms you can _message_ your agent over. Other kinds of integrations — Google Docs, OAuth providers, SQL databases, MCP servers, etc. — are covered in their own docs.

## How it works {#how-it-works}

The flow is the same for every platform:

1. A user sends a message on the external platform (Slack, email, Telegram, WhatsApp)
2. The platform delivers the message to your app via a webhook at `/_agent-native/integrations/<platform>/webhook`
3. The integrations plugin validates the request, extracts the message text and thread context, and maps it to an internal conversation thread
4. The agent processes the message in the background using the same pipeline as the web chat
5. The response is posted back to the external platform in the same thread

`User (Slack/Email/Telegram/WhatsApp)` → `Webhook` → `Agent Processing` → `Response posted back`

## Setup {#setup}

The integrations plugin auto-mounts when no custom version exists in your template. To customize it, create a plugin file:

```ts
// server/plugins/integrations.ts
import { createIntegrationsPlugin } from "@agent-native/core/server";
import { scriptRegistry } from "../../agent.config";

export default createIntegrationsPlugin({
  actions: scriptRegistry,
  systemPrompt: "You are a helpful assistant...",
});
```

The plugin registers webhook routes for each enabled platform under `/_agent-native/integrations/`. Which platforms are active depends on which environment variables are configured.

## Dispatch as the orchestrator {#dispatch}

Messaging integrations are most powerful when set up in the **Dispatch template** (`templates/dispatch/`). Dispatch is a central control plane that:

- Receives inbound messages from every configured platform (Slack, email, Telegram, WhatsApp) in one place
- Delegates domain-specific work to specialist agents over the [A2A protocol](/docs/a2a-protocol) via the `call-agent` action
- Sends the result back to the original platform in the same thread

The pattern is one inbox, many specialist agents. A user emails the Dispatch agent "make me a slide deck about Q3" → Dispatch delegates to the slides agent → the slides agent returns a URL → Dispatch emails the user back with the link. Same flow for analytics queries, calendar invites, content drafts, anything else you have a specialist agent for.

You don't have to use Dispatch — any template that mounts the integrations plugin can receive messages — but Dispatch is the recommended home for messaging because it can route across your whole agent fleet.

See [Dispatch template](/docs/template-dispatch) and [A2A protocol](/docs/a2a-protocol) for details.

## Slack {#slack}

### 1. Create a Slack app

Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app. Under **OAuth & Permissions**, add the following bot token scopes:

- `chat:write` — send messages
- `app_mentions:read` — receive @-mentions (optional)

### 2. Enable Event Subscriptions

Under **Event Subscriptions**, set the Request URL to:

```text
https://your-app.example.com/_agent-native/integrations/slack/webhook
```

Subscribe to the `message.im` bot event (and optionally `app_mention` for channel mentions).

### 3. Set environment variables

```bash
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
```

The bot token is found under **OAuth & Permissions** after installing the app to your workspace. The signing secret is under **Basic Information**.

## Email {#email}

The email adapter receives inbound mail via Resend or SendGrid webhooks and replies in-thread using standard `Message-ID` / `In-Reply-To` / `References` headers. Sender email addresses are treated as identities — if a user emails the agent from `alice@acme.com`, that maps directly to the workspace user with that email.

Adapter file: `packages/core/src/integrations/adapters/email.ts`

### 1. Set environment variables

```bash
EMAIL_AGENT_ADDRESS=agent@your-domain.com
# Configure ONE of these (Resend or SendGrid):
RESEND_API_KEY=re_...
SENDGRID_API_KEY=SG...
# Optional — recommended for production:
EMAIL_INBOUND_WEBHOOK_SECRET=your-shared-secret
```

`EMAIL_AGENT_ADDRESS` is the address users send mail to. Set either `RESEND_API_KEY` _or_ `SENDGRID_API_KEY` — whichever provider you use. `EMAIL_INBOUND_WEBHOOK_SECRET` enables Svix signature verification (Resend) or basic-auth / `x-webhook-secret` header verification (SendGrid).

### 2. Configure the webhook URL

```text
https://your-app.example.com/_agent-native/integrations/email/webhook
```

### 3. Provider setup — Resend

Two options for the agent address:

- **Free `<slug>.resend.app` address** — no DNS setup required. Pick a slug in the Resend dashboard and your agent gets `agent@<slug>.resend.app`.
- **Custom domain** — add MX records pointing to Resend per the dashboard's instructions.

Then in the Resend dashboard:

1. Go to **Webhooks** → **Add Endpoint**
2. Set the URL to `https://your-app.example.com/_agent-native/integrations/email/webhook`
3. Subscribe to the `email.received` event
4. Copy the signing secret into `EMAIL_INBOUND_WEBHOOK_SECRET`

### 3. Provider setup — SendGrid

1. In your DNS, add an MX record for the agent's domain pointing to `mx.sendgrid.net` (priority 10)
2. In the SendGrid dashboard, go to **Settings** → **Inbound Parse** → **Add Host & URL**
3. Set the host to your domain and the destination URL to `https://your-app.example.com/_agent-native/integrations/email/webhook`
4. (Recommended) Set basic auth or a custom `x-webhook-secret` header matching `EMAIL_INBOUND_WEBHOOK_SECRET`

### Threading and CC behavior

- **Threading** uses the standard email headers: the agent's reply sets `In-Reply-To` to the inbound `Message-ID` and accumulates the `References` chain. Most clients (Gmail, Outlook, Apple Mail) thread the conversation automatically.
- **Direct vs CC'd** — the adapter detects whether the agent was in `To` (directly addressed) or `Cc` (overheard). When CC'd, the agent's reply goes to all original recipients (reply-all). The Dispatch system prompt also instructs the agent to only respond when input is clearly being requested, so it stays out of the way on threads it's only copied on.
- **Identity** — the sender's email address is the identity. It maps directly to a workspace user with that email; the agent acts on behalf of that user.

### Rich responses

Agent replies render as HTML email. The adapter converts markdown to HTML (headings, lists, links, bold, inline code, paragraphs) and wraps it in a minimal styled template, with a plain-text fallback. So tables, bullet lists, and links from the agent come through as proper rich email — not raw markdown.

### Rate limiting and allowed domains

- **Rate limit** — 20 inbound messages per sender per hour, enforced in-memory per process. Excess messages are dropped.
- **Allowed domains** — the `integration_configs` row for `email` accepts an optional `allowedDomains: string[]`. When set, only senders whose domain is in the list are accepted. Use this to restrict the agent to a specific company or tenant.

### Proactive sends

The agent can email users on its own (not just reply) by calling the `send-platform-message` action with `platform: "email"`. Useful for digest emails, alerts, or follow-ups from automations and recurring jobs.

## Telegram {#telegram}

### 1. Create a bot

Message [@BotFather](https://t.me/BotFather) on Telegram and use the `/newbot` command. You will receive a bot token.

### 2. Set environment variables

```bash
TELEGRAM_BOT_TOKEN=your-bot-token
```

### 3. Register the webhook

After deploying your app, call the setup endpoint to register the webhook with Telegram:

```text
// The integrations plugin exposes a setup endpoint
POST /_agent-native/integrations/telegram/setup

// This calls Telegram's setWebhook API pointing to:
// https://your-app.example.com/_agent-native/integrations/telegram/webhook
```

You can also register the webhook manually using the Telegram Bot API if you prefer.

## WhatsApp {#whatsapp}

### 1. Set up the WhatsApp Cloud API

Go to the [Meta Developer Portal](https://developers.facebook.com/), create an app, and enable the WhatsApp product. Configure a phone number for your business.

### 2. Set environment variables

```bash
WHATSAPP_ACCESS_TOKEN=your-access-token
WHATSAPP_VERIFY_TOKEN=your-verify-token
WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id
```

The verify token is a string you choose — Meta uses it during webhook verification. The access token and phone number ID come from the Meta Developer Portal.

### 3. Configure the webhook

In the Meta Developer Portal, set the webhook URL to:

```text
https://your-app.example.com/_agent-native/integrations/whatsapp/webhook
```

Subscribe to the `messages` webhook field.

## Configuration {#configuration}

Integrations can be managed from the settings UI in the sidebar. Each platform shows its connection status and webhook URL. You can enable/disable individual integrations without removing environment variables.

The webhook URLs follow a consistent pattern:

```text
/_agent-native/integrations/<platform>/webhook

# Examples:
/_agent-native/integrations/slack/webhook
/_agent-native/integrations/email/webhook
/_agent-native/integrations/telegram/webhook
/_agent-native/integrations/whatsapp/webhook
```

## Thread continuity {#thread-continuity}

Conversations from external platforms are mapped to internal threads. Each Slack DM, email thread, Telegram chat, or WhatsApp conversation becomes a persistent thread in the agent-native database. This means:

- The agent retains context across messages in the same external conversation
- External conversations appear in the web UI alongside web-originated threads, tagged with their source platform
- You can continue a conversation that started in Slack from the web UI, or vice versa

For email specifically, threading uses the `Message-ID`, `In-Reply-To`, and `References` headers — the oldest Message-ID in the References chain is treated as the thread root, matching Gmail's behavior.

## Custom adapters {#custom-adapters}

To add support for a new messaging platform, implement the `PlatformAdapter` interface:

```ts
import type { PlatformAdapter } from "@agent-native/core/server";

const myAdapter: PlatformAdapter = {
  platform: "discord",

  // Verify the incoming webhook request is authentic
  verifyRequest(request: Request): Promise<boolean> {
    // Validate signature headers
  },

  // Extract the message text and thread context from the webhook payload
  parseMessage(body: unknown): Promise<{
    text: string;
    threadId: string;
    senderId: string;
    metadata?: Record<string, unknown>;
  }> {
    // Parse platform-specific payload
  },

  // Send the agent's response back to the platform
  sendResponse(threadId: string, text: string): Promise<void> {
    // Call the platform's API to post the message
  },
};
```

Register your adapter in the integrations plugin config:

```ts
export default createIntegrationsPlugin({
  actions: scriptRegistry,
  systemPrompt: "You are a helpful assistant...",
  adapters: [myAdapter],
});
```

## Security {#security}

Every incoming webhook is verified before processing:

- **Slack** — HMAC-SHA256 signature verification using `SLACK_SIGNING_SECRET`. The `X-Slack-Signature` header is checked against the request body.
- **Email (Resend)** — Svix signature verification using `EMAIL_INBOUND_WEBHOOK_SECRET`, with a 5-minute replay window.
- **Email (SendGrid)** — basic auth or `x-webhook-secret` header matching `EMAIL_INBOUND_WEBHOOK_SECRET`. Plus optional `allowedDomains` filtering on the sender.
- **Telegram** — requests are validated by checking the secret token set during webhook registration via the Telegram Bot API.
- **WhatsApp** — Meta's webhook verification challenge (using `WHATSAPP_VERIFY_TOKEN`) and payload signature validation.

All platform credentials (tokens, secrets, API keys) are stored as environment variables and never persisted in the database or source code. Use the settings UI or your deployment platform's env var management to configure them.
