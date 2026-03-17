# Email Drafts

Create, edit, and manage email drafts by reading and writing `application-state/compose.json`. The UI watches this file via SSE and updates the compose window in real time.

## File Location

```
application-state/compose.json
```

## Schema

```json
{
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

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | string | yes | Comma-separated recipient email addresses |
| `cc` | string | no | Comma-separated CC addresses |
| `bcc` | string | no | Comma-separated BCC addresses |
| `subject` | string | yes | Email subject line |
| `body` | string | yes | Email body (plain text) |
| `mode` | string | yes | One of: `"compose"`, `"reply"`, `"forward"` |
| `replyToId` | string | no | Message ID being replied to (for reply/forward) |
| `replyToThreadId` | string | no | Thread ID for grouping (for reply/forward) |

## How It Works

1. **Write** `application-state/compose.json` — the file watcher detects the change and pushes an SSE event
2. **UI receives the event** — invalidates the `compose-state` React Query cache
3. **ComposeModal re-renders** — shows the updated draft content in the compose window

The compose window opens automatically when compose state exists. When the user sends or discards, the file is deleted.

## Creating a New Draft

Write the file directly:

```bash
mkdir -p application-state
cat > application-state/compose.json << 'EOF'
{
  "to": "jane@example.com",
  "subject": "Quick question",
  "body": "Hi Jane,\n\nJust wanted to follow up on...",
  "mode": "compose"
}
EOF
```

## Editing an Existing Draft

Read the current draft, modify it, and write it back:

```bash
# Read current draft
cat application-state/compose.json

# Write updated draft (preserve all existing fields)
cat > application-state/compose.json << 'EOF'
{
  "to": "jane@example.com",
  "subject": "Quick question",
  "body": "Hi Jane,\n\nI refined the draft as requested...",
  "mode": "compose"
}
EOF
```

Always read the file first before editing so you preserve fields the user has already filled in (like `to`, `cc`, `replyToId`, etc.).

## Replying to an Email

To draft a reply, set `mode` to `"reply"` and include the original message's ID and thread ID. Look these up from `data/emails.json`:

```json
{
  "to": "sender@example.com",
  "subject": "Re: Original subject",
  "body": "Thanks for your message...",
  "mode": "reply",
  "replyToId": "msg_abc123",
  "replyToThreadId": "thread_xyz"
}
```

## Clearing a Draft

Delete the file to close the compose window:

```bash
rm application-state/compose.json
```

## Important Notes

- The UI debounces writes by 300ms — if the user is actively typing, your write will be visible after a brief moment
- Always use valid JSON with proper escaping (especially newlines in body: use `\n`)
- The compose window opens automatically when this file exists and closes when it's deleted
- For the `to`, `cc`, and `bcc` fields, use comma-separated email addresses for multiple recipients
- When the user asks you to "draft" or "compose" an email, write this file — don't try to use the send API directly
- When the user asks you to "edit" or "improve" a draft, read the file first, then write the updated version
