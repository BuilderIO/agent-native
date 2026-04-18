---
title: "Mail Template"
description: "An agent-native email client. A Gmail and Superhuman alternative you own."
---

# Mail Template

Mail is an agent-native email client built on `@agent-native/core`. It reads from your real Gmail when you connect a Google account, and works as a local mailbox when you don't — with an AI agent that can triage, search, draft, and send on your behalf.

## Overview {#overview}

Mail is a drop-in replacement for Gmail and Superhuman. The UI is keyboard-first: a thread list on the left, the open thread in the middle, and a compose panel that opens as tabs on the right. The agent sits alongside in the sidebar and has the same powers the UI has — read, search, archive, label, star, draft, and send — via actions in `templates/mail/actions/`.

Use it if you want:

- An email client where an AI agent can actually work on your mail, not just suggest.
- Superhuman-style keyboard shortcuts without the subscription.
- Multi-account Gmail support (personal + work in one inbox).
- Your own codebase. Fork it, change anything, own the data.

The agent always knows which view, thread, and message you're looking at because the UI writes that state into SQL (`application_state`) where the agent can read it.

## Quick start {#quick-start}

Create a new workspace with the Mail template:

```bash
npx @agent-native/core create my-mail --standalone --template mail
cd my-mail
pnpm install
pnpm dev
```

Or add Mail to an existing agent-native workspace:

```bash
agent-native add-app
```

