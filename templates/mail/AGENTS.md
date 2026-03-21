# Mail — Agent Guide

You are the AI assistant for this email client. You can read, search, organize, and manage the user's emails. When a user asks about their emails (e.g. "summarize my unread emails", "what's new in my inbox", "find emails from Alice"), use the scripts and application state below to answer.

This is an **agent-native** email client built with `@agent-native/core`.

## Learnings & Preferences

**Always read `learnings.md` at the start of every conversation.** This file is the app's memory — it contains user preferences, corrections, important context, and patterns learned from past interactions.

**Update `learnings.md` when you learn something important:**

- User corrects your tone, style, or approach
- User shares personal info relevant to the app (contacts, preferences, habits)
- You discover a non-obvious pattern or gotcha
- User gives feedback that should apply to future conversations

Keep entries concise and actionable. Group by category. This file is gitignored so personal data stays local.

## Data Sources

**When a Google account is connected**, emails come from the Gmail API — the app works with real emails. **When no account is connected**, `data/emails.json` is used as a local store (starts empty).

To check the current state:

- Read `application-state/email-list.json` to see the emails currently displayed on the user's screen (compact summaries with id, threadId, from, subject, snippet, date, isRead, isStarred)
- Read `application-state/navigation.json` to see what view/thread the user is looking at
- Use `pnpm script list-emails --view=inbox` to list emails (automatically uses Gmail when connected, falls back to local data)
- Use `pnpm script search-emails --q=term` to search across all emails
- Check Google connection status via `GET /api/google/status`

**IMPORTANT — Drafts vs Emails:**

- The **compose window** the user sees is `application-state/compose.json` — NOT `data/emails.json`
- To see/edit the user's current draft: read/write `application-state/compose.json`
- To see stored email messages: use `pnpm script list-emails` or read `data/emails.json`
- NEVER edit `data/emails.json` to modify a draft the user is currently composing

## Architecture

```
┌────────────────────┐     ┌────────────────────┐
│  Frontend          │     │  Agent Chat        │
│  (React + Vite)    │◄───►│  (AI agent)        │
│                    │     │                    │
│  - reads emails    │     │  - reads/writes    │
│    via API         │     │    data/*.json     │
│  - sends actions   │     │  - runs scripts    │
│    via API PATCH   │     │    via pnpm script │
└────────┬───────────┘     └──────────┬─────────┘
         │                            │
         └──────────┬─────────────────┘
                    ▼
            ┌───────────────┐
            │  Backend      │
            │  (Nitro)    │
            │               │
            │  /api/emails  │
            │  /api/labels  │
            │  /api/settings│
            └───────────────┘
```

### File Sync (Multi-User Collaboration)

File sync is **opt-in** — enabled when `FILE_SYNC_ENABLED=true` is set in `.env`.

**Environment variables:**

| Variable                         | Required      | Description                                          |
| -------------------------------- | ------------- | ---------------------------------------------------- |
| `FILE_SYNC_ENABLED`              | No            | Set to `"true"` to enable sync                       |
| `FILE_SYNC_BACKEND`              | When enabled  | `"firestore"`, `"supabase"`, or `"convex"`           |
| `SUPABASE_URL`                   | For Supabase  | Project URL                                          |
| `SUPABASE_PUBLISHABLE_KEY`       | For Supabase  | Publishable key (or legacy `SUPABASE_ANON_KEY`)      |
| `GOOGLE_APPLICATION_CREDENTIALS` | For Firestore | Path to service account JSON                         |
| `CONVEX_URL`                     | For Convex    | Deployment URL from `npx convex dev` (must be HTTPS) |

**How sync works:**

- `createFileSync()` factory reads env vars and initializes sync
- Files matching `sync-config.json` patterns are synced to/from the database
- Sync events flow through SSE (`source: "sync"`) alongside file change events
- Conflicts produce `.conflict` sidecar files and notify the agent

**Checking sync status:**

- Read `data/.sync-status.json` for current sync state
- Read `data/.sync-failures.json` for permanently failed sync operations

**Handling conflicts:**

