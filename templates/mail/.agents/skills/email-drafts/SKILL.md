---
name: email-drafts
description: >-
  Create, edit, and send email drafts through compose-{id} application state,
  manage-draft, and send-email. Use when composing, replying, forwarding,
  attaching files, applying signatures/writing style, or checking open/click
  tracking on sent mail.
---

# Email Drafts

Create, edit, and manage email drafts. Each draft is stored as an application state entry keyed `compose-{id}`. The UI refreshes through the framework polling/query invalidation path and updates the compose panel automatically.

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
| `body`            | string | yes      | Email body in **markdown** (see formatting below) |
| `mode`            | string | yes      | One of: `"compose"`, `"reply"`, `"forward"`     |
| `replyToId`       | string | no       | Message ID being replied to (for reply/forward) |
| `replyToThreadId` | string | no       | Thread ID for grouping (for reply/forward)      |

## Body Formatting

The `body` field uses **markdown**. The compose editor (TipTap) renders it as rich text, and the send flow converts markdown to HTML before sending via Gmail. Use standard markdown syntax:

- **Links:** `[click here](https://example.com)` — renders as a clickable hyperlink in the sent email
- **Bold:** `**bold text**`
- **Italic:** `*italic text*`
- **Lists:** `- item` (unordered) or `1. item` (ordered)
- **Headings:** `# Heading` (h1–h3)
- **Code:** `` `inline code` `` or fenced code blocks
- **Blockquotes:** `> quoted text`
- **Bare URLs:** `https://example.com` auto-links

Do NOT use raw HTML tags — use markdown only.

## Signature and Style Settings

Before creating or rewriting a draft, read the user's drafting settings with `pnpm action get-mail-settings`.

- Use `signature` exactly when it is configured; do not rewrite or duplicate it.
- If no signature is configured, omit the signature. Never derive one from the user's name, email address, or connected profile.
- Follow `writingStyle` when present.
- Keep generated copy natural and specific. Avoid generic AI email tropes, headings, and over-formal filler unless the user asks for that style.

## Updating Durable Drafting Settings

Treat requests to permanently change, add to, or remove a writing-style rule as
settings changes, not drafting requests. Route them to `update-mail-settings`;
do not use `manage-draft`, open the compose UI, or create a draft unless the
user separately asks for an example or email draft.

For a durable settings request:

1. Read the current settings with `get-mail-settings`.
2. Merge the requested rule into the existing `writingStyle`, preserving
   unrelated instructions. For a removal, remove only the requested rule.
3. If the requested change is ambiguous, conflicts with existing guidance, or
   would materially rewrite the style, show the proposed merged wording and
   ask the user to confirm before changing it.
4. Call `update-mail-settings` with the complete merged `writingStyle` value.
5. Read `get-mail-settings` again and confirm the persisted result. Do not
   report success based only on the update call response.

If the user asks both to change the durable style and to draft an email, update
the settings first, then create the separately requested draft using the
confirmed settings. A style-setting request alone must leave compose state
unchanged.

## How It Works

1. **Write** `writeAppState("compose-{id}", draft)` — the shared application state row changes
2. **UI polling sees the change** — invalidates the `compose-drafts` React Query cache
3. **Compose panel re-renders** — shows the updated draft as a tab, switches to it if new

The compose panel opens automatically when any compose draft exists. When the last draft is deleted, the panel closes.

## Use the `manage-draft` action, not raw `writeAppState`

`manage-draft` is the real action surface for compose drafts (`action`:
`create` | `update` | `delete` | `delete-all`). Prefer it over hand-writing
`compose-{id}` state directly — it does things a raw write will not:

- **Sanitizes the id.** IDs must match `/^[a-zA-Z0-9_-]{1,64}$/`
  (`sanitizeDraftId`); an invalid id on create silently falls back to a
  timestamp-based id instead of failing.
- **Appends the signature automatically on create** via
  `appendSignatureToBody(body, signature)`, reading the configured signature
  from `mail-settings`. This is idempotent (no-ops if the signature text is
  already in the body) and signature-aware of quoted content — it inserts the
  signature before any `— On ... wrote:` or `— Forwarded message —` block, not
  after it. `update` does NOT re-append the signature — only `create` does, so
  edit calls should not need to touch the signature themselves.
- **Returns a `deepLink`** (via `link()`) that opens the exact draft in the
  real Mail compose UI (`embedApp`/`mcpApp` resource with contact autocomplete,
  attachments, and send controls) — surface this link when running outside the
  first-party UI (e.g. from an MCP host).

