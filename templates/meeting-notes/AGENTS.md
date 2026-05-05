# Meeting Notes -- Agent Guide

Meeting Notes is an agent-native meeting notes app inspired by Granola. The agent and UI are equal partners: creating meetings, taking notes, enhancing notes with transcripts, browsing contacts -- everything is something both the user and the agent can do via the same actions, against the same SQL database, synced in real time by the framework's polling layer. This guide is how you (the agent) operate inside this app. See the root `AGENTS.md` for the framework-wide rules.

**Naming:** always call this app **"Notes"** in user-facing strings and agent messages. Internal table/variable names (`meetings`, `meeting_notes`, etc.) stay as-is.

**Core philosophy.** Users create meetings (from calendar events or ad-hoc), take notes during the meeting, and optionally record audio for transcription. After the meeting, the agent merges the user's raw notes with the transcript to produce comprehensive, structured meeting notes. The agent can also search past meetings, find action items, identify patterns across meetings, and answer questions about what was discussed. Everything happens through the chat -- the agent never calls an LLM directly.

**Context is automatic.** The current screen state (navigation + meeting metadata) is included with each message as a `<current-screen>` block. You don't need to call `view-screen` before every action. Use `view-screen` when you need a refreshed snapshot (e.g. after editing a meeting or enhancing notes).

## The Meeting Workflow

### Before the meeting

1. Meeting is created (from calendar sync or manually via `create-meeting`)
2. Status is `scheduled`
3. Attendees are added (from calendar or manually)

### During the meeting

1. User opens the meeting and starts taking notes in the editor
2. Status changes to `recording` if audio transcription is active
3. Raw notes are saved to `meeting_notes.raw_content` in real time
4. Transcript streams into `meeting_transcripts` if audio is enabled

### After the meeting

1. User (or agent) triggers `enhance-notes` to merge raw notes with the transcript
2. Status changes to `enhancing` while the agent works
3. Agent produces structured notes in `meeting_notes.enhanced_content`
4. Status changes to `done`

## Resources

Resources are SQL-backed persistent files for notes, learnings, and context.

**At the start of every conversation, read these resources (both personal and shared scopes):**

1. **`AGENTS.md`** -- user-specific context like meeting naming conventions and team preferences. Read both `--scope personal` and `--scope shared`.
2. **`LEARNINGS.md`** -- the app's memory with user preferences, corrections, and patterns. Read both scopes.

**Update `LEARNINGS.md` when you learn something important** -- user corrects your tone, shares preferences, or reveals a non-obvious pattern. Keep entries concise and grouped.

## Architecture

```
+----------------------+     +----------------------+
|  Frontend            |     |  Agent Chat          |
|  (React + Vite)      |<--->|  (AI agent)          |
|                      |     |                      |
|  - Note editor       |     |  - calls actions     |
|  - Meeting list      |     |  - enhances notes    |
|  - People/companies  |     |  - delegates AI      |
|  - writes app-state  |     |    via sendToAgent   |
+----------+-----------+     +----------+-----------+
           |                            |
           +------------+---------------+
                        v
                +---------------+
                |  Nitro server |
                |               |
                |  actions/     |  <-  auto-mounted at
                |  /api/*       |     /_agent-native/actions/:name
                +-------+-------+
                        |
                        v
                +---------------+
                |  SQL Database |
                |  (Neon/PG/SQL)|
                +---------------+
```

## Data Sources

All structured data lives in SQL via Drizzle ORM -- **dialect-agnostic** (Neon Postgres in production, SQLite for local). See `server/db/schema.ts` for full column definitions.

| Table                 | Holds                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------- |
| `meetings`            | The core resource. Title, start/end time, status, calendar sync info. FK: `organization_id`. |
| `meeting_shares`      | Per-user / per-org share grants via framework `sharing`.                                     |
| `meeting_transcripts` | Audio-to-text output -- segments JSON + fullText + speaker labels + status.                  |
| `meeting_notes`       | User's raw notes + AI-enhanced version. One row per meeting.                                 |
| `meeting_templates`   | Reusable prompts for structuring enhanced notes (e.g. "Standup", "1:1", "Decision Log").     |
| `meeting_attendees`   | Who was in each meeting (name, email, role).                                                 |
| `meeting_folders`     | Organize meetings into groups (nest via `parent_id`).                                        |
| `people`              | Contacts built from meeting attendees. Name, email, title, company, meeting count.           |
| `companies`           | Companies extracted from attendee email domains.                                             |
| `recipes`             | Reusable AI prompts that run over one or more meetings (e.g. "Extract all action items").    |

