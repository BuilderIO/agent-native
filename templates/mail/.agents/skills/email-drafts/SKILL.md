# Email Drafts

Create, edit, and manage email drafts. Each draft is a separate file in `application-state/` named `compose-{id}.json`. The UI watches these files via SSE and updates the compose panel in real time.

## File Location

```
application-state/compose-{id}.json
```

Each file is one draft. Multiple drafts can exist simultaneously — they appear as tabs in the compose panel.

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
| `id`              | string | yes      | Unique draft ID (must match filename)           |
| `to`              | string | yes      | Comma-separated recipient email addresses       |
| `cc`              | string | no       | Comma-separated CC addresses                    |
| `bcc`             | string | no       | Comma-separated BCC addresses                   |
| `subject`         | string | yes      | Email subject line                              |
| `body`            | string | yes      | Email body (plain text or markdown)             |
| `mode`            | string | yes      | One of: `"compose"`, `"reply"`, `"forward"`     |
| `replyToId`       | string | no       | Message ID being replied to (for reply/forward) |
| `replyToThreadId` | string | no       | Thread ID for grouping (for reply/forward)      |

## How It Works

1. **Write** `application-state/compose-{id}.json` — the file watcher detects the change and pushes an SSE event
2. **UI receives the event** — invalidates the `compose-drafts` React Query cache
3. **Compose panel re-renders** — shows the updated draft as a tab, switches to it if new

The compose panel opens automatically when any draft file exists. When the last draft is deleted, the panel closes.

## Creating a New Draft

Generate a unique ID and write the file:

```bash
cat > application-state/compose-draft1.json << 'EOF'
{
  "id": "draft1",
  "to": "jane@example.com",
  "subject": "Quick question",
  "body": "Hi Jane,\n\nJust wanted to follow up on...",
  "mode": "compose"
}
EOF
```

## Editing an Existing Draft

Read the current draft, modify it, write it back:

```bash
# Read current draft
cat application-state/compose-draft1.json

# Write updated draft
cat > application-state/compose-draft1.json << 'EOF'
{
  "id": "draft1",
  "to": "jane@example.com",
  "subject": "Quick question",
  "body": "Hi Jane,\n\nI refined the draft as requested...",
  "mode": "compose"
}
EOF
```

## Listing All Drafts

```bash
ls application-state/compose-*.json
# Or via API:
curl http://localhost:3000/api/application-state/compose
```

## Closing a Draft

Delete the file:

```bash
rm application-state/compose-draft1.json
```

## Important Notes

- The `id` field in the JSON MUST match the `{id}` in the filename (`compose-{id}.json`)
- The UI debounces writes by 300ms — if the user is actively typing, your write will be visible after a brief moment
- Always use valid JSON with proper escaping (especially newlines in body: use `\n`)
- Multiple drafts can exist simultaneously — each appears as a tab in the compose panel
- When the user asks you to "draft" or "compose" an email, write a compose file — don't use the send API directly
- When the user asks you to "edit" or "improve" a draft, list drafts first, then read and update the relevant one
- **When called from the compose Generate button:** the context tells you which file to update (e.g. `compose-abc123.json`). Always update THAT file — do NOT create a new file with a different ID. Read the existing file, modify it, and write it back to the same path.
- **When drafting from scratch (no compose window open):** create a new file with any unique ID
