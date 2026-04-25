---
name: automations
description: >-
  Event-triggered and schedule-triggered automations with natural-language
  conditions. Use when creating automations, wiring events, or understanding
  how triggers fire.
---

# Automations

## Rule

Automations are agent-executed tasks that fire in response to events or on a cron schedule. Each automation is a markdown resource under `jobs/` with YAML frontmatter describing when and how it fires, and a body containing natural-language instructions the agent follows. Automations extend the recurring-jobs system with event triggers, natural-language condition evaluation, and outbound HTTP via the `web-request` tool.

## The Two Trigger Types

| Type       | Fires when                                      | Key field           |
| ---------- | ----------------------------------------------- | ------------------- |
| `schedule` | Cron expression matches (same as recurring jobs) | `schedule` (cron)   |
| `event`    | A matching event is emitted on the event bus     | `event` (event name) |

Event triggers can optionally include a `condition` -- a natural-language string evaluated by Haiku against the event payload before dispatch. If the condition does not match, the automation is skipped.

## How It Works

1. User asks the agent to create an automation (or uses the settings UI).
2. Agent calls `manage-automations` with `action=list-events` to discover available events.
3. Agent calls `manage-automations` with `action=define` to write a `jobs/<name>.md` resource.
4. The trigger dispatcher subscribes to the event on the bus.
5. When the event fires, the dispatcher loads all matching triggers, evaluates conditions via Haiku, and dispatches matching ones.
6. In `agentic` mode, the dispatcher runs a full `runAgentLoop` with the automation body as the prompt and the event payload as context.
7. Status (`lastRun`, `lastStatus`, `lastError`) is written back to the resource frontmatter.

## Markdown Format

```yaml
---
schedule: "0 9 * * 1-5"
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
Use the web-request tool with ${keys.SLACK_WEBHOOK}.
```

### Frontmatter Fields

| Field         | Type                           | Purpose                                                |
| ------------- | ------------------------------ | ------------------------------------------------------ |
| `schedule`    | `string`                       | Cron expression (required for schedule triggers)       |
| `enabled`     | `boolean`                      | Whether the automation is active                       |
| `triggerType` | `"schedule" \| "event"`        | How the automation fires                               |
| `event`       | `string?`                      | Event name to subscribe to (event triggers)            |
| `condition`   | `string?`                      | Natural-language condition evaluated before dispatch   |
| `mode`        | `"agentic" \| "deterministic"` | Full agent loop vs. fixed action set                   |
| `model`       | `string?`                      | Override the model for this trigger's agent loop       |
| `domain`      | `string?`                      | Grouping tag (mail, calendar, clips, etc.)             |
| `createdBy`   | `string?`                      | Owner email                                            |
| `orgId`       | `string?`                      | Org scope                                              |
| `runAs`       | `"creator" \| "shared"`        | Whose API key and permissions to use                   |
| `lastRun`     | `string?`                      | ISO timestamp of last execution                        |
| `lastStatus`  | `string?`                      | `success`, `error`, `running`, or `skipped`            |
| `lastError`   | `string?`                      | Error message from last failed run                     |

## Agent Tools

All automation operations are accessed through a single `manage-automations` tool with an `action` parameter:

| Action        | Purpose                                                              |
| ------------- | -------------------------------------------------------------------- |
| `list-events` | Discover all registered events with descriptions and payload schemas |
| `list`        | List all automations with status, filter by domain or enabled        |
| `define`      | Create a new automation (name, trigger type, event, condition, body)  |
| `update`      | Update an existing automation (enabled, condition, body)             |
| `delete`      | Delete an automation (always confirm with user first)                |
| `fire-test`   | Emit a `test.event.fired` event to validate automations              |

Additional tool: `web-request` — outbound HTTP with `${keys.NAME}` substitution.

## The Event Bus

Integrations register events at module load time. The bus validates payloads against Standard Schema definitions and dispatches to subscribers.