## Application State

Ephemeral UI state lives in `application_state`, accessed via `readAppState(key)` / `writeAppState(key, value)` from `@agent-native/core/application-state`.

| State Key        | Purpose                                                   | Direction               |
| ---------------- | --------------------------------------------------------- | ----------------------- |
| `navigation`     | Current view + selected IDs (see shape below)             | UI -> Agent (read-only) |
| `navigate`       | One-shot navigation command (auto-deleted after UI reads) | Agent -> UI             |
| `refresh-signal` | Bump timestamp -- invalidates lists                       | Agent -> UI             |
| `selection`      | User's current text selection inside the note editor      | UI -> Agent (read-only) |

### Navigation state shape

```json
{
  "view": "meetings",
  "meetingId": "mtg_abc",
  "folderId": "fld_123",
  "search": "product review"
}
```

Views: `meetings`, `meeting`, `people`, `companies`, `templates`, `settings`.

**Do NOT write to `navigation`** -- it is overwritten by the UI. To navigate, write to `navigate` via the `navigate` action.

## Common Tasks

| User request                               | What to do                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| "What am I looking at?"                    | `pnpm action view-screen`                                                                                          |
| "Create a meeting for my 1:1 with Alice"   | `pnpm action create-meeting --title="1:1 with Alice" --attendees='[{"name":"Alice","email":"alice@example.com"}]'` |
| "Enhance my notes for this meeting"        | `pnpm action enhance-notes --meetingId=<id>`                                                                       |
| "Enhance notes using the standup template" | `pnpm action enhance-notes --meetingId=<id> --templateId=<tid>`                                                    |
| "Rename this meeting"                      | `pnpm action update-meeting --id=<id> --title="New title"`                                                         |
| "Show me today's meetings"                 | `pnpm action list-meetings --startAfter=<today-start> --startBefore=<today-end>`                                   |
| "Find meetings about pricing"              | `pnpm action list-meetings --search="pricing"`                                                                     |
| "Who have I met with the most?"            | `pnpm action list-people --sort=meetings --limit=10`                                                               |
| "What companies have I met with?"          | `pnpm action list-companies`                                                                                       |
| "Create a standup template"                | `pnpm action create-template --name="Standup" --prompt="Structure as: Yesterday, Today, Blockers"`                 |
| "List my templates"                        | `pnpm action list-templates`                                                                                       |
| "Share this meeting with bob@example.com"  | `pnpm action share-resource --resourceType=meeting --resourceId=<id> --principalType=user --principalId=bob@...`   |
| "Navigate to the meetings list"            | `pnpm action navigate --view=meetings`                                                                             |

After any meeting mutation (rename, enhance, status change, etc.) the actions trigger a UI refresh automatically via `refresh-signal`.

## Actions

**Always use `pnpm action <name>` for all operations.** Actions handle validation, access checks, and refresh signals. Never use `curl`, raw HTTP, or raw SQL for meeting operations.

**Running actions from the frame.** The terminal cwd is the framework root. Always `cd` first:

```bash
cd templates/meeting-notes && pnpm action <name> [args]
```

### Meeting lifecycle

| Action           | Args                                                                                                    | Purpose                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `create-meeting` | `--title [--startTime] [--endTime] [--calendarEventId] [--calendarProvider] [--folderId] [--attendees]` | Create a new meeting                                     |
| `update-meeting` | `--id <id> [--title] [--status] [--startTime] [--endTime] [--folderId]`                                 | Update meeting metadata                                  |
| `list-meetings`  | `[--status] [--folderId] [--startAfter] [--startBefore] [--search] [--sort] [--limit]`                  | List meetings with filtering                             |
| `get-meeting`    | `--meetingId <id>`                                                                                      | Get a single meeting with transcript + notes + attendees |

### Notes + AI

| Action            | Args                                    | Purpose                                                          |
| ----------------- | --------------------------------------- | ---------------------------------------------------------------- |
| `enhance-notes`   | `--meetingId <id> [--templateId <tid>]` | Merge raw notes with transcript via AI (delegates to agent chat) |
| `list-templates`  |                                         | List note enhancement templates                                  |
| `create-template` | `--name <name> --prompt <text>`         | Create a custom note enhancement template                        |

### People + Companies

| Action           | Args                                         | Purpose                            |
| ---------------- | -------------------------------------------- | ---------------------------------- |
| `list-people`    | `[--search] [--sort name\|recent\|meetings]` | List people from meeting attendees |
| `list-companies` | `[--search]`                                 | List companies from email domains  |

### Sharing (framework-wide, auto-mounted)

