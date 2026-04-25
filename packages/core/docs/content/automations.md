---
title: "Automations"
description: "Event-triggered and scheduled automations with natural-language conditions"
---

# Automations

An **automation** is a rule: _when X happens, do Y_ — described in natural language. The agent executes the instructions, so automations have access to every action, tool, and MCP server the agent can use in an interactive chat.

Automations extend [recurring jobs](/docs/recurring-jobs) with **event triggers**, **natural-language conditions**, and **outbound HTTP** via the `web-request` tool. They live as markdown resources under `jobs/` — the same storage and format as recurring jobs, with extra frontmatter fields.

## Two trigger types {#trigger-types}

| Type       | Fires when                                             | Key field         |
| ---------- | ------------------------------------------------------ | ----------------- |
| `schedule` | A cron expression matches (same as recurring jobs)     | `schedule` (cron) |
| `event`    | A matching event is emitted on the framework event bus | `event` (name)    |

Event triggers can include a `condition` — a natural-language string evaluated by Haiku against the event payload before dispatch. If the condition doesn't match, the automation is silently skipped.

## Creating automations {#creating}

### By asking the agent

> "When someone books a meeting with a @builder.io email, message me in Slack."

The agent discovers available events, confirms the plan, and writes the automation for you.

### From the settings UI

Automations appear in the settings panel. Users can view, enable/disable, and delete them there.

### Via the API

Write a `jobs/<name>.md` resource directly:

```ts
import { resourcePut } from "@agent-native/core/resources";

await resourcePut(
  ownerEmail,
  "jobs/slack-on-builder-booking.md",
  `---
schedule: ""
enabled: true
triggerType: event
event: calendar.booking.created
condition: "attendee email ends with @builder.io"
mode: agentic
domain: calendar
createdBy: steve@builder.io
runAs: creator
---

Send a Slack message to #sales with the booking details.
Use the web-request tool to POST to \${keys.SLACK_WEBHOOK}.`,
);
```

## The markdown format {#format}

Each automation is a markdown file with YAML frontmatter and a body containing natural-language instructions.

### Frontmatter fields {#frontmatter}

| Field         | Type                                                   | Default      | Description                                          |
| ------------- | ------------------------------------------------------ | ------------ | ---------------------------------------------------- |
| `schedule`    | cron expression                                        | `""`         | Cron expression (required for schedule triggers)     |
| `enabled`     | boolean                                                | `true`       | Whether the automation is active                     |
| `triggerType` | `"schedule"` \| `"event"`                              | `"schedule"` | How the automation fires                             |
| `event`       | string                                                 | _(optional)_ | Event name to subscribe to (event triggers only)     |
| `condition`   | string                                                 | _(optional)_ | Natural-language condition evaluated before dispatch |
| `mode`        | `"agentic"` \| `"deterministic"`                       | `"agentic"`  | Full agent loop vs. fixed action set                 |
| `domain`      | string                                                 | _(optional)_ | Grouping tag (mail, calendar, clips, etc.)           |
| `createdBy`   | email                                                  | _(auto)_     | Owner email                                          |
| `orgId`       | string                                                 | _(auto)_     | Org scope; inherited from the creator's active org   |
| `runAs`       | `"creator"` \| `"shared"`                              | `"creator"`  | Whose API key and permissions to use                 |
| `lastRun`     | ISO timestamp                                          | _(managed)_  | Written by the dispatcher after each run             |
| `lastStatus`  | `"success"` \| `"error"` \| `"running"` \| `"skipped"` | _(managed)_  | Latest outcome                                       |
| `lastError`   | string                                                 | _(managed)_  | Error message if the last run failed                 |

## The event bus {#event-bus}