```ts
import { registerEvent, emit } from "@agent-native/core/event-bus";
import { z } from "zod";

// Register an event type (typically in a server plugin)
registerEvent({
  name: "calendar.booking.created",
  description: "A new calendar booking was created",
  payloadSchema: z.object({
    bookingId: z.string(),
    attendeeEmail: z.string(),
    startTime: z.string(),
  }),
  example: { bookingId: "abc", attendeeEmail: "jane@co.com", startTime: "2025-01-15T10:00:00Z" },
});

// Emit the event (from an action, webhook handler, etc.)
emit("calendar.booking.created", {
  bookingId: "abc",
  attendeeEmail: "jane@co.com",
  startTime: "2025-01-15T10:00:00Z",
}, { owner: "steve@builder.io" });
```

### Built-in Events

| Event                     | Source              |
| ------------------------- | ------------------- |
| `test.event.fired`        | Manual / manage-automations action=fire-test |
| `agent.turn.completed`    | Agent chat          |
| `calendar.*`              | Calendar integration |
| `clip.*`                  | Clips integration   |
| `mail.*`                  | Mail integration    |

### Event Bus API

| Function         | Purpose                                     |
| ---------------- | ------------------------------------------- |
| `registerEvent`  | Declare an event type with schema           |
| `emit`           | Fire an event (validates payload)           |
| `subscribe`      | Listen for an event (returns subscription ID) |
| `unsubscribe`    | Remove a subscription by ID                 |
| `listEvents`     | List all registered event definitions       |

## Condition Evaluator

When an automation has a `condition`, the dispatcher calls Haiku (claude-haiku-4-5) to classify whether the event payload satisfies the condition. This is a yes/no classification, not a generation task.

- Empty or missing condition = unconditional (always fires).
- Results are memoized (SHA-256 of condition + payload) with a 5-minute TTL and 500-entry LRU cache.
- Payload is truncated to 4000 characters before sending to Haiku.
- On API failure, the condition evaluates to `false` (safe default -- skips the automation).

## The `web-request` Tool and Keys

Automations use the `web-request` tool for outbound HTTP. It supports `${keys.NAME}` placeholders in the URL, headers, and body. These are resolved server-side after the agent emits the tool call -- the raw secret value never enters the agent's context.

- Keys are ad-hoc secrets created by the user via the settings UI or the `/_agent-native/secrets/adhoc` API.
- Each key can have a URL allowlist that restricts which origins the key can be sent to.
- `resolveKeyReferences()` resolves placeholders, falling back from user scope to workspace scope.
- `validateUrlAllowlist()` checks the resolved URL against per-key allowlists (origin-level matching).

## UI

Automations appear in the settings panel under an "Automations" section. Users can view, enable/disable, and delete automations from there. Creation typically happens through the agent chat.

## Example

User: "When someone books a meeting with a @builder.io email, message me in Slack."

Agent flow:

1. Calls `manage-automations` with `action=list-events` to find `calendar.booking.created`.
2. Confirms the plan with the user.
3. Calls `manage-automations` with `action=define`:
   - `name`: `slack-on-builder-booking`
   - `trigger_type`: `event`
   - `event`: `calendar.booking.created`
   - `condition`: `attendee email ends with @builder.io`
   - `mode`: `agentic`
   - `domain`: `calendar`
   - `body`: `Send a Slack message to #sales with the booking details. Use the web-request tool to POST to ${keys.SLACK_WEBHOOK}.`

## Key Files

| File                                           | Purpose                                          |
| ---------------------------------------------- | ------------------------------------------------ |
| `packages/core/src/triggers/types.ts`          | `TriggerFrontmatter` interface                   |
| `packages/core/src/triggers/actions.ts`        | Agent tools (define, list, update, delete, test)  |
| `packages/core/src/triggers/dispatcher.ts`     | Event subscription and agentic dispatch          |
| `packages/core/src/triggers/condition-evaluator.ts` | Haiku condition classification with caching |
| `packages/core/src/event-bus/`                 | Event bus (register, emit, subscribe)            |
| `packages/core/src/tools/fetch-tool.ts`        | `web-request` tool with key substitution         |
| `packages/core/src/secrets/substitution.ts`    | `resolveKeyReferences()` and `validateUrlAllowlist()` |

## Related Skills

- `recurring-jobs` -- schedule-triggered automations reuse the same scheduler
- `secrets` -- ad-hoc keys and `${keys.NAME}` substitution
- `actions` -- automations can call any registered action via the agent loop
- `delegate-to-agent` -- agentic mode runs a full `runAgentLoop`
