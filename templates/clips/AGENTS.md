# Clips — Agent Guide

Clips is an agent-native screen-recording app. The agent and UI are equal partners: every library search, every transcript edit, every share-link tweak, every new Clip is something both the user and the agent can do — via the same actions, against the same SQL database, synced in real time by the framework's polling layer. This guide is how you (the agent) operate inside this app. See the root `AGENTS.md` for the framework-wide rules.

**Naming:** always call a recording a **"Clip"** in any user-facing string or agent message. Never use the word "Loom". Internal table / variable names (`recordings`, `recording_transcripts`, etc.) stay as-is.

**Core philosophy.** Users record videos, the app transcribes them, the agent then assists: suggests titles, writes summaries, builds chapters, removes filler words, finds the exact moment someone said X, opens the right recording, shares it with the right teammate, answers comments. The agent can do any of this without ever leaving the chat — because the UI exposes what the user is seeing via `application_state`, and every operation is a first-class action.

**Context is automatic.** The current screen state (navigation + recording metadata) is included with each message as a `<current-screen>` block. You don't need to call `view-screen` before every action. Use `view-screen` when you need a refreshed snapshot (e.g. after editing a recording, adding a comment, or changing views).

## Resources

Resources are SQL-backed persistent files for notes, learnings, and context.

**At the start of every conversation, read these resources (both personal and shared scopes):**

1. **`AGENTS.md`** — user-specific context like how the user names recordings, which teammates exist, and team preferences. Read both `--scope personal` and `--scope shared`.
2. **`LEARNINGS.md`** — the app's memory with user preferences, corrections, and patterns. Read both scopes.

**Update `LEARNINGS.md` when you learn something important** — user corrects your tone, shares preferences, or reveals a non-obvious pattern. Keep entries concise and grouped.

| Action            | Args                                           | Purpose                 |
| ----------------- | ---------------------------------------------- | ----------------------- |
| `resource-read`   | `--name <name> [--scope personal\|shared]`     | Read a resource         |
| `resource-write`  | `--name <name> --content <text> [--scope ...]` | Write/update a resource |
| `resource-list`   | `[--scope personal\|shared]`                   | List all resources      |
| `resource-delete` | `--name <name> [--scope personal\|shared]`     | Delete a resource       |

## Architecture

```
┌──────────────────────┐     ┌──────────────────────┐
│  Frontend            │     │  Agent Chat          │
│  (React + Vite)      │◄───►│  (AI agent)          │
│                      │     │                      │
│  - MediaRecorder     │     │  - calls actions     │
│    chunked upload    │     │  - edits metadata    │
│  - player + editor   │     │  - delegates AI      │
│  - writes app-state  │     │    via sendToAgent   │
└──────────┬───────────┘     └──────────┬───────────┘
           │                            │
           └──────────────┬─────────────┘
                          ▼
                  ┌───────────────┐
                  │  Nitro server │
                  │               │
                  │  actions/     │  ←  auto-mounted at
                  │  /api/*       │     /_agent-native/actions/:name
                  └───────┬───────┘
                          │
                          ▼
                  ┌───────────────┐
                  │  SQL Database │
                  │  (Neon/PG/SQL)│
                  └───────────────┘
                          │
                          ▼
                  ┌───────────────┐
                  │  Video storage│
                  │  (disk/R2/S3) │
                  └───────────────┘
```

## Data Sources

All structured data lives in SQL via Drizzle ORM — **dialect-agnostic** (Neon Postgres in production, SQLite for local). See `server/db/schema.ts` for full column definitions. This is the summary:

Team / tenant data lives in the framework's better-auth `organization` tables. Clips-specific data (spaces, folders, recordings, etc.) hangs off `organization_id` FKs.

