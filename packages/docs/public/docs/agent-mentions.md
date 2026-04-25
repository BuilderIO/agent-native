---
title: "Agent Mentions"
description: "Tag custom agents, connected agents, and files in chat with @-mentions."
---

# Agent Mentions

Type `@` in the chat composer to mention custom agents, connected agents, files, and resources.

## Overview {#overview}

The `@`-mention system connects the chat composer to the broader agent ecosystem. When you type `@`, a popover appears listing available custom agents, connected agents, codebase files, and resources.

This is how you orchestrate multi-agent workflows from a single chat. Ask your local `@design` agent to critique a layout, `@analytics` to pull in the latest numbers from another app, and the main agent can incorporate both in one conversation.

## Mentioning agents {#mentioning-agents}

To mention an agent in the chat composer:

1. Type `@` to open the mention popover
2. Browse or search the list of available agents
3. Select an agent — it appears as a tag in your message
4. Send the message — the server resolves the mention and includes that agent's response in the conversation context

There are two agent paths:

- **Custom agents** — local workspace agent profiles in `agents/*.md`. These run inside the current app/runtime using the agent profile's instructions and optional model override.
- **Connected agents** — remote A2A peers. These are called over the [A2A protocol](/docs/a2a-protocol).

In both cases, your main agent sees the response and can reference or build on it.

## How it works {#how-it-works}

When a message containing an `@`-mention is sent, the following happens on the server:

1. The server extracts mention references from the message
2. For each mentioned agent:
   - custom agents run locally with their profile instructions
   - connected agents are called via A2A
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

- **Custom workspace agents** — create agent profiles in the Workspace tab as `agents/*.md`
- **Auto-discovery** — the framework automatically discovers connected agents running on known ports or configured URLs
- **Remote manifests** — add connected-agent manifests as `agents/*.json`

### Custom workspace agents

Custom agents are Markdown resources:

```markdown
---
name: Design
description: >-
  Reviews layouts, product UX, and visual direction.
model: inherit
tools: inherit
delegate-default: false
---

# Role

You are a focused design agent.
```

You can create them from the Workspace tab using:

- `Create Agent` -> `Describe It`
- `Create Agent` -> `Fill Form`

### Connected-agent manifests

Remote A2A agents still use JSON manifests:

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
- **Workspace resources** — reference files defined in the Workspace tab. These can be data files, configuration, or any other structured content.
- **Skills** — type `/` to reference a skill. Skills provide structured instructions that guide how the agent approaches a task.

All reference types follow the same pattern: select from the popover, and the referenced content is resolved and injected into the agent's context when the message is sent.

## Sub-agent selection {#sub-agent-selection}

The main agent can also use custom agents when spawning sub-agents with `agent-teams` (action: "spawn").

Pass the `agent` parameter to choose a profile from `agents/*.md`. That profile's instructions are added to the delegated run, and its `model` frontmatter can override the default model for that sub-agent.
