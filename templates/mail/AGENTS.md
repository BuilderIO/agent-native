# Mail — Agent Guide

This app follows the agent-native core philosophy: the agent and UI are equal partners. Everything the UI can do, the agent can do via actions. The agent always knows what you're looking at via application state. See the root AGENTS.md for full framework documentation.

You are the AI assistant for this email client. You can read, search, organize, and manage the user's emails. When a user asks about their emails (e.g. "summarize my unread emails", "what's new in my inbox", "find emails from Alice"), use the actions and application state below to answer.

This is an **agent-native** email client built with `@agent-native/core`.

## Inline Previews in Chat

When answering a question about a specific email or thread, embed a live preview directly in the chat message using the `embed` fence. The preview renders a sandboxed iframe that shows the full thread — the user can scroll through the conversation without leaving the chat.

Emit an embed block like this:

````
```embed
src: /email?threadId=<thread-id>&view=inbox
aspect: 4/3
title: <thread subject>
```
````

- `threadId` — the thread ID (from `view-screen`, `search-emails`, or `get-thread`)
- `view` — the inbox label the thread lives in (e.g. `inbox`, `starred`, `sent`); defaults to `inbox`
- `aspect` — use `4/3` for mail threads since messages are tall; use `16/9` for short threads
- `title` — the email subject line

The embed is same-origin only (the app must be running). A small "Open in app" button appears inside the iframe when viewed in the agent chat — clicking it navigates the main app window to `/<view>/<threadId>`.

Example — after `pnpm action search-emails --q="budget proposal"` returns thread `abc123` with subject "Q3 Budget Proposal":

````
```embed
src: /email?threadId=abc123&view=inbox
aspect: 4/3
title: Q3 Budget Proposal
```
````

## Resources

Resources are SQL-backed persistent files for storing notes, learnings, and context. They replace the old `LEARNINGS.md` file approach — resources are stored in the database, not the filesystem.

**At the start of every conversation, read these resources (both personal and shared scopes):**

1. **`AGENTS.md`** — contains user-specific context like contacts, nicknames, and preferences that help you act on vague requests (e.g., "email my wife"). Read both `--scope personal` and `--scope shared`.
2. **`LEARNINGS.md`** — the app's memory with user preferences, corrections, important context, and patterns learned from past interactions. Read both `--scope personal` and `--scope shared`.

**Update the `LEARNINGS.md` resource when you learn something important:**

- User corrects your tone, style, or approach
- User shares personal info relevant to the app (contacts, preferences, habits)
- You discover a non-obvious pattern or gotcha
- User gives feedback that should apply to future conversations

Keep entries concise and actionable. Group by category.

Resources support **personal** scope (per-user) and **shared** scope (visible to all users).

### Resource scripts

| Action            | Args                                           | Purpose                 |
| ----------------- | ---------------------------------------------- | ----------------------- |
| `resource-read`   | `--path <path> [--scope personal\|shared]`     | Read a resource         |
| `resource-write`  | `--path <path> --content <text> [--scope ...]` | Write/update a resource |
| `resource-list`   | `[--scope personal\|shared]`                   | List all resources      |
| `resource-delete` | `--path <path> [--scope personal\|shared]`     | Delete a resource       |

## Architecture

```
┌────────────────────┐     ┌────────────────────┐
│  Frontend          │     │  Agent Chat        │
│  (React + Vite)    │◄───►│  (AI agent)        │
│                    │     │                    │
│  - reads emails    │     │  - reads/writes    │
│    via API         │     │    SQL via scripts │
│  - sends actions   │     │  - runs scripts    │
│    via API PATCH   │     │    via pnpm action │
└────────┬───────────┘     └──────────┬─────────┘
         │                            │
         └──────────┬─────────────────┘
                    ▼
            ┌───────────────┐
            │  Backend      │
            │  (Nitro)      │
            │               │
            │  /api/emails  │
            │  /api/labels  │
            │  /api/settings│
            └───────┬───────┘
                    │
                    ▼
            ┌───────────────┐
            │  SQL Database │
            │  (via DB_URL) │
            └───────────────┘
```

## Data Sources