| Table                        | Holds                                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `organization` (better-auth) | Team. Name, slug, logo. Managed by the framework — created via better-auth (or the `create-organization` action). |
| `member` (better-auth)       | Who belongs to each org and their role (`owner` / `admin` / `member`).                                            |
| `invitation` (better-auth)   | Pending org invites.                                                                                              |
| `organization_settings`      | Clips-specific org sidecar: `brand_color`, `brand_logo_url`, `default_visibility`. Keyed by `organization.id`.    |
| `spaces`                     | Topic spaces inside an org (engineering, design, etc.). FK: `organization_id`.                                    |
| `space_members`              | Who can see/post to each space.                                                                                   |
| `folders`                    | Library folders (nest via `parent_id`, scoped to space or personal). FK: `organization_id`.                       |
| `recordings`                 | The core resource. Title, video URL, duration, status, edits JSON, etc. FK: `organization_id`.                    |
| `recording_shares`           | Per-user / per-org share grants via framework `sharing`.                                                          |
| `recording_tags`             | Free-form tags. FK: `organization_id`.                                                                            |
| `recording_transcripts`      | Whisper output — segments JSON + fullText + status.                                                               |
| `recording_ctas`             | Call-to-action buttons (label, URL, placement).                                                                   |
| `recording_comments`         | Threaded comments with `video_timestamp_ms` + emoji reactions JSON. FK: `organization_id`.                        |
| `recording_reactions`        | Emoji reactions tied to a video timestamp.                                                                        |
| `recording_viewers`          | One row per viewer: watch total, completed %, whether the view counted.                                           |
| `recording_events`           | Granular events: view-start, watch-progress, seek, pause, cta-click, etc.                                         |

> Older schemas had Clips-specific `workspaces` / `workspace_members` / `invites` tables. Those have been **replaced** by better-auth's `organization` / `member` / `invitation` tables — any references you see to "workspace" in older code or data are deprecated aliases for "organization".

Visibility and sharing use the framework `sharing` system — recordings are registered as a shareable resource in `server/db/index.ts` via `registerShareableResource({ type: "recording", ... })`. Use the auto-mounted `share-resource` / `set-resource-visibility` / `list-resource-shares` actions (see Sharing below). Password and `expiresAt` are **extra** privacy controls on top of framework visibility — they're in the `recordings` table.

## Application State

Ephemeral UI state lives in `application_state`, accessed via `readAppState(key)` / `writeAppState(key, value)` from `@agent-native/core/application-state`. The UI syncs here so the agent always knows what's on screen.

| State Key        | Purpose                                                               | Direction               |
| ---------------- | --------------------------------------------------------------------- | ----------------------- |
| `navigation`     | Current view + selected IDs (see shape below)                         | UI -> Agent (read-only) |
| `navigate`       | One-shot navigation command (auto-deleted after UI reads)             | Agent -> UI             |
| `refresh-signal` | Bump timestamp — invalidates lists (recordings, comments, etc.)       | Agent -> UI             |
| `record-intent`  | Request that the UI start a new recording (mode: `screen` / `camera`) | Agent -> UI             |
| `player-state`   | Current video time, playing, speed — set by the player                | UI -> Agent (read-only) |
| `editor-draft`   | In-progress non-destructive edits for the recording being edited      | Bidirectional           |
| `selection`      | User's current text selection inside transcript or comment            | UI -> Agent (read-only) |

> Active organization lives in the better-auth session (`session.activeOrganizationId`), **not** in application state. An older `current-workspace` app-state key is deprecated. To switch orgs, use `useSwitchOrg()` on the client or better-auth's `setActiveOrganization` API. The previous session's active org is restored automatically on login.

### Navigation state shape

```json
{
  "view": "library",
  "recordingId": "rec_abc",
  "spaceId": "spc_xyz",
  "folderId": "fld_123",
  "shareId": "shr_888",
  "search": "onboarding"
}
```

Views: `library`, `spaces`, `space`, `archive`, `trash`, `record`, `recording`, `share`, `embed`, `insights`, `notifications`, `settings`.

**Do NOT write to `navigation`** — it is overwritten by the UI. To navigate, write to `navigate` via the `navigate` action.

## Common Tasks

