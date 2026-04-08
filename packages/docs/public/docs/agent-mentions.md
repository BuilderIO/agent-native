---
title: "Agent Mentions"
description: "Tag other agents and files in chat with @-mentions for cross-agent collaboration."
---

# Agent Mentions

Type `@` in the chat composer to mention agents, files, and resources. Mentioning an agent triggers an A2A call and weaves the response into your conversation.

## Overview {#overview}

The `@`-mention system connects the chat composer to the broader agent ecosystem. When you type `@`, a popover appears listing available agents, codebase files, and resources. Selecting an agent sends a cross-agent request via the [A2A protocol](/docs/a2a-protocol), and the response is embedded directly in the conversation for your main agent to use.

This is how you orchestrate multi-agent workflows from a single chat. Ask your mail agent to draft an email, `@analytics` to pull in the latest numbers, and the mail agent incorporates those numbers into the draft — all in one conversation.

## Mentioning agents {#mentioning-agents}

To mention an agent in the chat composer:

1. Type `@` to open the mention popover
2. Browse or search the list of available agents
3. Select an agent — it appears as a tag in your message
4. Send the message — the server calls the mentioned agent via A2A and includes its response in the conversation context

The mentioned agent receives the relevant portion of your message, runs its tools and actions, and returns a response. Your main agent sees the response and can reference or build on it.

## How it works {#how-it-works}

When a message containing an `@`-mention is sent, the following happens on the server:

1. The server extracts mention references from the message
2. For each mentioned agent, an A2A call is made to that agent's endpoint
3. The agent's response is wrapped in an `<agent-response>` XML block and injected into the conversation context
4. The main agent processes the enriched message, seeing both the user's text and the mentioned agent's response

```text
// What the main agent sees in its context:
User: Draft an email with the latest signup numbers. @analytics

<agent-response agent="analytics">
Last week's signups: 1,247 total
  - Organic: 623
  - Paid: 412
  - Referral: 212
</agent-response>
```

The main agent can then use this data naturally in its response — for example, incorporating the numbers into an email draft.

## Adding agents {#adding-agents}

Agents become available for mentioning through several mechanisms:

- **Auto-discovery** — the framework automatically discovers agents running on known ports or configured URLs
- **Resources panel** — add agent manifests as `agents/*.json` files in the resources panel
- **Environment variables** — configure agent URLs and API keys via env vars

An agent manifest looks like this:

```json
// agents/analytics.json
{
  "name": "Analytics Agent",
  "url": "https://analytics.example.com",
  "apiKey": "env:ANALYTICS_A2A_KEY",
  "description": "Runs analytics queries and returns data",
  "skills": ["run-query", "generate-chart"]
}
```

The `"apiKey": "env:ANALYTICS_A2A_KEY"` syntax reads the value from the environment variable at runtime, keeping secrets out of the manifest file.

## Custom mention providers {#custom-mention-providers}

Templates can register custom mention providers to add domain-specific mentionable items beyond agents and files. A mention provider implements the `MentionProvider` interface:

```ts
import type { MentionProvider } from "@agent-native/core/server";

const contactsProvider: MentionProvider = {
  id: "contacts",
  label: "Contacts",

  // Search for mentionable items
  async search(query: string) {
    const contacts = await db.query.contacts.findMany({
      where: like(contacts.name, `%${query}%`),
      limit: 10,
    });
    return contacts.map((c) => ({
      id: c.id,
      label: c.name,
      description: c.email,
      type: "contact",
    }));
  },

  // Resolve a mention into context for the agent
  async resolve(id: string) {
    const contact = await db.query.contacts.findFirst({
      where: eq(contacts.id, id),
    });
    return {
      type: "context",
      text: `Contact: ${contact.name} (${contact.email})`,
    };
  },
};
```

Register providers in the agent-chat plugin configuration:

```ts
// server/plugins/agent-chat.ts
import { createAgentChatPlugin } from "@agent-native/core/server";

export default createAgentChatPlugin({
  actions: scriptRegistry,
  systemPrompt: "You are a helpful assistant...",
  mentionProviders: [contactsProvider],
});
```

Custom mention providers appear alongside the built-in agent and file providers in the mention popover.

## Referencing files {#referencing-files}

The `@` popover is not limited to agents. You can also reference:

- **Codebase files** — type `@` and search for a filename. The file contents are included in the agent's context so it can read, analyze, or modify the file.
- **Resources** — reference resources defined in the resources panel. These can be data files, configuration, or any other structured content.
- **Skills** — type `/` to reference a skill. Skills provide structured instructions that guide how the agent approaches a task.

All reference types follow the same pattern: select from the popover, and the referenced content is resolved and injected into the agent's context when the message is sent.