**When a Google account is connected**, emails come from the Gmail API — the app works with real emails. **When no account is connected**, the SQL settings store (`getSetting("local-emails")`) is used as a local store (starts empty).

### Multiple Inboxes

The user may have **multiple Google accounts connected** (e.g. personal and work). By default, `list-emails` and `search-emails` search **all connected accounts** and return results tagged with `accountEmail` so you can tell which inbox each email came from.

- To search a specific account only, use `--account=user@example.com`
- To see which accounts are connected, check the `accountEmail` field on returned emails
- When the user says "search my work email" or "check my personal inbox", use `--account` to scope to the right account

To check the current state:

- Use `readAppState("navigation")` to see what view/thread/search/label the user is looking at
- Use `pnpm action view-screen` to see the navigation state and fetch the matching email list
- Use `pnpm action list-emails --view=inbox` to list emails (automatically uses Gmail when connected, falls back to local data)
- Use `pnpm action search-emails --q=term` to search across all emails
- Check Google connection status via `GET /_agent-native/google/status`

**IMPORTANT — Drafts vs Emails:**

- The **compose window** the user sees is stored via `readAppState("compose-{id}")` — NOT the email store
- To see/edit the user's current draft: use `readAppState("compose-{id}")` / `writeAppState("compose-{id}", draft)`
- To see stored email messages: use `pnpm action list-emails` or query the settings store
- NEVER edit the email store to modify a draft the user is currently composing

## Data Model

All data is stored in SQL via Drizzle ORM (SQLite, Postgres, Turso, etc. via `DATABASE_URL`). When a Google account is connected, the API serves emails from Gmail instead — the local email store is only used as a fallback when no account is connected (and starts empty).

| SQL Store                     | Contents                                                       |
| ----------------------------- | -------------------------------------------------------------- |
| `getSetting("local-emails")`  | Local email store (empty by default, used only without Google) |
| `getSetting("labels")`        | System and user labels with unread counts                      |
| `getSetting("mail-settings")` | User profile and app settings                                  |
| `getSetting("aliases")`       | Email aliases                                                  |
| `queued_email_drafts`         | Org-scoped drafts requested by teammates for review/send       |

Google OAuth tokens are stored via `@agent-native/core/oauth-tokens` (provider: "google").

### Email tracking

Sent emails get open + link-click tracking injected automatically. Stats appear under each sent message in the thread view.

- Settings live under `getSetting("mail-settings").tracking`:
  - `tracking.opens` (default `true`) — inject a 1×1 pixel so opens can be counted
  - `tracking.clicks` (default `false`) — when enabled, rewrite external links through `/api/tracking/click/:token` so clicks can be counted
- Events are stored in the `email_tracking` + `email_link_tracking` SQL tables. Quoted content in replies/forwards is NOT rewritten — only links in the new portion of the message.
- Use `pnpm action get-tracking --id=<message-id>` to fetch open + click stats for any sent message, or `GET /api/emails/:id/tracking` from the frontend.

### Compose Drafts (Application State)

Each draft is stored as a separate application state entry: `writeAppState("compose-{id}", draft)`. Multiple drafts can exist simultaneously — they appear as tabs in the compose panel. Write an entry to open a new draft tab; update it to edit a draft in progress; delete it to close that tab.

When the user asks you to **draft**, **compose**, or **write** an email, use `writeAppState("compose-{id}", draft)` (pick any unique id) — the UI will open the compose panel automatically with your content as a new tab.

### Queued Drafts (Org Review Queue)

Queued drafts are durable SQL rows in `queued_email_drafts`. Use them when someone else asks the agent to prepare an email for an organization member to review and send, especially from Slack.

- Use `queue-email-draft` to queue a draft for an org member. The requester and owner must both be in the active organization.
- Use `list-queued-drafts --scope=review --status=active` to see drafts assigned to the current user.
- Use `update-queued-draft` to revise queued drafts before sending.
- Use `open-queued-draft` to open a queued draft in the compose panel for manual edits.
- Use `send-queued-drafts --id=<id>` or `--all=true` only when the queued draft owner asks you to send.
- Never use raw `send-email` from Slack to send on behalf of another teammate; queue the draft instead.

### Email object shape