```bash
pnpm action manage-draft --action=create --to=jane@example.com --subject="Quick question" --body="Hi Jane,\n\nJust wanted to follow up on..."
pnpm action manage-draft --action=update --id=draft1 --body="Hi Jane,\n\nI refined the draft as requested..."
pnpm action manage-draft --action=delete --id=draft1
pnpm action manage-draft --action=delete-all
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

## Attaching Files

The `send-email` action accepts an optional `attachments` array. Each entry must reference a file that was previously uploaded via the media-upload endpoint (`/api/media/upload`). Pass the server-side `filename` (the key returned by the upload endpoint, e.g. `abc123.pdf`), and optionally `originalName` (display name for the recipient) and `mimeType`. The attachment plumbing resolves the file from `data/uploads/` or from the configured file-storage URL recorded by the upload endpoint, then includes it as a MIME multipart attachment in the outgoing Gmail message. Do not store or paste attachment bytes, base64, or `data:` URLs in draft state/settings; files are never sent speculatively — only attach what the user has explicitly provided and confirmed.

### Local files from an MCP host

A hosted Mail app cannot read a path on the MCP host's local filesystem. Use
`create-attachment-upload` with the file's display name. It returns a
five-minute, owner-bound `uploadUrl`, a `PUT` method, and the attachment handle
Mail expects. From the local host, upload the raw bytes directly:

```bash
curl --fail-with-body --request PUT --header '<Authorization header>' --data-binary @/absolute/path/to/report.pdf '<uploadUrl>'
```

Use the response's `attachment` object in the draft/send request. The upload
Authorization header is a short-lived bearer credential: do not log, persist,
reuse, or share it. Creating or consuming it does not send mail. Keep `send-email` behind its
normal explicit-intent and human-approval gate; for drafting, pass the handle
through `ask_app` or open the returned compose deep link.

Example:
```json
{
  "to": "recipient@example.com",
  "subject": "Q2 Report",
  "body": "Please find the report attached.",
  "attachments": [
    { "filename": "abc123.pdf", "originalName": "Q2-Report.pdf", "mimeType": "application/pdf" }
  ]
}
```

Attachments are resolved eagerly, before Gmail is touched: if any referenced
upload can't be read, `send-email` throws immediately (nothing is sent) rather
than sending a partial message. If you see that error, the fix is re-uploading
via the media endpoint, not retrying the same `filename`.

## What Actually Happens on Send

`send-email` requires explicit user intent to send — it is `needsApproval:
true` and pauses for human approval before the real Gmail call happens. This is
the canonical, intentionally rare use of the human-in-the-loop gate in this
framework. An authenticated A2A caller may carry the user's exact chat
authorization for one matching send; otherwise the loop pauses for approval.
Drafting and queueing are unaffected by the gate.

It branches on whether the user has a connected Google account:

- **Connected:** resolves an access token (refreshing if the account's
  `expiry_date` is within 60s), resolves reply threading (`inReplyTo` /
  `References` headers) by fetching the original message metadata when
  `replyToId` is set, resolves the sender display name via
  `resolveGoogleSenderIdentity` (caching the result), builds the raw MIME
  message, and calls the real Gmail send API.
- **Not connected (no Google account):** synthesizes a fake sent message and
  appends it to the user's `local-emails` setting so the UI still shows a
  "Sent" item — this is a demo/fallback path, not a queued real send. Do not
  tell the user the email left their real inbox in this mode.
- **Open/click tracking:** if `mail-settings.tracking.opens` or `.clicks` is
  enabled, `send-email` rewrites the outgoing body with a tracking pixel and
  per-link click tokens before building the MIME message, and persists the
  token map keyed by the real Gmail message id. `get-tracking --id=<messageId>`
  reads back open count and per-link click stats for a previously sent
  message; it returns `tracked: false` (not an error) for messages that were
  sent before tracking was enabled or when tracking is off.
- Multiple connected Google accounts: `send-email`'s optional `account` param
  picks the sender; when replying, it also tries each connected account until
  one can fetch the original message, and uses that account as the sender if
  `account` wasn't explicit.

## Scheduled Sends

Scheduled sends use job ids prefixed `scheduled-`; `send-scheduled-email-now`
and `cancel-scheduled-email` both strip that prefix internally before looking
up the job — pass the id as shown to the user either way.

## Snippets

`manage-snippets` lists, creates, updates, and deletes saved reply snippets.
Users insert them from the compose slash menu, so a snippet the agent saves
becomes available there immediately.

## Aliases Are Settings-UI Only

Aliases (Settings → Aliases) are managed only through raw `/api/*` routes from
the Settings UI — there is no `manage-aliases` action, so the agent cannot add,
edit, or remove an alias on the user's behalf. Point the user at Settings →
Aliases instead.

## Important Notes

- The `id` field in the JSON MUST match the `{id}` in the key name (`compose-{id}`)
- The UI debounces writes by 300ms — if the user is actively typing, your write will be visible after a brief moment
- Always use valid JSON with proper escaping (especially newlines in body: use `\n`)
- Multiple drafts can exist simultaneously — each appears as a tab in the compose panel
- When the user asks you to "draft" or "compose" an email, write a compose entry — don't use the send API directly
- When the user asks you to "edit" or "improve" a draft, list drafts first, then read and update the relevant one
- **When called from the compose Generate button:** the context tells you which draft to update (e.g. `compose-abc123`). Always update THAT entry — do NOT create a new one with a different ID. Read, modify, and write back to the same key.
- **When drafting from scratch (no compose window open):** create a new entry with any unique ID

- The `id` field in the JSON MUST match the `{id}` in the key name (`compose-{id}`)
- The UI debounces writes by 300ms — if the user is actively typing, your write will be visible after a brief moment
- Always use valid JSON with proper escaping (especially newlines in body: use `\n`)
- Multiple drafts can exist simultaneously — each appears as a tab in the compose panel
- When the user asks you to "draft" or "compose" an email, write a compose entry — don't use the send API directly
- When the user asks you to "edit" or "improve" a draft, list drafts first, then read and update the relevant one
- **When called from the compose Generate button:** the context tells you which draft to update (e.g. `compose-abc123`). Always update THAT entry — do NOT create a new one with a different ID. Read, modify, and write back to the same key.
- **When drafting from scratch (no compose window open):** create a new entry with any unique ID
