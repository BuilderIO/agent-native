---
name: automations
description: >-
  Manual, event-triggered, and schedule-triggered automations with optional
  event conditions. Use when creating automations, wiring events, running one
  on demand, or understanding how triggers fire.
metadata:
  internal: true
---

# Automations

## Rule

Automations are the user-facing umbrella for agent-executed tasks that run on
demand, in response to events, or on a cron schedule. **Schedule**, **Event**,
and **Manual** are the three persisted trigger types. Each automation is a
markdown resource under `jobs/` with YAML frontmatter describing when and how
it fires, and a body containing natural-language instructions the agent follows.

Recurring Jobs is the legacy name and API for scheduled automations.
`manage-jobs`, `jobs/`, and `/agent#jobs` remain stable compatibility surfaces.
Use `manage-automations` for new personal or organization automations, including
per-automation model overrides and MCP allowlists. Keep `manage-jobs` for
existing schedule-only integrations and delivery metadata.

## The Three Persisted Trigger Types

| Type | Fires when | Trigger-specific fields |
| --- | --- | --- |
| `schedule` | Cron expression matches (same as recurring jobs) | `schedule` (required), `timezone` |
| `event` | A matching event is emitted on the event bus | `event` (required), `condition` (optional) |
| `manual` | A user explicitly invokes `run-now` | None |

Event triggers can optionally include a `condition` -- a natural-language
string evaluated against the event payload before dispatch. If the condition
does not match, the automation is skipped. Manual automations have no
`schedule`, `timezone`, `event`, or `condition`; they never fire from the
scheduler or event bus and run only through `manage-automations`
`action=run-now`.

The UI's **Email received** choice is not a fourth persisted trigger type. It is
a specialized event editor that persists `triggerType: event` with
`event: mail.message.received` and represents email filters as the event
condition.

## How It Works

1. User asks the agent to create an automation (or uses the settings UI).
2. For an event trigger, the agent calls `manage-automations` with
   `action=list-events` to discover the exact registered event name and payload.
3. Agent calls `manage-automations` with `action=define` to write a
   `jobs/<name>.md` resource.
4. The scheduler acquires due schedule triggers, the event dispatcher acquires
   matching event triggers, and manual triggers wait for `action=run-now`.
5. Event acquisition enforces owner and organization scope and evaluates any
   condition against the event payload.
6. Schedule, event, and explicit run-now acquisition converge on the shared
   background-automation runner, which validates identity, resolves the
   configured model and MCP allowlist, runs the agent loop, handles continuation
   and delivery, and records usage.
7. Status (`lastRun`, `lastStatus`, `lastError`) is written back to the resource
   frontmatter.

Trigger acquisition stays separate by design: the scheduler decides when a cron
expression is due, the event dispatcher matches event names, owners, and
conditions, and `run-now` is the only acquisition path for manual automations.
Everything after a trigger is accepted uses the same execution lifecycle.

## Markdown Format