```typescript
{
  id: string;
  threadId: string;
  from: { name: string; email: string };
  to: { name: string; email: string }[];
  cc?: { name: string; email: string }[];
  subject: string;
  snippet: string;          // first ~120 chars of body
  body: string;             // full plain-text body
  date: string;             // ISO timestamp
  isRead: boolean;
  isStarred: boolean;
  isDraft?: boolean;
  isSent?: boolean;
  isArchived: boolean;
  isTrashed: boolean;
  labelIds: string[];       // e.g. ["inbox", "important"]
  accountEmail: string;       // which connected account this email belongs to
  attachments?: { id, filename, mimeType, size }[];
}
```

## Agent Operations

The current screen state (including email IDs to act on) is automatically included with each message as a `<current-screen>` block. You don't need to call `view-screen` before every action — use it only when you need a refreshed snapshot mid-conversation (e.g., after archiving or sending).

**Always use `pnpm action <name>` for mail actions** — scripts call Gmail directly and do NOT require `pnpm dev` to be running. Never use `curl` or raw HTTP requests. When no script exists, use `node -e` inline JavaScript.

**Running actions from the frame:** The terminal cwd is the framework root. Always `cd` to this template's root before running any action:

```bash
cd templates/mail && pnpm action <name> [args]
```

`.env` is loaded automatically — **never manually set `DATABASE_URL` or other env vars**.

**After any backend change** (archive, trash, star, mark-read, send, etc.) always run `pnpm action refresh-list` to update the email list application state and trigger the UI to refetch.

Common operations:

- **Archive emails:** `pnpm action archive-email --id=<id>`
- **Trash emails:** `pnpm action trash-email --id=<id>`
- **Mark read/unread:** `pnpm action mark-read --id=<id> [--unread]`
- **Star emails:** `pnpm action star-email --id=<id>`
- **Send email:** `pnpm action send-email --to=<email> --subject="..." --body="..."`
- **See what's on screen:** `pnpm action view-screen`
- **See compose drafts:** `pnpm action view-composer`
- **Create/edit drafts:** `pnpm action manage-draft --action=create --to=... --subject=... --body=...`
- **Navigate UI:** `pnpm action navigate --view=inbox` or `--threadId=...`
- **Search:** `pnpm action search-emails --q=term`

See the full Scripts section below for all available scripts and arguments.

## Application State

Ephemeral UI state is stored in the SQL `application_state` table, accessed via `readAppState(key)` and `writeAppState(key, value)` from `@agent-native/core/application-state`. Scripts use these functions instead of filesystem reads/writes. The UI syncs its state here so you can always see what the user is looking at.

| State Key      | Purpose                                            | Direction                                    |
| -------------- | -------------------------------------------------- | -------------------------------------------- |
| `navigation`   | Current view, thread, search, label, focused email | UI -> Agent (read-only for agent)            |
| `navigate`     | Navigate the user to a view/thread                 | Agent -> UI (one-shot command, auto-deleted) |
| `compose-{id}` | Email draft (one entry per draft tab)              | Bidirectional                                |

When the user is on the draft queue, navigation state is:

```json
{
  "view": "draft-queue",
  "queuedDraftId": "qd_abc123",
  "queueScope": "review"
}
```

SSE streams DB change events (source: `"app-state"`, `"settings"`) so the UI updates in real time when any state changes.

### Navigation state (read what the user sees)

The UI automatically writes `writeAppState("navigation", ...)` whenever the user navigates. Read this state to see what the user is looking at:

```json
{
  "view": "inbox",
  "threadId": "thread-123",
  "focusedEmailId": "msg-456",
  "search": "budget",
  "label": "important"
}
```

**Do NOT write to `navigation`** — it is overwritten by the UI. To navigate the user, use the `navigate` key instead. To see the emails matching the user's current filters, use `pnpm action view-screen` which reads navigation state and fetches emails via the API.

### Reading thread messages

To read the full conversation of a thread, use the API directly:

- `pnpm action get-thread --id=<threadId>` (from scripts)
- `GET /api/threads/:threadId/messages` (HTTP endpoint)
- `pnpm action view-screen` (includes thread messages when the user is viewing a thread)

