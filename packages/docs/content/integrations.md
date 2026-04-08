---
title: "Integrations"
description: "Connect your agent to Slack, Telegram, WhatsApp, and other messaging platforms."
---

# Integrations

Connect your agent to messaging platforms so you can chat with it from Slack, Telegram, WhatsApp, and more. Same agent, same tools, same thread history.

## Overview {#overview}

Messaging integrations let users talk to their agent from the platforms they already use. Instead of opening the web UI, you send a message in Slack or Telegram and the agent responds right there. It has access to the same actions, the same database, and the same conversation history as the web chat.

Each integration works through webhooks. The messaging platform sends incoming messages to your app, the agent processes them, and the response is posted back. No polling, no long-lived connections — just standard HTTP webhooks.

## How it works {#how-it-works}

The flow for every platform follows the same pattern:

1. A user sends a message on the external platform (Slack, Telegram, etc.)
2. The platform delivers the message to your app via a webhook at `/_agent-native/integrations/<platform>/webhook`
3. The integrations plugin validates the request, extracts the message text and thread context, and maps it to an internal conversation thread
4. The agent processes the message in the background using the same pipeline as the web chat — same system prompt, same actions, same tools
5. The response is posted back to the external platform in the same thread

`User (Slack/Telegram/WhatsApp)` → `Webhook` → `Agent Processing` → `Response posted back`

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

```
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
```

The bot token is found under **OAuth & Permissions** after installing the app to your workspace. The signing secret is under **Basic Information**.

## Telegram {#telegram}

### 1. Create a bot

Message [@BotFather](https://t.me/BotFather) on Telegram and use the `/newbot` command. You will receive a bot token.

### 2. Set environment variables

```
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

```
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
/_agent-native/integrations/telegram/webhook
/_agent-native/integrations/whatsapp/webhook
```

## Thread continuity {#thread-continuity}

Conversations from external platforms are mapped to internal threads. Each Slack DM, Telegram chat, or WhatsApp conversation becomes a persistent thread in the agent-native database. This means:

- The agent retains context across messages in the same external conversation
- External conversations appear in the web UI alongside web-originated threads, tagged with their source platform
- You can continue a conversation that started in Slack from the web UI, or vice versa

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
- **Telegram** — requests are validated by checking the secret token set during webhook registration via the Telegram Bot API.
- **WhatsApp** — Meta's webhook verification challenge (using `WHATSAPP_VERIFY_TOKEN`) and payload signature validation.

All platform credentials (tokens, secrets) are stored as environment variables and never persisted in the database or source code. Use the settings UI or your deployment platform's env var management to configure them.