| User request                                        | What to do                                                                                                                                                                                                            |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "What am I looking at?"                             | `pnpm action view-screen`                                                                                                                                                                                             |
| "Start a screen recording"                          | `pnpm action navigate --view=record` — then the user picks a mode and hits Start. Recording is a UI gesture (MediaRecorder needs user consent) — see Rule 10.                                                         |
| "Stop recording"                                    | Stop is a UI gesture. Users press the stop button in the recording toolbar.                                                                                                                                           |
| "Rename this recording to 'Onboarding walkthrough'" | `pnpm action update-recording --id=<id> --title="Onboarding walkthrough"`                                                                                                                                             |
| "Write me a title"                                  | Read transcript via `get-recording-player-data --recordingId=<id>`, then `update-recording --id=<id> --title="..."`                                                                                                   |
| "Write me a description/summary"                    | Read transcript via `get-recording-player-data --recordingId=<id>`, then `update-recording --id=<id> --description="..."`                                                                                             |
| "Add chapters to this video"                        | Read transcript, then `set-chapters --recordingId=<id> --chapters='[{"startMs":0,"title":"Intro"},...]'`                                                                                                              |
| "Remove the filler words"                           | `pnpm action remove-filler-words --recordingId=<id>` (appends proposed trims into `editsJson`)                                                                                                                        |
| "Remove silences"                                   | `pnpm action remove-silences --recordingId=<id> [--thresholdMs=500]`                                                                                                                                                  |
| "Find the part where I talk about pricing"          | Read `get-recording-player-data --recordingId=<id>` and grep the transcript segments for the term.                                                                                                                    |
| "Share this with alice@example.com as viewer"       | `pnpm action share-resource --resourceType=recording --resourceId=<id> --principalType=user --principalId=alice@example.com --role=viewer`                                                                            |
| "Make this public"                                  | `pnpm action set-resource-visibility --resourceType=recording --resourceId=<id> --visibility=public`                                                                                                                  |
| "Add a password to this share"                      | `pnpm action update-recording --id=<id> --password=<pw>`                                                                                                                                                              |
| "Set this to expire in 7 days"                      | `pnpm action update-recording --id=<id> --expiresAt=<iso>`                                                                                                                                                            |
| "Trim the first 30 seconds"                         | `pnpm action trim-recording --recordingId=<id> --startMs=0 --endMs=30000`                                                                                                                                             |
| "Split this at the current playhead"                | Read `player-state` for `currentMs`, then `split-recording --recordingId=<id> --atMs=<currentMs>`                                                                                                                     |
| "Move this recording to my 'Design Reviews' folder" | Look up folder id via `list-organization-state`, then `update-recording --id=<id> --folderId=<fid>` (or `move-recording --id=<id> --folderId=<fid>`)                                                                  |
| "Archive this"                                      | `pnpm action archive-recording --id=<id>`                                                                                                                                                                             |
| "Delete this"                                       | `pnpm action trash-recording --id=<id>`                                                                                                                                                                               |
| "Show me my most-watched recordings"                | `pnpm action list-recordings --sort=views --limit=10`                                                                                                                                                                 |
| "Who watched this?"                                 | `pnpm action list-viewers --recordingId=<id>`                                                                                                                                                                         |
| "Reply to the comment at 1:23"                      | Use `list-comments --recordingId=<id>` to find the thread, then `add-comment --recordingId=<id> --threadId=<tid> --content="..."`                                                                                     |
| "Give me a share link"                              | The public share link is `/share/<recordingId>` and the embed is `/embed/<recordingId>`. Make sure visibility is `public` via `set-resource-visibility` if needed.                                                    |
| "Switch to the Product organization"                | Use `list-organization-state` to find the org id, then on the client call `useSwitchOrg().mutate({ organizationId })` (or better-auth's `setActiveOrganization`). There is no `set-current-workspace` action anymore. |
| "Rename this organization"                          | Use better-auth's organization-update API, or `pnpm action set-organization-branding` for brand color / logo tweaks.                                                                                                  |

After any recording mutation (rename, move, edit, archive, delete, add comment, etc.) the actions trigger a UI refresh automatically via `refresh-signal`.

## Actions

**Always use `pnpm action <name>` for all operations.** Scripts handle validation, access checks, and refresh signals. Never use `curl`, raw HTTP, or raw SQL (`db-exec`) for recording operations.

**Running actions from the frame.** The terminal cwd is the framework root. Always `cd` first:

```bash
cd templates/clips && pnpm action <name> [args]
```

`.env` is loaded automatically — **never manually set `DATABASE_URL` or other env vars**.

> **Note on param names.** Most actions that reference a recording use `recordingId`. A handful of lifecycle actions (`archive-recording`, `trash-recording`, `restore-recording`, `update-recording`, `finalize-recording`, `delete-recording-permanent`) use `id` because they're CRUD on the recording row itself. Use what each table below says. When unsure, `ls actions/` and open the relevant file — its Zod schema is the source of truth.

### Recording lifecycle

Start / stop / pause are **UI gestures** — there is no server action. MediaRecorder needs an explicit user click (permission + user-activation). The agent sends the user to `/record` via `navigate --view=record`, the user picks the mode and hits Start.

| Action               | Args                                                                 | Purpose                                                                             |
| -------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `create-recording`   | `--title [--folderId] [--organizationId] [--hasCamera] [--hasAudio]` | Insert a recording row in `uploading` status. Called from the frontend upload flow. |
| `finalize-recording` | `--id <id>`                                                          | Internal — assembles chunks, uploads the blob, flips status to `ready`.             |

### Library + CRUD

| Action                       | Args                                                                                                                                                                       | Purpose                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `list-recordings`            | `[--view library\|space\|archive\|trash\|all] [--folderId] [--spaceId] [--search] [--tag] [--sort recent\|views\|oldest] [--limit] [--offset]`                             | List recordings the user has access to                                                            |
| `search-recordings`          | `--query <term> [--limit]`                                                                                                                                                 | Fuzzy search over title / description / transcripts                                               |
| `get-recording-player-data`  | `--recordingId <id>`                                                                                                                                                       | Everything the player page needs (metadata + transcript + comments + reactions + chapters + CTAs) |
| `update-recording`           | `--id <id> [--title] [--description] [--folderId] [--spaceIds] [--password] [--expiresAt] [--defaultSpeed] [--enableComments] [--enableReactions] [--enableDownloads] ...` | Update recording metadata                                                                         |
| `move-recording`             | `--id <id> --folderId <fid>`                                                                                                                                               | Move to a folder                                                                                  |
| `archive-recording`          | `--id <id>`                                                                                                                                                                | Archive (hidden from library, still viewable)                                                     |
| `trash-recording`            | `--id <id>`                                                                                                                                                                | Soft-delete — restorable from Trash                                                               |
| `restore-recording`          | `--id <id>`                                                                                                                                                                | Restore from archive or trash                                                                     |
| `delete-recording-permanent` | `--id <id>`                                                                                                                                                                | Permanently delete (requires `admin` role)                                                        |
| `tag-recording`              | `--recordingId <id> --tag <tag>`                                                                                                                                           | Add a free-form tag                                                                               |
| `set-thumbnail`              | `--recordingId <id> --atMs <ms>`                                                                                                                                           | Pick a frame as the thumbnail                                                                     |
| `add-recording-to-space`     | `--recordingId <id> --spaceId <sid>`                                                                                                                                       | Make a recording visible in a space                                                               |

### Folders + spaces

| Action                    | Args                                                            | Purpose                                                                                                 |
| ------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `list-organization-state` |                                                                 | Members + spaces + folders for the active organization (use instead of `list-folders` / `list-spaces`). |
| `create-folder`           | `--name <name> --organizationId <oid> [--parentId] [--spaceId]` | Create a folder (organizationId is required).                                                           |
| `rename-folder`           | `--id <fid> --name <name>`                                      | Rename a folder.                                                                                        |
| `delete-folder`           | `--id <fid>`                                                    | Delete an empty folder.                                                                                 |
| `create-space`            | `--name <name> [--description] [--icon] [--color]`              | Create a topic space.                                                                                   |
| `rename-space`            | `--id <sid> --name <name>`                                      | Rename a space.                                                                                         |
| `delete-space`            | `--id <sid>`                                                    | Delete a space.                                                                                         |
| `add-space-member`        | `--spaceId <sid> --email <e> [--role]`                          | Add a member to a space.                                                                                |
| `remove-space-member`     | `--spaceId <sid> --email <e>`                                   | Remove a member from a space.                                                                           |

### Transcript + AI

| Action                    | Args                                     | Purpose                                                                                                                                                                                             |
| ------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `request-transcript`      | `--recordingId <id>`                     | Transcribe via Builder → Groq → OpenAI (priority order). See Rule 2. Writes segments + fullText to `recording_transcripts`.                                                                         |
| `save-browser-transcript` | `--recordingId <id> --fullText "..."`    | Save a Web Speech API transcript (instant, no key). Higher-quality backends refine it later; won't overwrite an existing Whisper result.                                                            |
| `regenerate-title`        | `--recordingId <id>`                     | Queue a delegation for the agent chat to regenerate the title. **Only useful via agent chat** — CLI invocation just writes the request; the agent (in the open chat window) actually does the work. |
| `regenerate-summary`      | `--recordingId <id>`                     | Same pattern as `regenerate-title` — delegation queue for the agent.                                                                                                                                |
| `regenerate-chapters`     | `--recordingId <id>`                     | Same pattern — delegation queue for the agent.                                                                                                                                                      |
| `set-chapters`            | `--recordingId <id> --chapters '<json>'` | Directly set `chaptersJson`. Shape: `[{"startMs":0,"title":"Intro"},...]`.                                                                                                                          |
| `generate-workflow`       | `--recordingId <id>`                     | Delegate: agent extracts the repeatable workflow from the transcript.                                                                                                                               |

### Editor (non-destructive — writes into `editsJson`)

| Action                | Args                                           | Purpose                                                            |
| --------------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| `trim-recording`      | `--recordingId <id> --startMs <n> --endMs <n>` | Trim a span                                                        |
| `split-recording`     | `--recordingId <id> --atMs <n>`                | Split at a timestamp                                               |
| `remove-filler-words` | `--recordingId <id>`                           | Detect filler words (um, uh, like) and write them as proposed cuts |
| `remove-silences`     | `--recordingId <id> [--thresholdMs <n>]`       | Cut long silences                                                  |
| `stitch-recordings`   | `--recordingIds '<json-array>' --title <t>`    | Create a new recording that stitches several clips                 |
| `clear-edits`         | `--recordingId <id>`                           | Clear `editsJson` back to `{}`                                     |
| `undo-edit`           | `--recordingId <id>`                           | Remove the last edit from `editsJson`                              |

### Sharing (framework-wide, auto-mounted)

| Action                    | Args                                                                                                                               | Purpose                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `share-resource`          | `--resourceType recording --resourceId <id> --principalType user\|org --principalId <email-or-orgId> --role viewer\|editor\|admin` | Grant a user or org access           |
| `unshare-resource`        | `--resourceType recording --resourceId <id> --principalType user\|org --principalId <value>`                                       | Revoke a share grant                 |
| `list-resource-shares`    | `--resourceType recording --resourceId <id>`                                                                                       | Show current visibility + all grants |
| `set-resource-visibility` | `--resourceType recording --resourceId <id> --visibility private\|org\|public`                                                     | Change coarse visibility             |

Password + `expiresAt` are **additions** stored directly on the recording row — they compose with the framework share grants. See the `video-sharing` skill.

Public share link: `/share/<recordingId>`. Embed: `/embed/<recordingId>`. Both require `visibility=public`.

### Comments + reactions

| Action               | Args                                                                                      | Purpose                                |
| -------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------- |
| `list-comments`      | `--recordingId <id>`                                                                      | List threaded comments with timestamps |
| `add-comment`        | `--recordingId <id> --content <text> [--threadId] [--parentId] [--videoTimestampMs <ms>]` | Post a comment or top-level reaction   |
| `reply-to-comment`   | `--parentId <cid> --content <text>`                                                       | Reply within an existing thread        |
| `resolve-comment`    | `--id <commentId>`                                                                        | Mark a thread resolved                 |
| `delete-comment`     | `--id <commentId>`                                                                        | Delete a comment                       |
| `react-to-recording` | `--recordingId <id> --emoji <e> [--videoTimestampMs <ms>]`                                | Drop an emoji reaction at a timestamp  |

### Analytics

| Action                      | Args                           | Purpose                                                  |
| --------------------------- | ------------------------------ | -------------------------------------------------------- |
| `list-viewers`              | `--recordingId <id> [--limit]` | Viewers + watch totals + whether their view counted.     |
| `get-recording-insights`    | `--recordingId <id>`           | Aggregate: views, completion %, drop-off curve, CTA CTR. |
| `get-organization-insights` |                                | Aggregate analytics for the active organization.         |
| `export-insights-csv`       | `--recordingId <id>`           | Download insights for a recording as CSV.                |

Granular per-event recording (view-start / watch-progress / seek / pause / cta-click) is a custom HTTP route at `POST /api/view-event`, not an action — the player hits it directly.

### Organization + invites

Teams in Clips are better-auth organizations. Membership, roles, and invitations live on the framework `organization` / `member` / `invitation` tables. The actions below are thin Clips-specific wrappers that operate on those tables.

| Action                      | Args                                        | Purpose                                                                                                                                                                        |
| --------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list-organization-state`   |                                             | Roster + spaces + folders summary for the active organization.                                                                                                                 |
| `create-organization`       | `--name <name> [--slug] [--brandColor]`     | Create a new organization (delegates to better-auth, seeds `organization_settings`).                                                                                           |
| `set-organization-branding` | `--brandColor <hex> [--brandLogoUrl]`       | Update the active organization's `organization_settings` row (brand color / logo).                                                                                             |
| `invite-member`             | `--email <e> [--role owner\|admin\|member]` | Send an invite. Roles are the better-auth standard three: `owner`, `admin`, `member`. The previous 4-role system (viewer / creator-lite / creator / admin) has been flattened. |
| `update-member-role`        | `--email <e> --role <r>`                    | Change an existing member's role.                                                                                                                                              |
| `remove-member`             | `--email <e>`                               | Remove a member from the organization.                                                                                                                                         |
| `get-invite`                | `--token <t>`                               | Look up a pending invite.                                                                                                                                                      |
| `accept-invite`             | `--token <t>`                               | Accept a pending invite.                                                                                                                                                       |
| `decline-invite`            | `--token <t>`                               | Decline a pending invite.                                                                                                                                                      |

> **Switching orgs.** There is no `set-current-workspace` action — the active org lives in the better-auth session. From the client use `useSwitchOrg().mutate({ organizationId })`; server-side use better-auth's `setActiveOrganization` API.

### Navigation + context

| Action               | Args                                                                                     | Purpose                                     |
| -------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------- |
| `view-screen`        |                                                                                          | Snapshot of what the user is looking at now |
| `navigate`           | `--view <name> [--recordingId] [--spaceId] [--folderId] [--shareId] [--search] [--path]` | Navigate the UI                             |
| `refresh-list`       |                                                                                          | Bump the `refresh-signal` timestamp         |
| `list-notifications` |                                                                                          | List the current user's notifications       |

## API Routes

Custom routes only exist for things actions can't do well — file uploads (binary body), high-frequency event writes, and third-party webhooks. Everything else is an action.

| Method | Route                   | Purpose                                                   |
| ------ | ----------------------- | --------------------------------------------------------- |
| POST   | `/api/uploads/chunk`    | Receive a MediaRecorder chunk (append to current upload)  |
| POST   | `/api/uploads/complete` | Finalize upload — sets `recordings.status = processing`   |
| GET    | `/api/video/:id`        | Stream the video bytes (respects `visibility` / shares)   |
| GET    | `/api/thumbnail/:id`    | Return static thumbnail                                   |
| POST   | `/api/view-events`      | Record a watch-progress / seek / pause / cta-click event  |
| POST   | `/api/webhooks/whisper` | Webhook for async Whisper completion (updates transcript) |

All standard CRUD (list, get, create, update) goes through `/_agent-native/actions/:name` — use `useActionQuery` / `useActionMutation` from the client.

## Keyboard Shortcuts

| Key                   | Action                                       |
| --------------------- | -------------------------------------------- |
| `Cmd+Shift+L`         | Start a new recording (global)               |
| `Space`               | Play / pause                                 |
| `J`                   | Skip back 10s                                |
| `K`                   | Play / pause                                 |
| `L`                   | Skip forward 10s                             |
| `←` / `→`             | Skip back / forward 5s                       |
| `Shift+←` / `Shift+→` | Previous / next chapter                      |
| `↑` / `↓`             | Volume up / down                             |
| `F`                   | Fullscreen                                   |
| `M`                   | Mute / unmute                                |
| `,` / `.`             | Step one frame back / forward (while paused) |
| `-` / `+`             | Slower / faster playback                     |
| `C`                   | Toggle captions                              |
| `I`                   | Mark In-point (editor)                       |
| `O`                   | Mark Out-point (editor)                      |
| `X`                   | Cut selection (editor)                       |
| `S`                   | Split at playhead (editor)                   |
| `/`                   | Focus library search                         |
| `⌘K`                  | Command menu                                 |
| `Esc`                 | Close player / clear selection               |
| `G then L`            | Go to Library                                |
| `G then S`            | Go to Spaces                                 |
| `G then A`            | Go to Archive                                |
| `G then T`            | Go to Trash                                  |

## UI Components

- **shadcn/ui only** for all standard patterns (dialogs, popovers, dropdowns, tooltips, buttons). Never build custom modals or positioned overlays by hand.
- **Tabler Icons only** (`@tabler/icons-react`). No other icon libraries. Do **not** use robot or sparkle icons to represent the agent / AI.
- **Never** use `window.confirm`, `window.alert`, or `window.prompt`. Use shadcn `AlertDialog`.
- **Inter font** for all UI.
- **Monochrome aesthetic.** Default space/folder/org color is `#18181B` (neutral zinc-900). Brand color is user-customizable via `set-organization-branding` (stored in `organization_settings`).
- **1.2x** is the default playback speed for every recording (stored in `recordings.default_speed`).
- **Keep shadcn default transitions** (animate-in/out, fade, zoom, slide). Avoid custom decorative transitions — keep the UI snappy.

## Rules

1. **All AI goes through the agent chat.** Call `sendToAgentChat({ background: true, context, message })` from UI or actions. Do **not** `import OpenAI` / `@anthropic-ai/sdk`. See the `ai-video-tools` skill.
2. **Transcription is the one exception.** Runs directly because it takes an audio file, not a prompt. `request-transcript` provider priority: **Builder** (via `BUILDER_PRIVATE_KEY`, no extra key needed) → **Groq** (`whisper-large-v3-turbo`, fast) → **OpenAI** (`whisper-1`). The browser's Web Speech API also runs during recording via `save-browser-transcript`, giving an instant transcript with no API key — higher-quality backends refine it afterward. No other AI features may bypass the agent.
3. **Edits are non-destructive.** Never re-encode on edit. Every trim/cut/split/blur/speed change is appended to `recordings.edits_json`. The player applies edits live; `export-video` only renders when the user explicitly exports. See `video-editing`.
4. **View-counting rule.** A view counts when the viewer hits **≥ 5 seconds** OR **≥ 75% completion** OR scrubs to the end. `shouldCountView` in `server/lib/recordings.ts` is the canonical check — always go through it.
5. **Use the framework sharing system.** Never write custom share tables for recordings. `registerShareableResource({ type: "recording", ... })` is already wired in `server/db/index.ts`. Compose with the auto-mounted actions. Add password + `expiresAt` as **additional** checks in the share-resolution path, not replacements. See `video-sharing`.
6. **SQL must be dialect-agnostic.** The target is Neon Postgres. Use Drizzle operators only. No SQLite-specific functions (`datetime('now')`, `|| ''`), no `json_extract`, no `ROWID`. Use `now()` from `@agent-native/core/db/schema`. See the `portability` skill.
7. **Screen context is auto-included.** Check `<current-screen>` in the user's message before running `view-screen` — you usually don't need to call it.
8. **Trigger refresh after mutations.** `writeAppState("refresh-signal", { ts: Date.now() })` — `useDbSync` invalidates the affected query keys. Most actions do this automatically.
9. **Scoping.** All list/get actions filter via `accessFilter(schema.recordings, schema.recordingShares)`. Write actions guard via `assertAccess("recording", id, "editor")` (or `"admin"` for delete).
10. **No pre-recording state without consent.** Never start the MediaRecorder without an explicit user gesture — `start-recording` only writes `record-intent`; the UI is responsible for prompting for camera/mic permissions.

## Authentication

Auth is automatic and environment-driven:

- **Dev mode.** Auth is bypassed. `getSession()` returns `{ email: "local@localhost" }`.
- **Production** (`ACCESS_TOKEN` set). Auth middleware auto-mounts.

Use `getSession(event)` server-side and `useSession()` client-side. All per-user scoping uses `getRequestUserEmail()` from `@agent-native/core/server/request-context`.

## Skills

Read the skill files in `.agents/skills/` for detailed patterns:

| Skill                 | When to read                                                      |
| --------------------- | ----------------------------------------------------------------- |
| `recording`           | Before touching MediaRecorder, chunked upload, or permissions     |
| `video-editing`       | Before modifying `editsJson`, building the editor, or export flow |
| `ai-video-tools`      | Before adding any AI feature (titles, summaries, chapters, etc.)  |
| `video-sharing`       | Before wiring share links, passwords, expiry, or embeds           |
| `sharing`             | Framework-wide sharing primitives (already wired for recordings)  |
| `storing-data`        | Before adding a new table or application-state key                |
| `real-time-sync`      | When wiring new query invalidations or debugging stale UI         |
| `delegate-to-agent`   | Before adding any LLM call                                        |
| `actions`             | Before creating a new action                                      |
| `self-modifying-code` | Before editing components, routes, or styles                      |
| `frontend-design`     | Before building or restyling any UI                               |

## Development

For code editing and development guidance, read `DEVELOPING.md`.