```yaml
---
enabled: true
triggerType: event
event: calendar.booking.created
condition: "attendee email ends with @example.com"
mode: agentic
domain: calendar
createdBy: user@example.com
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
| `triggerType` | `"schedule" \| "event" \| "manual"` | How the automation fires                        |
| `event`       | `string?`                      | Event name to subscribe to (event triggers only)       |
| `condition`   | `string?`                      | Natural-language event condition (event triggers only) |
| `mode`        | `"agentic"`                    | Full agent loop (only supported mode; `"deterministic"` was removed — never implemented, rejected at define time) |
| `model`       | `string?`                      | Override the model for this trigger's agent loop       |
| `domain`      | `string?`                      | Grouping tag (mail, calendar, clips, etc.)             |
| `createdBy`   | `string?`                      | Creator email; required for organization event automations |
| `orgId`       | `string?`                      | Organization scope                                     |
| `runAs`       | `"creator" \| "shared"`        | Execution identity; trigger-aware automations use `creator` |
| `mcpTools`    | `string[]?`                    | Exact MCP tool allowlist for this automation           |
| `lastRun`     | `string?`                      | ISO timestamp of last execution                        |
| `lastStatus`  | `string?`                      | `success`, `error`, `running`, or `skipped`            |
| `lastError`   | `string?`                      | Error message from last failed run                     |

## Agent Tools

All automation operations are accessed through a single `manage-automations` tool with an `action` parameter:

| Action        | Purpose                                                              |
| ------------- | -------------------------------------------------------------------- |
| `list-events` | Discover registered event names, descriptions, and payload schemas before defining or changing an event trigger |
| `list` | List automations and their trigger, status, model, tools, and delivery metadata |
| `define` | Create an automation after confirming the summary with the user; requires `name`, `trigger_type`, and `body` |
| `update` | Update an existing automation in its original scope without changing its creator |
| `delete` | Delete an automation (always confirm with user first) |
| `fire-test` | Emit a `test.event.fired` event to validate event automations |
| `run-now` | Explicitly run one automation immediately with real actions and side effects |

Use `list-events` only when selecting an event trigger; schedule and manual
triggers do not need event discovery. For **Email received**, use the registered
`mail.message.received` event rather than inventing an email trigger type.

For `define` and `update`, send `trigger_type: schedule` with a cron `schedule`,
`trigger_type: event` with an exact registered `event` and optional `condition`,
or `trigger_type: manual` with none of those trigger-specific fields. Pass the
same `scope` when updating an existing automation. `manage-automations` supports
`model` and `mcpTools` on define/update; the MCP allowlist is enforced, not
advisory.

Use `run-now` only for an explicit user-authorized execution. It can run any
persisted trigger type immediately, is the sole execution path for manual
automations, returns a durable run id, and does not change the next scheduled
run.

Additional tool: `web-request` — outbound HTTP with `${keys.NAME}` substitution.

## Organization Event Automations

Organization event automations are visible to organization members but always
run as their creator:

- `createdBy` is required and `runAs` must be `creator`.
- An organization event automation matches only events emitted for that
  creator. Organization visibility does not turn an event into a broadcast.
- Organization admins may update or delete an automation, but cannot replace
  its creator or retarget its execution identity.
- Before every run, the framework verifies that the creator still exists and is
  still a member of the organization. A removed creator or unreadable
  membership state prevents execution.

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
}, { owner: "user@example.com" });
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

When an automation has a `condition`, the dispatcher calls the configured fast/classification model to classify whether the event payload satisfies the condition. This is a yes/no classification, not a generation task. The exact model ID lives in `condition-evaluator.ts`.

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
- Automation definitions, examples, event payloads, and prompts must not
  hardcode real API keys, webhook URLs, tokens, private Builder/internal data, or
  customer data. Use `${keys.NAME}` and synthetic `example.com` identities.

## UI

The full-page Agent surface's **Automations** tab is the primary management
surface for schedule, event, and manual automations. Users can create, edit,
run now, view status, enable/disable, inspect, and delete automations there. Its
URL remains `/agent#jobs` for compatibility even though the visible tab is
Automations.

## Example

User: "When someone books a meeting with a @example.com email, message me in Slack."

Agent flow:

1. Calls `manage-automations` with `action=list-events` to find `calendar.booking.created`.
2. Confirms the plan with the user.
3. Calls `manage-automations` with `action=define`:
   - `name`: `slack-on-example-booking`
   - `trigger_type`: `event`
   - `event`: `calendar.booking.created`
   - `condition`: `attendee email ends with @example.com`
   - `mode`: `agentic`
   - `domain`: `calendar`
   - `body`: `Send a Slack message to #sales with the booking details. Use the web-request tool to POST to ${keys.SLACK_WEBHOOK}.`

## Key Files

| File                                           | Purpose                                          |
| ---------------------------------------------- | ------------------------------------------------ |
| `packages/core/src/triggers/types.ts`          | `TriggerFrontmatter` interface                   |
| `packages/core/src/triggers/actions.ts`        | Agent tools (define, list, update, delete, test)  |
| `packages/core/src/triggers/dispatcher.ts`     | Event subscription and agentic dispatch          |
| `packages/core/src/jobs/background-automation-runner.ts` | Shared schedule/event/manual execution lifecycle |
| `packages/core/src/triggers/condition-evaluator.ts` | Haiku condition classification with caching |
| `packages/core/src/event-bus/`                 | Event bus (register, emit, subscribe)            |
| `packages/core/src/tools/fetch-tool.ts`        | `web-request` tool with key substitution         |
| `packages/core/src/secrets/substitution.ts`    | `resolveKeyReferences()` and `validateUrlAllowlist()` |

## Related Skills

- `recurring-jobs` -- schedule-triggered automations reuse the same scheduler
- `secrets` -- ad-hoc keys and `${keys.NAME}` substitution
- `actions` -- automations can call any registered action via the agent loop
- `delegate-to-agent` -- agentic mode runs a full `runAgentLoop`