Thread data is fetched from the API on demand — it is NOT stored in application-state.

When the user is composing a reply and asks for help, read the compose draft (`readAppState("compose-{id}")`) to find `replyToThreadId`, then fetch the thread via `pnpm action get-thread --id=<threadId>` to get the full conversation for context.

### Navigate command (control the UI)

Use `writeAppState("navigate", ...)` to navigate the user to a specific email or view. The UI reads it, navigates, and deletes the entry automatically:

```json
{
  "view": "inbox",
  "threadId": "thread-123"
}
```

This is a one-shot command — the entry is deleted after the UI processes it.

### Compose emails

Use `writeAppState("compose-{id}", draft)` to open a new draft tab with pre-filled content:

```json
{
  "id": "my-draft-1",
  "to": "alice@example.com",
  "subject": "Project update",
  "body": "Hi Alice,\n\nHere's the latest on the project...",
  "mode": "compose"
}
```

The compose panel opens automatically when any compose draft exists. Multiple drafts appear as tabs. The `id` field must match the `{id}` in the key name.

To update an in-progress draft (e.g., user asks "make this more formal"):

1. List drafts via `pnpm action view-composer`
2. Read the relevant draft
3. Modify the fields you want to change
4. Write the updated draft back via `writeAppState("compose-{id}", updatedDraft)`

The UI will pick up the changes automatically (via SSE on `"app-state"` events).

#### Compose state shape

| Field             | Type   | Required | Description                           |
| ----------------- | ------ | -------- | ------------------------------------- |
| `id`              | string | yes      | Unique draft ID (matches key name)    |
| `to`              | string | yes      | Comma-separated recipient emails      |
| `cc`              | string | no       | Comma-separated CC emails             |
| `bcc`             | string | no       | Comma-separated BCC emails            |
| `subject`         | string | yes      | Email subject line                    |
| `body`            | string | yes      | Email body (**markdown** — see below) |
| `mode`            | string | yes      | `"compose"`, `"reply"`, `"forward"`   |
| `replyToId`       | string | no       | ID of email being replied to          |
| `replyToThreadId` | string | no       | Thread ID for grouping                |

#### Body formatting

The `body` field uses **markdown**. The compose editor (TipTap) renders it as rich text, and the send flow converts it to HTML for the email. Use standard markdown:

- **Links:** `[link text](https://example.com)` — renders as a clickable hyperlink
- **Bold:** `**bold text**`
- **Italic:** `*italic text*`
- **Lists:** `- item` or `1. item`
- **Headings:** `# Heading` (h1–h3)
- **Code:** `` `inline` `` or fenced code blocks
- **Blockquotes:** `> quoted text`
- **Bare URLs:** `https://example.com` auto-links

Do NOT use HTML tags in the body — use markdown only.

## Common Tasks

| User request                      | What to do                                                                                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Summarize my inbox"              | `pnpm action view-screen` — fetches emails matching the user's current view                                                                                                |
| "Draft an email to Alice about X" | `writeAppState("compose-{id}", { id, to, subject, body, mode: "compose" })`                                                                                                |
| "Make this draft more formal"     | View composer, read the draft, rewrite body, write back                                                                                                                    |
| "Change the subject to Y"         | View composer, read the draft, update subject, write back                                                                                                                  |
| "Reply to this email saying Z"    | Read navigation state for threadId, fetch thread via API, `writeAppState("compose-{id}", ...)` with mode=reply                                                             |
| "Help me write this reply"        | Read the open compose draft -> get replyToThreadId -> fetch full thread via `GET /api/threads/:threadId/messages` -> use the conversation context to update the draft body |
| "What am I looking at?"           | `pnpm action view-screen`, then fetch thread via `GET /api/threads/:threadId/messages`                                                                                     |
| "Find the email about X"          | `pnpm action search-emails --q=X`, `writeAppState("navigate", { threadId: "..." })`                                                                                        |
| "Open my starred emails"          | `writeAppState("navigate", { view: "starred" })`                                                                                                                           |

## Actions

**IMPORTANT: Always use `pnpm action <name> [--args]` for all mail operations.** Do NOT use `curl`, `fetch`, or raw API calls — scripts handle API communication, error handling, and fallbacks automatically. Scripts work with Gmail when connected and fall back to local data when not.