Live demo: [mail.agent-native.com](https://mail.agent-native.com)

On first run, connect a Google account from Settings to sync real Gmail. Without a Google account, the app runs against an empty local email store (useful for screenshots or demos).

## Key features {#key-features}

### Gmail sync (multi-account)

Connect one or many Google accounts via OAuth. List and search actions query all connected inboxes by default; results carry an `accountEmail` field so you can tell which inbox each thread came from. Scope to a single account with `--account=user@example.com`. OAuth tokens are stored via `@agent-native/core/oauth-tokens` under the `"google"` provider.

### Keyboard-first navigation

The app is designed to run without a mouse. `J`/`K` move between threads, `E` archives, `R` replies, `C` composes, `/` focuses search, and `G` begins a "go to" chord (`G I` for Inbox, `G S` for Starred, etc.). See the [full list below](#keyboard-shortcuts).

### Multiple compose drafts

The compose panel supports multiple draft tabs at once. Each draft is stored as an `application_state` entry at `compose-{id}` and syncs live between the agent and the UI. The agent can create a new draft with `manage-draft --action=create`, edit your in-progress draft with `--action=update`, or close tabs with `--action=delete`. Drafts use markdown in the body field; the TipTap editor renders it as rich text and converts to HTML on send.

### AI triage via automations

Mail supports automation rules that run against new inbox email using AI. A rule has a natural-language condition (for example, `"from a newsletter"` or `"subject contains invoice"`) and a list of actions (`label`, `archive`, `mark_read`, `star`, `trash`). Manage them via `pnpm action manage-automations --action=create|list|update|delete|enable|disable`, or through the Settings page. Rules fire automatically and can be triggered manually with `pnpm action trigger-automations`.

### Send tracking

Sent messages get open-pixel and link-click tracking injected automatically. Settings live under `mail-settings.tracking` with `tracking.opens` and `tracking.clicks` (both default `true`). Only links in the new portion of a reply or forward are rewritten — quoted content is left alone. Pull stats for any sent message with `pnpm action get-tracking --id=<message-id>`, or from `GET /api/emails/:id/tracking`. Open and click events are stored in the `email_tracking` and `email_link_tracking` tables.

### Search

`pnpm action search-emails --q=<term>` searches across all views and all connected accounts. The UI search bar maps to the same action. Both `search-emails` and `list-emails` take `--compact` for shorter output and `--fields=from,subject,date` to limit returned fields.

### Bulk operations and export

- `pnpm action bulk-archive --older-than=30` archives everything older than N days.
- `pnpm action export-emails --view=inbox --output=file.json` dumps a view to JSON.
- Archive, trash, mark-read, and star all accept comma-separated IDs (`--id=id1,id2,id3`) for bulk changes.

### Inline thread previews in agent chat

When the agent answers a question about a specific thread, it can embed a live preview of the thread directly in the chat message via an `embed` code fence. The preview is a sandboxed iframe that shows the full conversation without leaving the chat, with an "Open in app" button that navigates the main window to that thread.

## Working with the agent {#working-with-the-agent}

The agent reads `application_state.navigation` on every turn, so it already knows which view you're in, which thread is open, and which message is focused — you don't have to tell it. You can just say things like:

- "Summarize my unread emails."
- "Find the latest thread from Alice about the budget."
- "Draft a reply that politely declines."
- "Archive all Netlify bot emails older than a week."
- "Open my starred emails."
- "Make this draft more formal."
- "Did they open my email?"

How the agent sees your context:

- **Current view and thread** — the UI writes `navigation` (view, threadId, focusedEmailId, search, label) whenever you navigate. The agent reads it via `readAppState("navigation")` or `pnpm action view-screen`.
- **Open draft** — if you're composing a reply and ask "help me word this", the agent reads the matching `compose-{id}` entry to see your current subject and body, then writes an updated draft back. The UI picks up the edit live.
- **Thread history** — for context mid-reply, the agent fetches the full thread with `pnpm action get-thread --id=<threadId>`.

How the agent takes action:

- **Mail operations** — archive, trash, star, mark read, send, draft — all run as `pnpm action <name>` scripts under `templates/mail/actions/`.
- **Navigation** — to open a thread or switch views for you, the agent writes `application_state.navigate`, which the UI consumes and deletes. The `pnpm action navigate` script wraps this.
- **Refresh** — after any change, the agent runs `pnpm action refresh-list` so the UI refetches.

## Keyboard shortcuts {#keyboard-shortcuts}

| Key       | Action                      |
| --------- | --------------------------- |
| `J`       | Next email                  |
| `K`       | Previous email              |
| `Up/Down` | Same as J/K                 |
| `Enter`   | Open focused email          |
| `E`       | Archive email or thread     |
| `D`       | Trash email or thread       |
| `S`       | Star or unstar              |
| `R`       | Reply                       |
| `U`       | Toggle read/unread          |
| `C`       | Compose new email           |
| `/`       | Focus search bar            |
| `Cmd+K`   | Open command palette        |
| `G I`     | Go to Inbox                 |
| `G S`     | Go to Starred               |
| `G T`     | Go to Sent                  |
| `G D`     | Go to Drafts                |
| `G A`     | Go to Archive               |
| `Esc`     | Close thread / clear search |

## Data model {#data-model}

When a Google account is connected, email lives in Gmail — the app is a view on top. When no account is connected, emails live in the SQL settings store under `getSetting("local-emails")` (empty by default).

| Store / Table                 | What it holds                                                  |
| ----------------------------- | -------------------------------------------------------------- |
| `getSetting("local-emails")`  | Local email fallback when no Google account is connected       |
| `getSetting("labels")`        | System and user labels, with unread counts                     |
| `getSetting("mail-settings")` | User profile, tracking preferences, signature, aliases         |
| `getSetting("aliases")`       | Email aliases                                                  |
| `email_tracking` table        | Open-pixel events for sent messages                            |
| `email_link_tracking` table   | Link-click events for sent messages                            |
| `application_state` table     | `navigation`, `navigate`, `compose-{id}` entries (ephemeral)   |
| `oauth_tokens` table          | Google OAuth tokens (provider `"google"`, one row per account) |

Emails flowing through the API have the shape `{ id, threadId, from, to, cc, subject, snippet, body, date, isRead, isStarred, isArchived, isTrashed, labelIds, accountEmail, attachments }`.

Routes in the UI:

- `/_index.tsx` — redirects to the default inbox view.
- `/$view.tsx` — a list view (`inbox`, `starred`, `sent`, `drafts`, `archive`, `trash`, etc.).
- `/$view.$threadId.tsx` — a list view with a specific thread open.
- `/email` — the embedded thread preview used in agent chat.
- `/settings` — account connections, tracking, automations.
- `/team` — team members and shared resources.

## Customizing it {#customizing-it}

Mail is yours to change. Everything important lives in a handful of places — start there.

**Adding an agent capability.** Add a new file under `templates/mail/actions/` using `defineAction`. Your action becomes both a CLI command (`pnpm action <name>`) and an HTTP endpoint (`/_agent-native/actions/<name>`). Look at `templates/mail/actions/star-email.ts` for a short example or `templates/mail/actions/manage-automations.ts` for one with multiple sub-actions. See the [actions](/docs/actions) docs for the full pattern.

**Changing the UI.** Routes are in `templates/mail/app/routes/` and components in `templates/mail/app/components/email/` and `templates/mail/app/components/layout/`. The app uses shadcn/ui primitives from `app/components/ui/` and Tabler Icons — stick to those.

**Changing how the agent behaves.** Agent guidance lives in `templates/mail/AGENTS.md` and the skills in `templates/mail/.agents/skills/` (`email-drafts`, `real-time-sync`, `security`, `self-modifying-code`, and others). Agent behavior is changed by editing markdown — not code.

**Changing data or settings.** Schemas for the tracking tables and related structures are in `templates/mail/server/db/`. Settings reads and writes go through `readSetting` / `writeSetting` from `@agent-native/core/settings`. Application state (navigation, drafts, one-shot commands) uses `readAppState` / `writeAppState` from `@agent-native/core/application-state`.

**Adding a new automation action type.** Extend the action schema in `templates/mail/actions/manage-automations.ts` and the executor in `templates/mail/actions/trigger-automations.ts`.

**Changing keyboard shortcuts.** Keybind handlers live in `templates/mail/app/components/email/` — search for `useHotkeys` or `addEventListener("keydown"` to find where each key is wired.

Ask the agent to make any of these changes for you. The agent can edit its own source — see the [self-modifying-code](/docs/self-modifying-code) docs.