Integrations register events at module load time. The bus validates payloads against [Standard Schema](https://standardschema.dev) definitions and dispatches to subscribers.

### Built-in events {#built-in-events}

| Event                  | Source                                         |
| ---------------------- | ---------------------------------------------- |
| `test.event.fired`     | Manual / `manage-automations` action=fire-test |
| `agent.turn.completed` | Agent chat                                     |
| `calendar.*`           | Calendar integration                           |
| `clip.*`               | Clips integration                              |
| `mail.*`               | Mail integration                               |

Call `manage-automations` with `action=list-events` from the agent to see all registered events with descriptions and payload schemas for the current template.

### Emitting custom events {#emitting-events}

Register an event type in a server plugin, then emit it from actions or webhook handlers:

```ts
import { registerEvent, emit } from "@agent-native/core/event-bus";
import { z } from "zod";

// Register the event type (once, at module load)
registerEvent({
  name: "order.completed",
  description: "A customer completed an order",
  payloadSchema: z.object({
    orderId: z.string(),
    customerEmail: z.string(),
    total: z.number(),
  }),
  example: {
    orderId: "ord_123",
    customerEmail: "jane@example.com",
    total: 49.99,
  },
});

// Emit the event (from an action, webhook handler, etc.)
emit(
  "order.completed",
  {
    orderId: "ord_123",
    customerEmail: "jane@example.com",
    total: 49.99,
  },
  { owner: "steve@builder.io" },
);
```

The `owner` in the emit metadata scopes which automations fire — only automations owned by the same user (or shared automations) are evaluated.

## Conditions {#conditions}

Conditions are natural-language strings evaluated by Claude Haiku against the event payload. This is a yes/no classification, not a generation task.

- **Empty or missing condition** = unconditional (always fires).
- Results are memoized (SHA-256 of condition + payload) with a 5-minute TTL and 500-entry LRU cache.
- Payload is truncated to 4000 characters before sending to Haiku.
- On API failure, the condition evaluates to `false` (safe default — the automation is skipped).

Examples of conditions:

- `"attendee email ends with @builder.io"`
- `"the order total is greater than $100"`
- `"the message contains the word 'urgent'"`

## The web-request tool {#web-request}

Automations use the `web-request` tool for outbound HTTP. It supports `${keys.NAME}` placeholders in the URL, headers, and body:

```
POST to ${keys.SLACK_WEBHOOK}

Headers: {"Authorization": "Bearer ${keys.API_TOKEN}"}

Body: {"text": "New booking from ${attendeeEmail}"}
```

Placeholders are resolved **server-side** after the agent emits the tool call — the raw secret value never enters the agent's context.

### Parameters {#web-request-params}

| Parameter    | Type   | Default | Description                                         |
| ------------ | ------ | ------- | --------------------------------------------------- |
| `url`        | string | —       | Full URL. May contain `${keys.NAME}` references.    |
| `method`     | string | `GET`   | HTTP method (GET, POST, PUT, PATCH, DELETE, HEAD).  |
| `headers`    | string | `{}`    | JSON object of headers. May contain `${keys.NAME}`. |
| `body`       | string | —       | Request body. May contain `${keys.NAME}`.           |
| `timeout_ms` | number | 15000   | Timeout in milliseconds (max 30000).                |

## Keys {#keys}

Keys are ad-hoc secrets created by users or the agent for automation use (e.g. `SLACK_WEBHOOK`, `HUBSPOT_API_KEY`). They differ from registered secrets (`registerRequiredSecret`) in that they have no template-defined metadata or onboarding step.

- Created via the settings UI or the `/_agent-native/secrets/adhoc` API.
- Each key can have a **URL allowlist** that restricts which origins the key can be sent to (origin-level matching).
- The raw value is never exposed to the AI — only `${keys.NAME}` placeholders appear in the agent's context.
- Resolution falls back from user scope to workspace scope, so users can override shared keys.

## Agent tools {#agent-tools}

All automation operations are accessed through a single `manage-automations` tool with an `action` parameter:

| Action        | Purpose                                                              |
| ------------- | -------------------------------------------------------------------- |
| `list-events` | Discover all registered events with descriptions and payload schemas |
| `list`        | List all automations with status; filter by domain or enabled        |
| `define`      | Create a new automation (name, trigger type, event, condition, body) |
| `update`      | Update an existing automation (enabled, condition, body)             |
| `delete`      | Delete an automation (always confirms with user first)               |
| `fire-test`   | Emit a `test.event.fired` event to validate automations              |

Additional tool: `web-request` — outbound HTTP with `${keys.NAME}` substitution.

## API endpoints {#api}

| Endpoint                               | Method | Description                     |
| -------------------------------------- | ------ | ------------------------------- |
| `/_agent-native/automations`           | GET    | List all automations (parsed)   |
| `/_agent-native/automations/fire-test` | POST   | Emit a `test.event.fired` event |
| `/_agent-native/secrets/adhoc`         | GET    | List ad-hoc keys (no values)    |
| `/_agent-native/secrets/adhoc`         | POST   | Create or update an ad-hoc key  |
| `/_agent-native/secrets/adhoc/:name`   | DELETE | Delete an ad-hoc key            |

## How dispatch works {#dispatch}

1. The trigger dispatcher subscribes to events at server startup.
2. When an event fires, the dispatcher loads all enabled event-triggered automations matching that event name.
3. Ownership scoping: only automations owned by the event's owner (or shared automations) are evaluated.
4. For each matching automation, the condition (if any) is evaluated by Haiku.
5. If the condition passes, the dispatcher runs a full `runAgentLoop` with the automation body as the prompt and the event payload as context.
6. The agent has access to all tools — actions, `web-request`, MCP servers, sub-agents.
7. On completion, `lastRun`, `lastStatus`, and `lastError` are written back to the resource frontmatter.
8. A 5-minute timeout prevents runaway automations.

## Example {#example}

**User:** "When someone books with a @builder.io email, message me in Slack."

**Agent flow:**

1. Calls `manage-automations` with `action=list-events` — finds `calendar.booking.created`.
2. Confirms the plan with the user.
3. Calls `manage-automations` with `action=define`:
   - `name`: `slack-on-builder-booking`
   - `trigger_type`: `event`
   - `event`: `calendar.booking.created`
   - `condition`: `attendee email ends with @builder.io`
   - `mode`: `agentic`
   - `domain`: `calendar`
   - `body`: `Send a Slack message to #sales with the booking details. Use the web-request tool to POST to ${keys.SLACK_WEBHOOK}.`
4. The automation is saved as `jobs/slack-on-builder-booking.md` and begins listening immediately.

## What's next

- [**Recurring Jobs**](/docs/recurring-jobs) — schedule-triggered automations reuse the same scheduler
- [**Actions**](/docs/actions) — automations can call any registered action via the agent loop
- [**Security**](/docs/security) — input validation and secret handling