| Action                    | Args                                                                                                           | Purpose                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `share-resource`          | `--resourceType meeting --resourceId <id> --principalType user\|org --principalId <email-or-orgId> --role ...` | Grant a user or org access           |
| `unshare-resource`        | `--resourceType meeting --resourceId <id> --principalType user\|org --principalId <value>`                     | Revoke a share grant                 |
| `list-resource-shares`    | `--resourceType meeting --resourceId <id>`                                                                     | Show current visibility + all grants |
| `set-resource-visibility` | `--resourceType meeting --resourceId <id> --visibility private\|org\|public`                                   | Change coarse visibility             |

### Navigation + context

| Action         | Args                                                           | Purpose                                     |
| -------------- | -------------------------------------------------------------- | ------------------------------------------- |
| `view-screen`  |                                                                | Snapshot of what the user is looking at now |
| `navigate`     | `--view <name> [--meetingId] [--folderId] [--search] [--path]` | Navigate the UI                             |
| `refresh-list` |                                                                | Bump the `refresh-signal` timestamp         |

## Calendar Integration

Meetings can be synced from Google Calendar or Microsoft Calendar via `calendarEventId` and `calendarProvider` fields. When a meeting is created from a calendar event:

1. The `calendarEventId` and `calendarProvider` are stored on the meeting row
2. Attendees from the calendar event are added to `meeting_attendees`
3. The agent can use `calendarEventId` to detect duplicate meetings

## The "Enhance Notes" AI Flow

The enhance-notes action is the core AI feature:

1. User finishes a meeting and has raw notes in the editor
2. User or agent calls `enhance-notes --meetingId=<id>`
3. The action:
   a. Reads the meeting metadata, raw notes, and transcript
   b. Optionally loads a template for structuring the output
   c. Sets meeting status to `enhancing`
   d. Writes a delegation request to application_state
4. The agent processes the notes + transcript and produces structured output
5. The enhanced content is stored in `meeting_notes.enhanced_content`
6. Meeting status is set to `done`

Templates control the output structure. Built-in templates include things like "Standup" (Yesterday/Today/Blockers), "1:1" (Topics/Action Items/Follow-ups), "Decision Log" (Decisions/Rationale/Next Steps).

## Rules

1. **All AI goes through the agent chat.** Delegate to the agent by writing a structured request to `application_state` via `writeAppState`. Do **not** `import OpenAI` / `@anthropic-ai/sdk` directly.
2. **Transcription is the one exception.** Audio-to-text runs directly via Deepgram or AssemblyAI because it takes raw audio, not a prompt.
3. **SQL must be dialect-agnostic.** The target is Neon Postgres. Use Drizzle operators only. No SQLite-specific functions, no `json_extract`, no `ROWID`. Use `now()` from `@agent-native/core/db/schema`. See the `portability` skill.
4. **Screen context is auto-included.** Check `<current-screen>` in the user's message before running `view-screen`.
5. **Trigger refresh after mutations.** `writeAppState("refresh-signal", { ts: Date.now() })` -- most actions do this automatically.
6. **Scoping.** All list/get actions filter via `accessFilter(schema.meetings, schema.meetingShares)`.

## Authentication

This template uses the framework's default auth — Better Auth, with email/password and optional Google / GitHub social providers. Use `getSession(event)` server-side and `useSession()` client-side.

See the `authentication` skill for the full mode matrix (`AUTH_MODE=local`, `ACCESS_TOKEN`, `AUTH_DISABLED`, BYOA) and the `security` skill for the access-control model. List/get actions in this template filter via `accessFilter(schema.meetings, schema.meetingShares)`.

## UI Components

- **shadcn/ui only** for all standard patterns. Never build custom modals or positioned overlays by hand.
- **Tabler Icons only** (`@tabler/icons-react`). No other icon libraries.
- **Never** use `window.confirm`, `window.alert`, or `window.prompt`. Use shadcn `AlertDialog`.

## Skills

Read the skill files in `.agents/skills/` for detailed patterns:

| Skill                 | When to read                                                   |
| --------------------- | -------------------------------------------------------------- |
| `storing-data`        | Before adding a new table or application-state key             |
| `real-time-sync`      | When wiring new query invalidations or debugging stale UI      |
| `delegate-to-agent`   | Before adding any LLM call                                     |
| `actions`             | Before creating a new action                                   |
| `self-modifying-code` | Before editing components, routes, or styles                   |
| `frontend-design`     | Before building or restyling any UI                            |
| `sharing`             | Framework-wide sharing primitives (already wired for meetings) |
