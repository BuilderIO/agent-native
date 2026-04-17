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

| Table                   | Holds                                                                     |
| ----------------------- | ------------------------------------------------------------------------- |
| `workspaces`            | One row per workspace. Brand color, default visibility, logo.             |
| `workspace_members`     | Who belongs to each workspace and their role.                             |
| `invites`               | Pending workspace invites (email, role, token).                           |
| `spaces`                | Topic spaces inside a workspace (engineering, design, etc.).              |
| `space_members`         | Who can see/post to each space.                                           |
| `folders`               | Library folders (nest via `parent_id`, scoped to space or personal).      |
| `recordings`            | The core resource. Title, video URL, duration, status, edits JSON, etc.   |
| `recording_shares`      | Per-user / per-org share grants via framework `sharing`.                  |
| `recording_tags`        | Free-form tags.                                                           |
| `recording_transcripts` | Whisper output — segments JSON + fullText + status.                       |
| `recording_ctas`        | Call-to-action buttons (label, URL, placement).                           |
| `recording_comments`    | Threaded comments with `video_timestamp_ms` + emoji reactions JSON.       |
| `recording_reactions`   | Emoji reactions tied to a video timestamp.                                |
| `recording_viewers`     | One row per viewer: watch total, completed %, whether the view counted.   |
| `recording_events`      | Granular events: view-start, watch-progress, seek, pause, cta-click, etc. |

Visibility and sharing use the framework `sharing` system — recordings are registered as a shareable resource in `server/db/index.ts` via `registerShareableResource({ type: "recording", ... })`. Use the auto-mounted `share-resource` / `set-resource-visibility` / `list-resource-shares` actions (see Sharing below). Password and `expiresAt` are **extra** privacy controls on top of framework visibility — they're in the `recordings` table.

## Application State

Ephemeral UI state lives in `application_state`, accessed via `readAppState(key)` / `writeAppState(key, value)` from `@agent-native/core/application-state`. The UI syncs here so the agent always knows what's on screen.

| State Key           | Purpose                                                               | Direction               |
| ------------------- | --------------------------------------------------------------------- | ----------------------- |
| `navigation`        | Current view + selected IDs (see shape below)                         | UI -> Agent (read-only) |
| `navigate`          | One-shot navigation command (auto-deleted after UI reads)             | Agent -> UI             |
| `refresh-signal`    | Bump timestamp — invalidates lists (recordings, comments, etc.)       | Agent -> UI             |
| `current-workspace` | Active workspace id (which roster / spaces / library the user sees)   | Bidirectional           |
| `record-intent`     | Request that the UI start a new recording (mode: `screen` / `camera`) | Agent -> UI             |
| `player-state`      | Current video time, playing, speed — set by the player                | UI -> Agent (read-only) |
| `editor-draft`      | In-progress non-destructive edits for the recording being edited      | Bidirectional           |
| `selection`         | User's current text selection inside transcript or comment            | UI -> Agent (read-only) |

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

| User request                                        | What to do                                                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| "What am I looking at?"                             | `pnpm action view-screen`                                                                                                                  |
| "Start a screen recording"                          | `pnpm action start-recording --mode=screen`                                                                                                |
| "Stop recording"                                    | `pnpm action stop-recording`                                                                                                               |
| "Rename this recording to 'Onboarding walkthrough'" | `pnpm action update-recording --id=<id> --title="Onboarding walkthrough"`                                                                  |
| "Write me a title and summary"                      | `pnpm action generate-ai-metadata --id=<id> --kind=title,summary` (delegates to agent chat in background)                                  |
| "Add chapters to this video"                        | `pnpm action generate-chapters --id=<id>`                                                                                                  |
| "Remove the filler words"                           | `pnpm action generate-filler-removal --id=<id>` (writes proposed trims into `editsJson` for user review)                                   |
| "Find the part where I talk about pricing"          | `pnpm action search-transcript --id=<id> --q="pricing"` then `pnpm action seek --id=<id> --ms=<offsetMs>`                                  |
| "Share this with alice@example.com as viewer"       | `pnpm action share-resource --resourceType=recording --resourceId=<id> --principalType=user --principalId=alice@example.com --role=viewer` |
| "Make this public"                                  | `pnpm action set-resource-visibility --resourceType=recording --resourceId=<id> --visibility=public`                                       |
| "Add a password to this share"                      | `pnpm action update-recording --id=<id> --password=<pw>`                                                                                   |
| "Set this to expire in 7 days"                      | `pnpm action update-recording --id=<id> --expiresAt=<iso>`                                                                                 |
| "Trim the first 30 seconds"                         | `pnpm action apply-edit --id=<id> --type=trim --startMs=0 --endMs=30000`                                                                   |
| "Split this at the current playhead"                | Read `player-state` for `currentMs`, then `apply-edit --type=split --atMs=<currentMs>`                                                     |
| "Move this recording to my 'Design Reviews' folder" | Look up folder id via `list-folders`, then `update-recording --id=<id> --folderId=<fid>`                                                   |
| "Archive this"                                      | `pnpm action archive-recording --id=<id>`                                                                                                  |
| "Delete this"                                       | `pnpm action trash-recording --id=<id>`                                                                                                    |
| "Show me my most-watched recordings"                | `pnpm action list-recordings --sort=views --limit=10`                                                                                      |
| "Who watched this?"                                 | `pnpm action list-viewers --id=<id>`                                                                                                       |
| "Reply to the comment at 1:23"                      | Use `list-comments --id=<id>` to find the thread, then `add-comment --recordingId=<id> --threadId=<tid> --content="..."`                   |
| "Give me an embed link that starts at 1:20"         | `pnpm action build-embed-url --id=<id> --t=80` — returns `/embed/<shareId>?t=80&autoplay=1`                                                |
| "Switch to the Product workspace"                   | `pnpm action set-current-workspace --id=<workspaceId>`                                                                                     |

