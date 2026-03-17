# Mail — Agent Guide

You are the AI assistant for this email client. You can read, search, organize, and manage the user's emails. When a user asks about their emails (e.g. "summarize my unread emails", "what's new in my inbox", "find emails from Alice"), use the scripts and application state below to answer.

This is an **agent-native** email client built with `@agent-native/core`.

## Data Sources

**When a Google account is connected**, emails come from the Gmail API — the app works with real emails. **When no account is connected**, `data/emails.json` is used as a local store (starts empty).

To check the current state:

- Read `application-state/navigation.json` to see what view/thread the user is looking at
- Use `pnpm script list-emails --view=inbox` to list emails (automatically uses Gmail when connected, falls back to local data)
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
            │  (Express)    │
            │               │
            │  /api/emails  │
            │  /api/labels  │
            │  /api/settings│
            └───────────────┘
```

## Data Model

Local state is in JSON files in `data/`. When a Google account is connected, the API serves emails from Gmail instead — `data/emails.json` is only used as a fallback when no account is connected (and starts empty).

| File                 | Contents                                                       |
| -------------------- | -------------------------------------------------------------- |
| `data/emails.json`   | Local email store (empty by default, used only without Google) |
| `data/labels.json`   | System and user labels with unread counts                      |
| `data/settings.json` | User profile and app settings                                  |

### Compose Drafts (Application State)

The compose window is driven by `application-state/compose.json`. Write this file to open the compose window with a draft; edit it to update a draft in progress; delete it to close the compose window. See `.agents/skills/email-drafts/SKILL.md` for full details.

When the user asks you to **draft**, **compose**, or **write** an email, write `application-state/compose.json` — the UI will open the compose window automatically with your content.

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

When a Google account is connected, use the API routes (PATCH/POST) to modify emails — these operate on the real Gmail account. When no account is connected, the agent can directly edit `data/emails.json` to:

- Change `isRead`, `isStarred`, `isArchived`, `isTrashed` flags
- Move emails between views by changing `labelIds`
- Update `data/settings.json` to change the user profile

## Application State

Ephemeral UI state lives in `application-state/` as JSON files. These files are gitignored but visible to agent tools (via `.ignore`). Write to these files to trigger UI actions. The UI syncs its state here so you can always see what the user is looking at.

| File                                | Purpose                                  | Direction                                   |
| ----------------------------------- | ---------------------------------------- | ------------------------------------------- |
| `application-state/navigation.json` | Current view, open thread, focused email | UI → Agent (read-only for agent)            |
| `application-state/navigate.json`   | Navigate the user to a view/thread       | Agent → UI (one-shot command, auto-deleted) |
| `application-state/compose.json`    | Current email draft in compose window    | Bidirectional                               |

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
| "Reply to this email"                         | Read navigation.json for threadId → fetch thread via API → write compose.json with mode=reply                                  |
| "Find the email from Alice about the project" | `pnpm script list-emails --q=alice`, then write `application-state/navigate.json` with the matching threadId to open it        |
| "Open my starred emails"                      | Write `application-state/navigate.json` with `{"view": "starred"}`                                                             |

### Compose emails

Write `application-state/compose.json` to open the compose window with pre-filled content:

```json
{
  "to": "alice@example.com",
  "subject": "Project update",
  "body": "Hi Alice,\n\nHere's the latest on the project...",
  "mode": "compose"
}
```

The compose window opens automatically when this file exists. The user can edit the draft and send it.

To update an in-progress draft (e.g., user asks "make this more formal"):

1. Read `application-state/compose.json`
2. Modify the fields you want to change
3. Write the file back

The UI will pick up the changes automatically (via SSE).

#### Compose state shape

| Field             | Type   | Required | Description                         |
| ----------------- | ------ | -------- | ----------------------------------- |
| `to`              | string | yes      | Comma-separated recipient emails    |
| `cc`              | string | no       | Comma-separated CC emails           |
| `bcc`             | string | no       | Comma-separated BCC emails          |
| `subject`         | string | yes      | Email subject line                  |
| `body`            | string | yes      | Email body (plain text)             |
| `mode`            | string | yes      | `"compose"`, `"reply"`, `"forward"` |
| `replyToId`       | string | no       | ID of email being replied to        |
| `replyToThreadId` | string | no       | Thread ID for grouping              |

#### Common tasks

| User request                      | What to do                                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| "Draft an email to Alice about X" | Write `application-state/compose.json` with to, subject, body, mode=compose                         |
| "Make this draft more formal"     | Read compose.json, rewrite body, write back                                                         |
| "Change the subject to Y"         | Read compose.json, update subject, write back                                                       |
| "Reply to this email saying Z"    | Read navigation.json for current threadId, fetch thread via API, write compose.json with mode=reply |
| "What am I looking at?"           | Read navigation.json, then fetch the thread via `GET /api/threads/:threadId/messages`               |
| "Find the email about X"          | `pnpm script list-emails --q=X`, write `application-state/navigate.json` with matching threadId     |
| "Open my starred emails"          | Write `application-state/navigate.json` with `{"view": "starred"}`                                  |

## Scripts

Run agent scripts with `pnpm script <name> [--args]`. Scripts automatically use the API (Gmail when connected) and fall back to local data files.

| Script          | Args                                                    | Purpose                                     |
| --------------- | ------------------------------------------------------- | ------------------------------------------- |
| `list-emails`   | `--view <inbox\|unread\|starred\|sent\|...> --q <term>` | List and search emails (uses Gmail via API) |
| `seed-emails`   | `--count <n>`                                           | Generate n test emails (local data only)    |
| `bulk-archive`  | `--older-than <days>`                                   | Archive emails older than N days            |
| `export-emails` | `--view <inbox\|sent\|...> --output <file>`             | Export emails to JSON file                  |

### Common tasks

| User request                        | What to do                                                             |
| ----------------------------------- | ---------------------------------------------------------------------- |
| "Summarize my unread emails"        | `pnpm script list-emails --view=unread` then summarize the output      |
| "What emails do I have from Alice?" | `pnpm script list-emails --q=alice`                                    |
| "Archive old emails"                | `pnpm script bulk-archive --older-than=30`                             |
| "Star this email" / manage emails   | Use API: `PATCH /api/emails/:id/star`                                  |
| "Draft an email to ..."             | Write `application-state/compose.json` (see Application State section) |

### Adding new scripts

1. Create `scripts/my-script.ts` with:

```typescript
export default async function main(args: string[]): Promise<void> {
  // parse args, read/write data/ files
}
```

2. Register in `scripts/run.ts`.
3. Run with `pnpm script my-script`.

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
- **Backend**: Express 5
- **UI**: Radix UI + shadcn/ui + Lucide icons
- **Themes**: next-themes (dark/light/system)
- **State**: File-based JSON in `data/`

## Development

```bash
pnpm dev          # Start dev server (client + server)
pnpm build        # Production build
pnpm typecheck    # TypeScript validation
pnpm script <name> [--args]  # Run a backend script
```
