# Mail — Agent Guide

This is an **agent-native** Gmail-style email client built with `@agent-native/core`. All email state lives in `data/emails.json` — the agent reads and writes this file directly to add emails, change state, and more.

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

All state is in JSON files in `data/`:

| File                 | Contents                                       |
| -------------------- | ---------------------------------------------- |
| `data/emails.json`   | All email messages (inbox, sent, drafts, etc.) |
| `data/labels.json`   | System and user labels with unread counts      |
| `data/settings.json` | User profile and app settings                  |

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

The agent can directly edit `data/emails.json` to:

- Add new email messages (simulating incoming mail)
- Change `isRead`, `isStarred`, `isArchived`, `isTrashed` flags
- Move emails between views by changing `labelIds`
- Update `data/settings.json` to change the user profile

### Example: Add a new incoming email

Edit `data/emails.json` and append:

```json
{
  "id": "msg-NEW",
  "threadId": "thread-NEW",
  "from": { "name": "Alice Smith", "email": "alice@example.com" },
  "to": [{ "name": "You", "email": "me@example.com" }],
  "subject": "Hello from Alice!",
  "snippet": "Just checking in...",
  "body": "Hey,\n\nJust checking in. Hope you're well!\n\nAlice",
  "date": "2025-07-15T12:00:00Z",
  "isRead": false,
  "isStarred": false,
  "isArchived": false,
  "isTrashed": false,
  "labelIds": ["inbox"]
}
```

## Scripts

Run agent scripts with `pnpm script <name> [--args]`.

| Script          | Args                                        | Purpose                          |
| --------------- | ------------------------------------------- | -------------------------------- |
| `seed-emails`   | `--count <n>`                               | Generate n demo emails           |
| `bulk-archive`  | `--older-than <days>`                       | Archive emails older than N days |
| `export-emails` | `--view <inbox\|sent\|...> --output <file>` | Export emails to JSON file       |

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
  emails.json     # All emails (source of truth)
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