- When `application-state/sync-conflict.json` appears, resolve the conflict
- Read the `.conflict` file alongside the original to understand both versions
- Edit the original file to resolve, then delete the `.conflict` file

**Scratch files (not synced):**

- Prefix temporary files with `_tmp-` to exclude from sync

## Data Model

Local state is in JSON files in `data/`. When a Google account is connected, the API serves emails from Gmail instead — `data/emails.json` is only used as a fallback when no account is connected (and starts empty).

| File                 | Contents                                                       |
| -------------------- | -------------------------------------------------------------- |
| `data/emails.json`   | Local email store (empty by default, used only without Google) |
| `data/labels.json`   | System and user labels with unread counts                      |
| `data/settings.json` | User profile and app settings                                  |

### Compose Drafts (Application State)

Each draft is a separate file: `application-state/compose-{id}.json`. Multiple drafts can exist simultaneously — they appear as tabs in the compose panel. Write a file to open a new draft tab; edit it to update a draft in progress; delete it to close that tab. See `.agents/skills/email-drafts/SKILL.md` for full details.

When the user asks you to **draft**, **compose**, or **write** an email, write `application-state/compose-{id}.json` (pick any unique id) — the UI will open the compose panel automatically with your content as a new tab.

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
  attachments?: { id, filename, mimeType, size }[];
}
```

## Agent Operations

**Always run `pnpm script view-screen` first** before taking any action. This shows what the user is currently looking at and provides email IDs to act on. Don't skip this step — even if you think you know what's on screen.

**Always use `pnpm script <name>` for mail actions** — scripts call Gmail directly and do NOT require `pnpm dev` to be running. Never use `curl` or raw HTTP requests. When no script exists, use `node -e` inline JavaScript.

**After any backend change** (archive, trash, star, mark-read, send, etc.) always run `pnpm script refresh-list` to update `application-state/email-list.json` and trigger the UI to refetch.

Common operations:

- **Archive emails:** `pnpm script archive-email --id=<id>`
- **Trash emails:** `pnpm script trash-email --id=<id>`
- **Mark read/unread:** `pnpm script mark-read --id=<id> [--unread]`
- **Star emails:** `pnpm script star-email --id=<id>`
- **Send email:** `pnpm script send-email --to=<email> --subject="..." --body="..."`
- **See what's on screen:** `pnpm script view-screen`
- **See compose drafts:** `pnpm script view-composer`
- **Create/edit drafts:** `pnpm script manage-draft --action=create --to=... --subject=... --body=...`
- **Navigate UI:** `pnpm script navigate --view=inbox` or `--threadId=...`
- **Search:** `pnpm script search-emails --q=term`

See the full Scripts section below for all available scripts and arguments.

## Application State

Ephemeral UI state lives in `application-state/` as JSON files. These files are gitignored but visible to agent tools (via `.ignore`). Write to these files to trigger UI actions. The UI syncs its state here so you can always see what the user is looking at.

| File                                  | Purpose                                     | Direction                                   |
| ------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| `application-state/navigation.json`   | Current view, open thread, focused email    | UI → Agent (read-only for agent)            |
| `application-state/email-list.json`   | Emails currently displayed on user's screen | UI → Agent (read-only for agent)            |
| `application-state/thread.json`       | Full messages of the open thread            | UI → Agent (read-only for agent)            |
| `application-state/navigate.json`     | Navigate the user to a view/thread          | Agent → UI (one-shot command, auto-deleted) |
| `application-state/compose-{id}.json` | Email draft (one file per draft tab)        | Bidirectional                               |

### Navigation state (read what the user sees)

The UI automatically writes `application-state/navigation.json` whenever the user navigates. Read this file to see what the user is looking at:

```json
{
  "view": "inbox",
  "threadId": "thread-123",
  "focusedEmailId": "msg-456"
}
```

**Do NOT write to `navigation.json`** — it is overwritten by the UI. To navigate the user, use `navigate.json` instead.

### Email list (see what's on the user's screen)

The UI automatically syncs `application-state/email-list.json` with a compact summary of the emails currently displayed. **This is the fastest way to see the user's inbox** — no script or API call needed:

```json
{
  "view": "inbox",
  "label": null,
  "count": 42,
  "emails": [
    {
      "id": "msg-abc123",
      "threadId": "thread-xyz",
      "from": "Alice Smith <alice@example.com>",
      "subject": "Q1 Budget Review",
      "snippet": "Hi team, attached is the Q1 budget...",
      "date": "2026-03-16T10:30:00Z",
      "isRead": false,
      "isStarred": true
    }
  ]
}
```

**Do NOT write to `email-list.json`** — it is synced by the UI. To get more details about an email, use `GET /api/emails/:id` or `GET /api/threads/:threadId/messages`.

### Open thread (full conversation context)

When the user is viewing an email thread, the UI syncs the full messages to `application-state/thread.json`. **This is the fastest way to read the conversation** the user is looking at — including all message bodies:

```json
{
  "threadId": "thread-xyz",
  "messages": [
    {
      "id": "msg-1",
      "from": "Alice <alice@example.com>",
      "to": ["You <me@example.com>"],
      "subject": "Project update",
      "body": "Hey, here's the latest...",
      "date": "2026-03-16T10:30:00Z",
      "isRead": true
    },
    {
      "id": "msg-2",
      "from": "You <me@example.com>",
      "to": ["Alice <alice@example.com>"],
      "subject": "Re: Project update",
      "body": "Thanks! I'll review this afternoon.",
      "date": "2026-03-16T14:00:00Z",
      "isRead": true
    }
  ]
}
```

**Do NOT write to `thread.json`** — it is synced by the UI and deleted when the user navigates away from the thread.

When the user is composing a reply and asks for help, read the compose draft (`compose-*.json`) to find `replyToThreadId`, then read `thread.json` (or fetch via API) to get the full conversation for context.

### Navigate command (control the UI)

Write `application-state/navigate.json` to navigate the user to a specific email or view. The UI reads it, navigates, and deletes the file automatically:

```json
{
  "view": "inbox",
  "threadId": "thread-123"
}
```

This is a one-shot command — the file is deleted after the UI processes it.

#### Common navigation tasks

| User request                                  | What to do                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| "What email am I looking at?"                 | Read `application-state/navigation.json` to get the threadId, then fetch that thread via `GET /api/threads/:threadId/messages` |
| "Reply to this email"                         | Read navigation.json for threadId → fetch thread via API → write compose-{id}.json with mode=reply                             |
| "Find the email from Alice about the project" | `pnpm script list-emails --q=alice`, then write `application-state/navigate.json` with the matching threadId to open it        |
| "Open my starred emails"                      | Write `application-state/navigate.json` with `{"view": "starred"}`                                                             |

### Compose emails

Write `application-state/compose-{id}.json` to open a new draft tab with pre-filled content:

```json
{
  "id": "my-draft-1",
  "to": "alice@example.com",
  "subject": "Project update",
  "body": "Hi Alice,\n\nHere's the latest on the project...",
  "mode": "compose"
}
```

The compose panel opens automatically when any draft file exists. Multiple drafts appear as tabs. The `id` field must match the `{id}` in the filename.

To update an in-progress draft (e.g., user asks "make this more formal"):

1. List drafts: `ls application-state/compose-*.json`
2. Read the relevant draft file
3. Modify the fields you want to change
4. Write the file back

The UI will pick up the changes automatically (via SSE).

#### Compose state shape

| Field             | Type   | Required | Description                         |
| ----------------- | ------ | -------- | ----------------------------------- |
| `id`              | string | yes      | Unique draft ID (matches filename)  |
| `to`              | string | yes      | Comma-separated recipient emails    |
| `cc`              | string | no       | Comma-separated CC emails           |
| `bcc`             | string | no       | Comma-separated BCC emails          |
| `subject`         | string | yes      | Email subject line                  |
| `body`            | string | yes      | Email body (plain text)             |
| `mode`            | string | yes      | `"compose"`, `"reply"`, `"forward"` |
| `replyToId`       | string | no       | ID of email being replied to        |
| `replyToThreadId` | string | no       | Thread ID for grouping              |

#### Common tasks

| User request                      | What to do                                                                                                                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Summarize my inbox"              | Read `application-state/email-list.json` — the emails on screen are already there                                                                                                         |
| "Draft an email to Alice about X" | Write `application-state/compose-{id}.json` with id, to, subject, body, mode=compose                                                                                                      |
| "Make this draft more formal"     | List compose-\*.json, read the draft, rewrite body, write back                                                                                                                            |
| "Change the subject to Y"         | List compose-\*.json, read the draft, update subject, write back                                                                                                                          |
| "Reply to this email saying Z"    | Read navigation.json for threadId, fetch thread via API, write compose-{id}.json with mode=reply                                                                                          |
| "Help me write this reply"        | Read the open compose draft (compose-\*.json) → get replyToThreadId → fetch full thread via `GET /api/threads/:threadId/messages` → use the conversation context to update the draft body |
| "What am I looking at?"           | Read navigation.json + email-list.json, then fetch thread via `GET /api/threads/:threadId/messages`                                                                                       |
| "Find the email about X"          | `pnpm script search-emails --q=X`, write `application-state/navigate.json` with matching threadId                                                                                         |
| "Open my starred emails"          | Write `application-state/navigate.json` with `{"view": "starred"}`                                                                                                                        |

## Scripts

**IMPORTANT: Always use `pnpm script <name> [--args]` for all mail operations.** Do NOT use `curl`, `fetch`, or raw API calls — scripts handle API communication, error handling, and fallbacks automatically. Scripts work with Gmail when connected and fall back to local data when not.

### Reading & Searching

| Script          | Args                                                    | Purpose                                       |
| --------------- | ------------------------------------------------------- | --------------------------------------------- |
| `view-screen`   | `[--full]`                                              | See what the user is looking at right now     |
| `view-composer` | `[--id=<draft-id>]`                                     | See all open compose drafts                   |
| `list-emails`   | `--view <inbox\|unread\|starred\|sent\|...> --q <term>` | List and search emails (uses Gmail via API)   |
| `search-emails` | `--q <term> [--view <name>]`                            | Search emails across all views (requires --q) |
| `get-email`     | `--id <email-id>`                                       | Get a single email by ID                      |
| `get-thread`    | `--id <thread-id> [--compact]`                          | Get all messages in a thread                  |

### Actions

| Script          | Args                                                   | Purpose                                       |
| --------------- | ------------------------------------------------------ | --------------------------------------------- |
| `archive-email` | `--id <id>[,id2,id3]`                                  | Archive one or more emails                    |
| `trash-email`   | `--id <id>[,id2,id3]`                                  | Trash one or more emails                      |
| `mark-read`     | `--id <id>[,id2,id3] [--unread]`                       | Mark emails as read (or unread with --unread) |
| `star-email`    | `--id <id>[,id2,id3]`                                  | Toggle star on emails                         |
| `send-email`    | `--to <email> --subject <s> --body <b> [--cc] [--bcc]` | Send an email                                 |

### Drafts & Navigation

| Script         | Args                                                                                      | Purpose                                  |
| -------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------- |
| `manage-draft` | `--action=create\|update\|delete\|delete-all [--id] [--to] [--subject] [--body] [--mode]` | Create, update, or delete compose drafts |
| `navigate`     | `--view <name> [--threadId <id>]`                                                         | Navigate the UI to a view or thread      |

### Utilities

| Script          | Args                                        | Purpose                                  |
| --------------- | ------------------------------------------- | ---------------------------------------- |
| `seed-emails`   | `--count <n>`                               | Generate n test emails (local data only) |
| `bulk-archive`  | `--older-than <days>`                       | Archive emails older than N days         |
| `export-emails` | `--view <inbox\|sent\|...> --output <file>` | Export emails to JSON file               |

`list-emails` and `search-emails` support `--compact` for shorter output and `--fields=from,subject,date` to pick specific fields.

### Common tasks

| User request                        | Script to run                                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| "What's on my screen?"              | `pnpm script view-screen`                                                                           |
| "Summarize my inbox"                | `pnpm script view-screen` (emails are already in the response)                                      |
| "Summarize my unread emails"        | `pnpm script list-emails --view=unread --compact`                                                   |
| "What emails do I have from Alice?" | `pnpm script search-emails --q=alice --compact`                                                     |
| "Archive this email"                | `pnpm script view-screen` to get ID, then `pnpm script archive-email --id=<id>`                     |
| "Archive emails from netlify[bot]"  | `pnpm script view-screen`, find matching IDs, then `pnpm script archive-email --id=id1,id2,id3`     |
| "Mark this as unread"               | `pnpm script mark-read --id=<id> --unread`                                                          |
| "Star this email"                   | `pnpm script star-email --id=<id>`                                                                  |
| "Trash this email"                  | `pnpm script trash-email --id=<id>`                                                                 |
| "Find the email about X"            | `pnpm script search-emails --q=X`, then `pnpm script navigate --threadId=<id>`                      |
| "Open my starred emails"            | `pnpm script navigate --view=starred`                                                               |
| "Draft an email to Alice about X"   | `pnpm script manage-draft --action=create --to=alice@example.com --subject="X" --body="..."`        |
| "Make this draft more formal"       | `pnpm script view-composer`, then `pnpm script manage-draft --action=update --id=<id> --body="..."` |
| "Send this email"                   | `pnpm script send-email --to=<email> --subject="..." --body="..."`                                  |
| "What thread am I looking at?"      | `pnpm script view-screen --full`                                                                    |
| "Archive old emails"                | `pnpm script bulk-archive --older-than=30`                                                          |

### Adding new scripts

1. Create `scripts/my-script.ts` with:

```typescript
export default async function main(args: string[]): Promise<void> {
  // parse args, call API or read/write data/ files
}
```

2. Run with `pnpm script my-script` (auto-discovered, no registration needed).

## API Routes

| Method | Route                        | Description                     |
| ------ | ---------------------------- | ------------------------------- |
| GET    | `/api/emails?view=inbox&q=…` | List emails for a view/search   |
| GET    | `/api/emails/:id`            | Get a single email              |
| PATCH  | `/api/emails/:id/read`       | Toggle read state               |
| PATCH  | `/api/emails/:id/star`       | Toggle starred                  |
| PATCH  | `/api/emails/:id/archive`    | Archive email                   |
| PATCH  | `/api/emails/:id/trash`      | Trash email                     |
| DELETE | `/api/emails/:id`            | Permanently delete              |
| POST   | `/api/emails/send`           | Send (create sent email)        |
| GET    | `/api/labels`                | List all labels + unread counts |
| GET    | `/api/settings`              | Get user settings               |
| PATCH  | `/api/settings`              | Update user settings            |

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

## Project Structure

```
client/
  components/
    layout/       # AppLayout, Sidebar, CommandPalette
    email/        # EmailList, EmailListItem, EmailThread, ComposeModal
    ui/           # shadcn/ui components
  hooks/          # use-emails.ts (React Query), use-keyboard-shortcuts.ts
  pages/          # InboxPage, NotFound
  lib/            # utils.ts
server/
  routes/
    emails.ts     # All API route handlers
  index.ts        # Server setup
shared/
  types.ts        # Shared TypeScript types
scripts/
  run.ts          # Script dispatcher
data/
  emails.json     # Local email store (empty by default, used only without Google)
  labels.json     # Labels with unread counts
  settings.json   # User settings
```

## Tech Stack

- **Framework**: `@agent-native/core`
- **Package manager**: `pnpm`
- **Frontend**: React 18, React Router 6, TypeScript, Vite, TailwindCSS
- **Backend**: Nitro (via @agent-native/core)
- **UI**: Radix UI + shadcn/ui
- **Icons**: `@tabler/icons-react` — use Tabler icons for all icons. Do not use Lucide or inline SVGs.
- **Themes**: next-themes (dark/light/system)
- **State**: File-based JSON in `data/`

## Development

```bash
pnpm dev          # Start dev server (client + server)
pnpm build        # Production build
pnpm typecheck    # TypeScript validation
pnpm script <name> [--args]  # Run a backend script
```