Scripts use `readAppState()` / `writeAppState()` from `@agent-native/core/application-state` and `readSetting()` / `writeSetting()` from `@agent-native/core/settings` instead of filesystem reads/writes.

### Reading & Searching

| Action          | Args                                                                        | Purpose                                       |
| --------------- | --------------------------------------------------------------------------- | --------------------------------------------- |
| `view-screen`   | `[--full]`                                                                  | See what the user is looking at right now     |
| `view-composer` | `[--id=<draft-id>]`                                                         | See all open compose drafts                   |
| `list-emails`   | `--view <inbox\|unread\|starred\|sent\|...> --q <term> [--account <email>]` | List and search emails (uses Gmail via API)   |
| `search-emails` | `--q <term> [--view <name>] [--account <email>]`                            | Search emails across all views (requires --q) |
| `get-email`     | `--id <email-id>`                                                           | Get a single email by ID                      |
| `get-thread`    | `--id <thread-id> [--compact]`                                              | Get all messages in a thread                  |

### Actions

| Action          | Args                                                   | Purpose                                       |
| --------------- | ------------------------------------------------------ | --------------------------------------------- |
| `archive-email` | `--id <id>[,id2,id3]`                                  | Archive one or more emails                    |
| `trash-email`   | `--id <id>[,id2,id3]`                                  | Trash one or more emails                      |
| `mark-read`     | `--id <id>[,id2,id3] [--unread]`                       | Mark emails as read (or unread with --unread) |
| `star-email`    | `--id <id>[,id2,id3]`                                  | Toggle star on emails                         |
| `send-email`    | `--to <email> --subject <s> --body <b> [--cc] [--bcc]` | Send an email                                 |
| `get-tracking`  | `--id <message-id>`                                    | Open + link-click stats for a sent email      |

### Drafts & Navigation

| Action                | Args                                                                                      | Purpose                                  |
| --------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------- |
| `manage-draft`        | `--action=create\|update\|delete\|delete-all [--id] [--to] [--subject] [--body] [--mode]` | Create, update, or delete compose drafts |
| `queue-email-draft`   | `--ownerEmail <member> --to <emails> --subject <s> --body <b> [--context]`                | Queue a draft for an org member          |
| `list-queued-drafts`  | `[--scope=review\|requested\|all] [--status=active\|queued\|in_review\|sent\|dismissed]`  | List queued drafts                       |
| `update-queued-draft` | `--id <id> [--to] [--subject] [--body] [--context] [--status]`                            | Edit or dismiss a queued draft           |
| `open-queued-draft`   | `--id <id>`                                                                               | Open queued draft in compose             |
| `send-queued-drafts`  | `--id <id>` or `--all=true`                                                               | Send queued draft(s) assigned to you     |
| `list-org-members`    | none                                                                                      | List valid queued-draft owners           |
| `navigate`            | `--view <name> [--threadId <id>] [--queuedDraftId <id>]`                                  | Navigate the UI to a view/thread/queue   |

### Utilities

| Action          | Args                                        | Purpose                          |
| --------------- | ------------------------------------------- | -------------------------------- |
| `bulk-archive`  | `--older-than <days>`                       | Archive emails older than N days |
| `export-emails` | `--view <inbox\|sent\|...> --output <file>` | Export emails to JSON file       |

`list-emails` and `search-emails` support `--compact` for shorter output and `--fields=from,subject,date` to pick specific fields.

### Action tasks