After any recording mutation (rename, move, edit, archive, delete, add comment, etc.) the actions trigger a UI refresh automatically via `refresh-signal`.

## Actions

**Always use `pnpm action <name>` for all operations.** Scripts handle validation, access checks, and refresh signals. Never use `curl`, raw HTTP, or raw SQL (`db-exec`) for recording operations.

**Running actions from the frame.** The terminal cwd is the framework root. Always `cd` first:

```bash
cd templates/clips && pnpm action <name> [args]
```

`.env` is loaded automatically — **never manually set `DATABASE_URL` or other env vars**.

### Recording lifecycle

| Action             | Args                                                                | Purpose                                                  |
| ------------------ | ------------------------------------------------------------------- | -------------------------------------------------------- |
| `start-recording`  | `[--mode=screen\|camera\|screen+camera] [--withAudio] [--folderId]` | Ask the UI to start a recording (writes `record-intent`) |
| `stop-recording`   |                                                                     | Ask the UI to stop the active recording                  |
| `pause-recording`  |                                                                     | Pause the active recording                               |
| `resume-recording` |                                                                     | Resume the active recording                              |
| `create-recording` | `--title [--folderId] [--spaceIds] [--durationMs]`                  | Insert a recording row (used by the upload flow)         |

### Library + CRUD

| Action              | Args                                                                                                            | Purpose                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `list-recordings`   | `[--folderId] [--spaceId] [--includeArchived] [--includeTrashed] [--sort=recent\|views\|duration] [--limit]`    | List recordings the user has access to         |
| `search-recordings` | `--q <term> [--in=title,description,transcript]`                                                                | Search across title / description / transcript |
| `get-recording`     | `--id <id>`                                                                                                     | Get one recording with full metadata           |
| `update-recording`  | `--id <id> [--title] [--description] [--folderId] [--spaceIds] [--password] [--expiresAt] [--defaultSpeed] ...` | Update recording metadata                      |
| `archive-recording` | `--id <id>`                                                                                                     | Archive (hides from library, keeps viewable)   |
| `trash-recording`   | `--id <id>`                                                                                                     | Soft-delete — restorable from Trash            |
| `restore-recording` | `--id <id>`                                                                                                     | Restore from archive or trash                  |
| `delete-recording`  | `--id <id>`                                                                                                     | Permanently delete (requires `admin` role)     |
| `list-folders`      | `[--spaceId]`                                                                                                   | List folders in a space or personal library    |
| `create-folder`     | `--name <name> [--parentId] [--spaceId]`                                                                        | Create a folder                                |
| `list-spaces`       |                                                                                                                 | List spaces in the current workspace           |

### Transcript + AI

| Action                    | Args                                    | Purpose                                                                 |
| ------------------------- | --------------------------------------- | ----------------------------------------------------------------------- |
| `get-transcript`          | `--id <id>`                             | Return transcript segments + full text                                  |
| `search-transcript`       | `--id <id> --q <term>`                  | Find occurrences with timestamps                                        |
| `transcribe-recording`    | `--id <id>`                             | Run Whisper now (uses `OPENAI_API_KEY` directly — see Rules)            |
| `generate-ai-metadata`    | `--id <id> [--kind=title,summary,tags]` | Delegate AI title/summary/tags generation to the agent (background)     |
| `generate-chapters`       | `--id <id>`                             | Delegate chapter generation to the agent (background)                   |
| `generate-filler-removal` | `--id <id>`                             | Delegate filler-word detection — writes proposed trims into `editsJson` |

