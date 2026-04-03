# Email Drafts

Create, edit, and manage email drafts. Each draft is stored as an application state entry keyed `compose-{id}`. The UI watches for changes via SSE and updates the compose panel in real time.

## Storage

Drafts are stored in the `application_state` SQL table via `writeAppState("compose-{id}", draft)` from `@agent-native/core/application-state`. Each entry is one draft. Multiple drafts can exist simultaneously — they appear as tabs in the compose panel.

## Schema

```json
{
  "id": "abc123",
  "to": "recipient@example.com",
  "cc": "",
  "bcc": "",
  "subject": "Meeting follow-up",
  "body": "Hi team,\n\nThanks for the great discussion today...",
  "mode": "compose",
  "replyToId": "",
  "replyToThreadId": ""
}
```

### Fields

| Field             | Type   | Required | Description                                     |
| ----------------- | ------ | -------- | ----------------------------------------------- |
| `id`              | string | yes      | Unique draft ID (must match key suffix)         |
| `to`              | string | yes      | Comma-separated recipient email addresses       |
| `cc`              | string | no       | Comma-separated CC addresses                    |
| `bcc`             | string | no       | Comma-separated BCC addresses                   |
| `subject`         | string | yes      | Email subject line                              |
| `body`            | string | yes      | Email body (plain text or markdown)             |
| `mode`            | string | yes      | One of: `"compose"`, `"reply"`, `"forward"`     |
| `replyToId`       | string | no       | Message ID being replied to (for reply/forward) |
| `replyToThreadId` | string | no       | Thread ID for grouping (for reply/forward)      |

## How It Works

1. **Write** `writeAppState("compose-{id}", draft)` — the store emits an SSE event
2. **UI receives the event** — invalidates the `compose-drafts` React Query cache
3. **Compose panel re-renders** — shows the updated draft as a tab, switches to it if new

The compose panel opens automatically when any compose draft exists. When the last draft is deleted, the panel closes.

## Creating a New Draft

Use the manage-draft script or write directly:

```bash
pnpm action manage-draft --action=create --to=jane@example.com --subject="Quick question" --body="Hi Jane,\n\nJust wanted to follow up on..."
```

Or from code:
```ts
import { writeAppState } from "@agent-native/core/application-state";
await writeAppState("compose-draft1", {
  id: "draft1",
  to: "jane@example.com",
  subject: "Quick question",
  body: "Hi Jane,\n\nJust wanted to follow up on...",
  mode: "compose",
});
```

## Editing an Existing Draft

Read the current draft, modify it, write it back:

```ts
import { readAppState, writeAppState } from "@agent-native/core/application-state";
const draft = await readAppState("compose-draft1");
draft.body = "Hi Jane,\n\nI refined the draft as requested...";
await writeAppState("compose-draft1", draft);
```

## Listing All Drafts

```bash
pnpm action view-composer
```

Or from code:
```ts
import { listAppState } from "@agent-native/core/application-state";
const drafts = await listAppState("compose-");
```

## Closing a Draft

```ts
import { deleteAppState } from "@agent-native/core/application-state";
await deleteAppState("compose-draft1");
```

## Important Notes

- The `id` field in the JSON MUST match the `{id}` in the key name (`compose-{id}`)
- The UI debounces writes by 300ms — if the user is actively typing, your write will be visible after a brief moment
- Always use valid JSON with proper escaping (especially newlines in body: use `\n`)
- Multiple drafts can exist simultaneously — each appears as a tab in the compose panel
- When the user asks you to "draft" or "compose" an email, write a compose entry — don't use the send API directly
- When the user asks you to "edit" or "improve" a draft, list drafts first, then read and update the relevant one
- **When called from the compose Generate button:** the context tells you which draft to update (e.g. `compose-abc123`). Always update THAT entry — do NOT create a new one with a different ID. Read, modify, and write back to the same key.
- **When drafting from scratch (no compose window open):** create a new entry with any unique ID