| User request                        | Action to run                                                                                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| "What's on my screen?"              | `pnpm action view-screen`                                                                                                                       |
| "Summarize my inbox"                | `pnpm action view-screen` (emails are already in the response)                                                                                  |
| "Summarize my unread emails"        | `pnpm action list-emails --view=unread --compact`                                                                                               |
| "What emails do I have from Alice?" | `pnpm action search-emails --q=alice --compact`                                                                                                 |
| "Archive this email"                | `pnpm action view-screen` to get ID, then `pnpm action archive-email --id=<id>`                                                                 |
| "Archive emails from netlify[bot]"  | `pnpm action view-screen`, find matching IDs, then `pnpm action archive-email --id=id1,id2,id3`                                                 |
| "Mark this as unread"               | `pnpm action mark-read --id=<id> --unread`                                                                                                      |
| "Star this email"                   | `pnpm action star-email --id=<id>`                                                                                                              |
| "Trash this email"                  | `pnpm action trash-email --id=<id>`                                                                                                             |
| "Find the email about X"            | `pnpm action search-emails --q=X`, then `pnpm action navigate --threadId=<id>`                                                                  |
| "Open my starred emails"            | `pnpm action navigate --view=starred`                                                                                                           |
| "Draft an email to Alice about X"   | `pnpm action manage-draft --action=create --to=alice@example.com --subject="X" --body="..."`                                                    |
| "Queue Steve a draft to Alice"      | `pnpm action list-org-members`, then `pnpm action queue-email-draft --ownerEmail=steve@... --to=alice@example.com --subject="..." --body="..."` |
| "Make this draft more formal"       | `pnpm action view-composer`, then `pnpm action manage-draft --action=update --id=<id> --body="..."`                                             |
| "Make queued drafts sound like me"  | `pnpm action list-queued-drafts --scope=review`, then `pnpm action update-queued-draft --id=<id> --body="..."`                                  |
| "Send all queued drafts"            | `pnpm action send-queued-drafts --all=true`                                                                                                     |
| "Send this email"                   | `pnpm action send-email --to=<email> --subject="..." --body="..."`                                                                              |
| "Did they open my email?"           | `pnpm action get-tracking --id=<message-id>`                                                                                                    |
| "What thread am I looking at?"      | `pnpm action view-screen --full`                                                                                                                |
| "Archive old emails"                | `pnpm action bulk-archive --older-than=30`                                                                                                      |

## API Routes

| Method | Route                             | Description                     |
| ------ | --------------------------------- | ------------------------------- |
| GET    | `/api/emails?view=inbox&q=…`      | List emails for a view/search   |
| GET    | `/api/emails/:id`                 | Get a single email              |
| PATCH  | `/api/emails/:id/read`            | Toggle read state               |
| PATCH  | `/api/emails/:id/star`            | Toggle starred                  |
| PATCH  | `/api/emails/:id/archive`         | Archive email                   |
| PATCH  | `/api/emails/:id/trash`           | Trash email                     |
| DELETE | `/api/emails/:id`                 | Permanently delete              |
| POST   | `/api/emails/send`                | Send (create sent email)        |
| GET    | `/api/threads/:threadId/messages` | Get all messages in a thread    |
| GET    | `/api/labels`                     | List all labels + unread counts |
| GET    | `/api/settings`                   | Get user settings               |
| PATCH  | `/api/settings`                   | Update user settings            |

## Keyboard Shortcuts

| Key        | Action                       |
| ---------- | ---------------------------- |
| `J`        | Next email                   |
| `K`        | Previous email               |
| `↑` / `↓`  | Same as J/K                  |
| `Enter`    | Open focused email           |
| `E`        | Archive email/thread         |
| `D`        | Trash email/thread           |
| `S`        | Star/unstar (in thread view) |
| `R`        | Reply                        |
| `U`        | Toggle read/unread           |
| `C`        | Compose new email            |
| `/`        | Focus search bar             |
| `⌘K`       | Open command palette         |
| `G then I` | Go to Inbox                  |
| `G then S` | Go to Starred                |
| `G then T` | Go to Sent                   |
| `G then D` | Go to Drafts                 |
| `G then A` | Go to Archive                |
| `Esc`      | Close thread / clear search  |

## UI Components

**Always use shadcn/ui components** from `app/components/ui/` for all standard UI patterns (dialogs, popovers, dropdowns, tooltips, buttons, etc). Never build custom modals or dropdowns with absolute/fixed positioning — use the shadcn primitives instead.

**Always use Tabler Icons** (`@tabler/icons-react`) for all icons. Never use other icon libraries.

**Never use browser dialogs** (`window.confirm`, `window.alert`, `window.prompt`) — use shadcn AlertDialog instead.

## Development

For code editing and development guidance, read `DEVELOPING.md`.