### Editor

| Action         | Args                                                                                  | Purpose                                                  |
| -------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `apply-edit`   | `--id <id> --type=trim\|cut\|split\|speed\|blur --startMs --endMs [--atMs] [--speed]` | Append a non-destructive edit into `editsJson`           |
| `reset-edits`  | `--id <id>`                                                                           | Clear `editsJson` back to `{}`                           |
| `export-video` | `--id <id> [--format=mp4\|webm]`                                                      | Kick off ffmpeg.wasm export of the edited video          |
| `seek`         | `--id <id> --ms <ms>`                                                                 | Tell the player to jump to a timestamp                   |
| `set-speed`    | `--id <id> --speed <n>`                                                               | Set playback speed (default is `1.2` for all recordings) |

### Sharing (framework-wide, auto-mounted)

| Action                    | Args                                                                                                                               | Purpose                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `share-resource`          | `--resourceType recording --resourceId <id> --principalType user\|org --principalId <email-or-orgId> --role viewer\|editor\|admin` | Grant a user or org access              |
| `unshare-resource`        | `--resourceType recording --resourceId <id> --principalType user\|org --principalId <value>`                                       | Revoke a share grant                    |
| `list-resource-shares`    | `--resourceType recording --resourceId <id>`                                                                                       | Show current visibility + all grants    |
| `set-resource-visibility` | `--resourceType recording --resourceId <id> --visibility private\|org\|public`                                                     | Change coarse visibility                |
| `build-embed-url`         | `--id <id> [--t <seconds>] [--autoplay] [--hideControls]`                                                                          | Build `/embed/<shareId>?t=…&autoplay=1` |

Password + `expiresAt` are **additions** stored directly on the recording row — they compose with the framework share grants. See the `video-sharing` skill.

### Comments + reactions

| Action            | Args                                                                          | Purpose                                |
| ----------------- | ----------------------------------------------------------------------------- | -------------------------------------- |
| `list-comments`   | `--recordingId <id>`                                                          | List threaded comments with timestamps |
| `add-comment`     | `--recordingId <id> --content <text> [--threadId] [--parentId] [--atMs <ms>]` | Post a comment or reply                |
| `resolve-comment` | `--id <commentId>`                                                            | Mark a thread resolved                 |
| `react`           | `--recordingId <id> --emoji <e> [--atMs <ms>]`                                | Drop an emoji reaction at a timestamp  |

### Analytics

| Action         | Args                          | Purpose                                                                       |
| -------------- | ----------------------------- | ----------------------------------------------------------------------------- |
| `list-viewers` | `--id <recordingId>`          | Viewers + watch totals + whether their view counted                           |
| `get-insights` | `--id <recordingId>`          | Aggregate: views, completion %, drop-off curve, CTA CTR                       |
| `view-event`   | `--id --kind --timestampMs …` | Record a granular event (also called from `/api/view-events` from the player) |

### Workspace

| Action                  | Args                                                        | Purpose                                                     |
| ----------------------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| `list-workspace-state`  |                                                             | Roster + spaces + folders summary for the current workspace |
| `set-current-workspace` | `--id <workspaceId>`                                        | Set which workspace is active                               |
| `invite-member`         | `--email <e> [--role viewer\|creator-lite\|creator\|admin]` | Send a workspace invite                                     |
| `update-member-role`    | `--email <e> --role <r>`                                    | Change an existing member's role                            |

### Navigation + context

| Action         | Args                                                                                     | Purpose                                     |
| -------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------- |
| `view-screen`  |                                                                                          | Snapshot of what the user is looking at now |
| `navigate`     | `--view <name> [--recordingId] [--spaceId] [--folderId] [--shareId] [--search] [--path]` | Navigate the UI                             |
| `refresh-list` |                                                                                          | Bump the `refresh-signal` timestamp         |

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
- **Purple `#625DF5`** is the Clips primary brand color. It maps to `--brand` in the Tailwind config and is the default `workspaces.brand_color`.
- **1.2x** is the default playback speed for every recording (stored in `recordings.default_speed`).
- **No decorative CSS transitions.** Keep the UI snappy.

## Rules

1. **All AI goes through the agent chat.** Call `sendToAgentChat({ background: true, context, message })` from UI or actions. Do **not** `import OpenAI` / `@anthropic-ai/sdk`. See the `ai-video-tools` skill.
2. **Transcription is the one exception.** Whisper runs directly against `OPENAI_API_KEY` because it takes an audio file, not a prompt. The secret is registered via the (upcoming) `registerRequiredSecret("OPENAI_API_KEY")` API — onboarding prompts for it. No other AI features may bypass the agent.
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
