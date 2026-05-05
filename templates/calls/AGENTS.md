# Calls — Agent Guide

Calls is an agent-native conversation-intelligence app — a Gong-style workspace for recording, transcribing, and analyzing sales and customer conversations. The agent and UI are equal partners: every upload, every transcript diarization, every tracker hit, every shared snippet is something both the user and the agent can do — via the same actions, against the same SQL database, synced in real time by the framework's polling layer. Users upload files, record in the browser, or invite a meeting bot; the app transcribes with Deepgram and diarizes speakers; the agent summarizes, detects trackers, surfaces questions, and helps share moments. This guide is how you (the agent) operate inside this app. See the root `AGENTS.md` for the framework-wide rules.

**Naming:** always call them **"Call"** in any user-facing string or agent message. Never use the word "Gong". Internal table / variable names (`calls`, `call_transcripts`, etc.) stay as-is.

**Core philosophy.** Users capture conversations (upload, browser recorder, or meeting bot). Deepgram transcribes with diarization. The agent then assists: writes the recap, extracts key points and next steps, detects tracker hits, suggests snippets to share, answers questions about what was said, relabels speakers, finds the exact moment pricing came up, shares a moment with a teammate, replies to comments. The agent can do any of this without ever leaving the chat — because the UI exposes what the user is seeing via `application_state`, and every operation is a first-class action.

**Context is automatic.** The current screen state (navigation + selected call / snippet / transcript selection) is included with each message as a `<current-screen>` block. You don't need to call `view-screen` before every action. Use `view-screen` when you need a refreshed snapshot (e.g. after editing a call, adding a comment, or changing views).

## Resources

Resources are SQL-backed persistent files for notes, learnings, and context.

**At the start of every conversation, read these resources (both personal and shared scopes):**

1. **`AGENTS.md`** — user-specific context like how the user names calls, which accounts exist, deal-stage conventions, and team preferences. Read both `--scope personal` and `--scope shared`.
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
│  - Upload / record   │     │  - calls actions     │
│    chunked upload    │     │  - edits metadata    │
│  - player + tabs     │     │  - writes summary    │
│  - writes app-state  │     │    topics, trackers  │
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
                ┌─────────┼─────────┐
                ▼         ▼         ▼
         ┌──────────┐ ┌────────┐ ┌────────────┐
         │  SQL DB  │ │Deepgram│ │ Blob store │
         │(Neon/PG) │ │(Nova-3)│ │(disk/R2/S3)│
         └──────────┘ └────────┘ └────────────┘
```

## Data Sources

All structured data lives in SQL via Drizzle ORM — **dialect-agnostic** (Neon Postgres in production, SQLite for local). See `server/db/schema.ts` for full column definitions. This is the summary:

| Table                 | Holds                                                                              |
| --------------------- | ---------------------------------------------------------------------------------- |
| `workspaces`          | One row per workspace. Brand color, default visibility, slug, logo.                |
| `workspace_members`   | Who belongs to each workspace and their role.                                      |
| `invites`             | Pending workspace invites (email, role, token).                                    |
| `spaces`              | Topic spaces inside a workspace (all-company, discovery calls, demos, etc.).       |
| `space_members`       | Who can see / contribute to each space.                                            |
| `folders`             | Library folders (nest via `parent_id`, scoped to space or personal).               |
| `calls`               | The core resource. Title, media URL, duration, source, status, sharing extras.     |
| `call_shares`         | Per-user / per-org share grants via framework `sharing`.                           |
| `call_participants`   | One row per diarized speaker — display name, email, talk stats.                    |
| `call_transcripts`    | Deepgram output — `segments_json`, `full_text`, language, provider, status.        |
| `call_summaries`      | Agent-generated recap, key points, next steps, topics, questions, action items.    |
| `tracker_definitions` | Per-workspace tracker configs. `kind="keyword"` or `kind="smart"`.                 |
| `tracker_hits`        | Per-call tracker matches with `speaker_label`, `segment_start_ms`, `quote`.        |
| `snippets`            | Pointer-only shareable moments: `call_id` + `[start_ms, end_ms]`. No re-encode.    |
| `snippet_shares`      | Per-user / per-org share grants for snippets via framework `sharing`.              |
| `call_tags`           | Free-form tags per call.                                                           |
| `call_comments`       | Threaded comments tied to a timeline `video_timestamp_ms` with emoji reactions.    |
| `call_viewers`        | One row per viewer of a call: watch total, completion %, whether the view counted. |
| `call_events`         | Granular events: view-start, watch-progress, seek, pause, resume, reaction.        |
| `snippet_viewers`     | Per-viewer watch stats on snippets (separate counter from call viewers).           |
| `recall_bots`         | Recall.ai bot lifecycle — meeting URL, status, scheduled / started / ended.        |
| `zoom_connections`    | Per-user Zoom OAuth tokens (encrypted) + auto-import flag.                         |
| `accounts`            | CRM-lite — accounts a call belongs to (domain + logo).                             |
| `saved_views`         | Saved filter chip state for the library.                                           |

Visibility and sharing use the framework `sharing` system — calls and snippets are registered as shareable resources via `registerShareableResource({ type: "call", ... })` and `registerShareableResource({ type: "snippet", ... })` in `server/db/index.ts`. Use the auto-mounted `share-resource` / `set-resource-visibility` / `list-resource-shares` actions (see Sharing below). Password, `expiresAt`, and the `shareIncludesSummary` / `shareIncludesTranscript` flags are **extra** privacy controls on top of framework visibility — they're in the `calls` (and `snippets`) tables.

## Application State

Ephemeral UI state lives in `application_state`, accessed via `readAppState(key)` / `writeAppState(key, value)` from `@agent-native/core/application-state`. The UI syncs here so the agent always knows what's on screen.

| State Key                         | Purpose                                                                          | Direction               |
| --------------------------------- | -------------------------------------------------------------------------------- | ----------------------- |
| `navigation`                      | Current view + selected IDs (see shape below)                                    | UI -> Agent (read-only) |
| `navigate`                        | One-shot navigation command (auto-deleted after UI reads)                        | Agent -> UI             |
| `refresh-signal`                  | Bump timestamp — invalidates lists (calls, snippets, comments, tracker hits)     | Agent -> UI             |
| `current-workspace`               | Active workspace id (which roster / spaces / library the user sees)              | Bidirectional           |
| `player-state`                    | Current playhead ms, playing, speed, active speaker — set by the player          | UI -> Agent (read-only) |
| `transcript-selection`            | User's current text selection inside the transcript (startMs / endMs / quote)    | UI -> Agent (read-only) |
| `snippet-draft`                   | In-progress snippet marks (inMs / outMs / title) before `create-snippet` fires   | Bidirectional           |
| `active-filters`                  | Library filter chips (source, participant, account, tracker, date range)         | Bidirectional           |
| `ai-status`                       | Agent pipeline progress (`summary` / `topics` / `trackers` / `suggest-snippets`) | Agent -> UI             |
| `call-ai-queue-:callId`           | Queue of tasks the agent must run for a call post-transcription                  | Server -> Agent         |
| `call-suggested-snippets-:callId` | Agent's proposed moments for the user to promote to real snippets                | Agent -> UI             |
| `ai-delegation-:callId-:uuid`     | One delegation request (smart tracker, auto-title, etc.) the agent must handle   | Server -> Agent         |

### Navigation state shape

```json
{
  "view": "call",
  "callId": "cl_abc",
  "snippetId": "sn_xyz",
  "spaceId": "spc_123",
  "folderId": "fld_789",
  "shareId": "shr_888",
  "search": "pricing",
  "poiTab": "trackers"
}
```

Views: `library`, `call`, `snippet`, `search`, `trackers`, `upload`, `archive`, `trash`, `settings`, `notifications`, `share`, `embed`, `invite`.

**Do NOT write to `navigation`** — it is overwritten by the UI. To navigate, write to `navigate` via the `navigate` action.

## Common Tasks

| User request                                  | What to do                                                                                                                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "What am I looking at?"                       | `pnpm action view-screen`                                                                                                                                                                                                            |
| "Start recording"                             | `pnpm action navigate --view=upload` — then the user picks a mode (upload / browser record / invite bot) and starts. Recording is a UI gesture (MediaRecorder needs user consent). Rule 10.                                          |
| "Upload a file"                               | `pnpm action navigate --view=upload` — the UI runs the chunked upload against `/api/uploads/:callId/chunk`. See the `call-capture` skill.                                                                                            |
| "Invite a bot to my Zoom call"                | `pnpm action schedule-recall-bot --meetingUrl=<zoom/meet/teams url> [--scheduledAt=<iso>]`                                                                                                                                           |
| "Cancel the bot I sent to that meeting"       | `pnpm action cancel-recall-bot --botId=<id>`                                                                                                                                                                                         |
| "Connect my Zoom account"                     | `pnpm action connect-zoom` — returns the OAuth URL. After consent, cloud recordings auto-import.                                                                                                                                     |
| "Import that Zoom cloud recording"            | `pnpm action import-zoom-recording --recordingId=<zoom-id>`                                                                                                                                                                          |
| "Rename this call to 'Acme discovery'"        | `pnpm action update-call --id=<id> --title="Acme discovery"`                                                                                                                                                                         |
| "Summarize this call"                         | `pnpm action regenerate-summary --callId=<id>` — queues the agent. The agent reads the transcript and calls `write-call-summary`.                                                                                                    |
| "Find all calls where pricing came up"        | `pnpm action search-calls --query="pricing"` — full-text over title / description / transcript.                                                                                                                                      |
| "Which calls mention our competitor 'Acme'?"  | `pnpm action search-calls --query='"Acme"'` — quote the phrase for exact match.                                                                                                                                                      |
| "Who talked the most on this call?"           | `pnpm action get-call-player-data --callId=<id>` — `participants[]` carries `talkMs` and `talkPct`.                                                                                                                                  |
| "Create a snippet from 2:14 to 2:45"          | `pnpm action create-snippet --callId=<id> --startMs=134000 --endMs=165000 --title="..."`                                                                                                                                             |
| "Share this snippet with alice@example.com"   | `pnpm action share-resource --resourceType=snippet --resourceId=<id> --principalType=user --principalId=alice@example.com --role=viewer`                                                                                             |
| "Rename Speaker 0 to Alice"                   | `pnpm action update-call --id=<id>` is the wrong tool — participants live in `call_participants`. Use the relabel action (agent calls `run-smart-tracker-hit`-style writes via the participants table — see `talk-analytics` skill). |
| "Add a tracker for 'refund'"                  | `pnpm action create-tracker --name="Refund" --kind=keyword --keywords='["refund","money back"]'`                                                                                                                                     |
| "Add a smart tracker for competitor mentions" | `pnpm action create-tracker --name="Competitors" --kind=smart --classifierPrompt="Is the prospect mentioning a competing vendor?"`                                                                                                   |
| "Run trackers on this call"                   | `pnpm action run-trackers --callId=<id>` — keyword synchronous, smart queued to agent.                                                                                                                                               |
| "List tracker hits on this call"              | `pnpm action list-tracker-hits --callId=<id>`                                                                                                                                                                                        |
| "Retry the transcript, it failed"             | `pnpm action retry-transcript --callId=<id>`                                                                                                                                                                                         |
| "Make this call public"                       | `pnpm action set-resource-visibility --resourceType=call --resourceId=<id> --visibility=public`                                                                                                                                      |
| "Add a password to this share"                | `pnpm action update-call --id=<id> --password=<pw>`                                                                                                                                                                                  |
| "Expire this share in 7 days"                 | `pnpm action update-call --id=<id> --expiresAt=<iso>`                                                                                                                                                                                |
| "Hide the transcript on the public share"     | `pnpm action update-call --id=<id> --shareIncludesTranscript=false`                                                                                                                                                                  |
| "Move this call to my 'Demos' folder"         | Look up folder id via `list-workspace-state`, then `pnpm action move-call --id=<id> --folderId=<fid>`                                                                                                                                |
| "Archive this"                                | `pnpm action archive-call --id=<id>`                                                                                                                                                                                                 |
| "Delete this"                                 | `pnpm action trash-call --id=<id>`                                                                                                                                                                                                   |
| "Reply to the comment at 1:23"                | `pnpm action list-comments --callId=<id>` to find the thread, then `pnpm action reply-to-comment --parentId=<cid> --content="..."`                                                                                                   |
| "Tag this call as 'discovery'"                | `pnpm action tag-call --callId=<id> --tag=discovery`                                                                                                                                                                                 |
| "Tie this call to the Acme account"           | `pnpm action set-call-account --callId=<id> --accountId=<aid>`                                                                                                                                                                       |
| "Give me a share link"                        | Public call link is `/share/<callId>`, embed is `/embed/<callId>`, public snippet is `/share-snippet/<snippetId>`. Ensure `visibility=public` via `set-resource-visibility` if needed.                                               |
| "Export insights as CSV"                      | `pnpm action get-call-insights --callId=<id>` — agent can format CSV from the response. (No dedicated `export-csv` action yet; agent assembles.)                                                                                     |
| "Switch to the Product workspace"             | `pnpm action set-current-workspace --id=<workspaceId>`                                                                                                                                                                               |
| "Suggest some snippets to share"              | `pnpm action suggest-snippets --callId=<id>` — queues the agent. Proposals land in `call-suggested-snippets-<id>` app-state.                                                                                                         |

After any call / snippet / comment mutation the actions trigger a UI refresh automatically via `refresh-signal`.

## Actions

**Always use `pnpm action <name>` for all operations.** Scripts handle validation, access checks, and refresh signals. Never use `curl`, raw HTTP, or raw SQL (`db-exec`) for call operations.

**Running actions from the frame.** The terminal cwd is the framework root. Always `cd` first:

```bash
cd templates/calls && pnpm action <name> [args]
```

`.env` is loaded automatically — **never manually set `DATABASE_URL` or other env vars**.

> **Note on param names.** Most actions that reference a call use `callId`. CRUD-on-the-row lifecycle actions (`archive-call`, `trash-call`, `restore-call`, `update-call`, `finalize-call`, `delete-call-permanent`) use `id` because they're operating on the call row itself. Snippets mirror this (`snippetId` for reads, `id` for updates). Use what each table below says. When unsure, `ls actions/` and open the relevant file — its Zod schema is the source of truth.

### Call lifecycle

Start / stop / pause are **UI gestures** — there is no server action for the MediaRecorder. Uploads and bots are triggered from the UI; the agent can send the user to `/upload` via `navigate --view=upload` or dispatch a bot with `schedule-recall-bot`.

| Action                    | Args                                                                                                                                                | Purpose                                                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `create-call`             | `[--title] [--folderId] [--workspaceId] [--source upload\|browser\|recall-bot\|zoom-cloud] [--mediaKind video\|audio] [--recordedAt] [--accountId]` | Insert a call row in `uploading` status. Returns the chunk upload URL template.                                                                |
| `finalize-call`           | `--id <id> [--durationMs] [--width] [--height] [--mimeType]`                                                                                        | Assemble uploaded chunks, store the blob (via framework storage or application-state stash), mark `processing`, kick off `request-transcript`. |
| `request-transcript`      | `--callId <id>`                                                                                                                                     | Run Deepgram Nova-3 with diarization. Writes segments + fullText, materializes participants, kicks off the agent queue. See `transcription`.   |
| `save-browser-transcript` | `--callId <id> --fullText "..."`                                                                                                                    | Save a Web Speech API transcript (instant, no key). Deepgram refines it later; won't overwrite an existing diarized result.                    |
| `retry-transcript`        | `--callId <id>`                                                                                                                                     | Reset transcript status and re-run `request-transcript`.                                                                                       |

### Library + CRUD

| Action                   | Args                                                                                                                                                                                                                                | Purpose                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `list-calls`             | `[--view library\|archive\|trash\|all] [--folderId] [--spaceId] [--search] [--tag] [--accountId] [--trackerId] [--source] [--participantEmail] [--sort recent\|oldest\|longest\|most-viewed] [--limit] [--offset]`                  | List calls visible to the current user, with joined tag / viewer / participant / tracker summaries.              |
| `search-calls`           | `--query <term> [--limit] [--offset]`                                                                                                                                                                                               | Full-text search over title / description / transcript. Supports `+required`, `-excluded`, `"phrases"`.          |
| `get-call-player-data`   | `--callId <id>`                                                                                                                                                                                                                     | Everything the player page needs: metadata + transcript segments + participants + trackers + summary + comments. |
| `get-transcript`         | `--callId <id>`                                                                                                                                                                                                                     | Raw transcript: segments + fullText + language + provider + status.                                              |
| `update-call`            | `--id <id> [--title] [--description] [--folderId] [--spaceIds] [--password] [--expiresAt] [--shareIncludesSummary] [--shareIncludesTranscript] [--enableComments] [--enableDownloads] [--defaultSpeed] [--accountId] [--dealStage]` | Partially update the call row.                                                                                   |
| `move-call`              | `--id <id> --folderId <fid>`                                                                                                                                                                                                        | Move a call to a folder.                                                                                         |
| `archive-call`           | `--id <id>`                                                                                                                                                                                                                         | Archive — hidden from library, still viewable.                                                                   |
| `trash-call`             | `--id <id>`                                                                                                                                                                                                                         | Soft-delete — restorable from Trash.                                                                             |
| `restore-call`           | `--id <id>`                                                                                                                                                                                                                         | Restore from archive or trash.                                                                                   |
| `delete-call-permanent`  | `--id <id>`                                                                                                                                                                                                                         | Hard delete (requires `admin` role).                                                                             |
| `tag-call`               | `--callId <id> --tag <tag>`                                                                                                                                                                                                         | Add a free-form tag.                                                                                             |
| `untag-call`             | `--callId <id> --tag <tag>`                                                                                                                                                                                                         | Remove a tag.                                                                                                    |
| `set-thumbnail`          | `--callId <id> --atMs <ms>`                                                                                                                                                                                                         | Pick a frame as the call thumbnail.                                                                              |
| `add-call-to-space`      | `--callId <id> --spaceId <sid>`                                                                                                                                                                                                     | Make a call visible in a space.                                                                                  |
| `remove-call-from-space` | `--callId <id> --spaceId <sid>`                                                                                                                                                                                                     | Remove a call from a space.                                                                                      |

### Participants

The agent can relabel diarized speakers and flag internal vs external participants. Participants are populated by `request-transcript` from Deepgram's diarization output.

| Action                 | Args            | Purpose                                                              |
| ---------------------- | --------------- | -------------------------------------------------------------------- |
| `get-call-player-data` | `--callId <id>` | Returns `participants[]` with speakerLabel, displayName, talk stats. |

> Relabeling ("Speaker 0 → Alice") is performed by the agent via the framework `db-exec` action only as a last resort; prefer user-facing UI in the participants tab. When modeling a new participant mutation action, mirror `update-call`'s shape (`--callId --speakerLabel --displayName --email --isInternal`).

### Transcript + AI

AI summary, topics, and next steps are agent-delegated. Transcription itself is the one AI operation that goes direct (Rule 2).

| Action                     | Args                                                    | Purpose                                                                                                     |
| -------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `request-transcript`       | `--callId <id>`                                         | Deepgram Nova-3 with diarization. See `transcription` skill.                                                |
| `retry-transcript`         | `--callId <id>`                                         | Rerun transcription for a failed call.                                                                      |
| `regenerate-summary`       | `--callId <id>`                                         | Queue the agent to rewrite the recap / key points / next steps. Agent writes back via `write-call-summary`. |
| `regenerate-topics`        | `--callId <id>`                                         | Queue the agent to regenerate topic segmentation. Writes via `write-call-topics`.                           |
| `regenerate-next-steps`    | `--callId <id>`                                         | Queue the agent to regenerate the Next Steps list. Writes via `write-next-steps`.                           |
| `write-call-summary`       | `--callId <id> --summary '<json matching CallSummary>'` | **Agent-only.** Persists a full `CallSummary` into `call_summaries`.                                        |
| `write-call-topics`        | `--callId <id> --topics '<json>'`                       | **Agent-only.** Updates `topics_json` on `call_summaries`.                                                  |
| `write-next-steps`         | `--callId <id> --nextSteps '<json>'`                    | **Agent-only.** Updates `next_steps_json` on `call_summaries`.                                              |
| `suggest-snippets`         | `--callId <id>`                                         | Queue the agent to propose shareable moments; results land in `call-suggested-snippets-<id>`.               |
| `write-suggested-snippets` | `--callId <id> --snippets '<json>'`                     | **Agent-only.** Persists suggestion list in application state for the UI.                                   |

### Trackers

Per-workspace definitions (keyword or smart). Hits are per call. See the `trackers` skill.

| Action                  | Args                                                                                                                               | Purpose                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `list-trackers`         | `[--workspaceId]`                                                                                                                  | List tracker definitions visible in the current workspace.                                  |
| `create-tracker`        | `--name <n> --kind keyword\|smart [--keywords '<json>'] [--classifierPrompt <p>] [--color <#hex>] [--description] [--workspaceId]` | Create a tracker. Keyword trackers need `keywords`; smart trackers need `classifierPrompt`. |
| `update-tracker`        | `--id <id> [--name] [--keywords] [--classifierPrompt] [--color] [--enabled]`                                                       | Update an existing tracker.                                                                 |
| `delete-tracker`        | `--id <id>`                                                                                                                        | Remove a tracker and its hits.                                                              |
| `run-trackers`          | `--callId <id> [--kind keyword\|smart\|all]`                                                                                       | Run enabled trackers. Keyword sync, smart delegated to agent.                               |
| `run-smart-tracker-hit` | `--callId <id> --trackerId <tid> [--speakerLabel] --segmentStartMs <n> --segmentEndMs <n> --quote <q> --confidence <0-100>`        | **Agent-only.** Record one smart-tracker hit. Quote must be a verbatim substring.           |
| `list-tracker-hits`     | `--callId <id> [--trackerId]`                                                                                                      | List tracker hits on a call.                                                                |

### Snippets

Pointer-only shareable moments. See the `snippets` skill.

| Action                     | Args                                                                                   | Purpose                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `create-snippet`           | `--callId <id> --startMs <n> --endMs <n> [--title] [--description]`                    | Create a snippet pointing at `[startMs, endMs]` inside the call.                   |
| `update-snippet`           | `--id <id> [--title] [--description] [--startMs] [--endMs] [--password] [--expiresAt]` | Update snippet fields.                                                             |
| `delete-snippet`           | `--id <id>`                                                                            | Soft-delete a snippet.                                                             |
| `restore-snippet`          | `--id <id>`                                                                            | Restore a trashed snippet.                                                         |
| `delete-snippet-permanent` | `--id <id>`                                                                            | Hard delete (requires `admin`).                                                    |
| `list-snippets`            | `[--callId] [--workspaceId] [--limit] [--offset]`                                      | List snippets the user can access.                                                 |
| `get-snippet-player-data`  | `--snippetId <id>`                                                                     | Everything the snippet player needs: bounds + transcript subset + parent metadata. |

### Sharing (framework-wide, auto-mounted)

| Action                    | Args                                                                                                                                   | Purpose                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `share-resource`          | `--resourceType call\|snippet --resourceId <id> --principalType user\|org --principalId <email-or-orgId> --role viewer\|editor\|admin` | Grant a user or org access.           |
| `unshare-resource`        | `--resourceType call\|snippet --resourceId <id> --principalType user\|org --principalId <value>`                                       | Revoke a share grant.                 |
| `list-resource-shares`    | `--resourceType call\|snippet --resourceId <id>`                                                                                       | Show current visibility + all grants. |
| `set-resource-visibility` | `--resourceType call\|snippet --resourceId <id> --visibility private\|org\|public`                                                     | Change coarse visibility.             |

Password + `expiresAt` + `shareIncludesSummary` + `shareIncludesTranscript` are **additions** stored directly on the call / snippet row — they compose with the framework share grants. See the `call-sharing` skill.

Public call link: `/share/<callId>`. Embed: `/embed/<callId>`. Public snippet: `/share-snippet/<snippetId>`. Snippet embed: `/embed-snippet/<snippetId>`. All require `visibility=public` (or an explicit share grant).

### Comments

| Action             | Args                                                                                 | Purpose                                |
| ------------------ | ------------------------------------------------------------------------------------ | -------------------------------------- |
| `list-comments`    | `--callId <id>`                                                                      | List threaded comments with timestamps |
| `add-comment`      | `--callId <id> --content <text> [--threadId] [--parentId] [--videoTimestampMs <ms>]` | Post a comment anchored to a timestamp |
| `reply-to-comment` | `--parentId <cid> --content <text>`                                                  | Reply within an existing thread        |
| `resolve-comment`  | `--id <commentId>`                                                                   | Mark a thread resolved                 |
| `delete-comment`   | `--id <commentId>`                                                                   | Delete a comment                       |

### Analytics

| Action                   | Args                      | Purpose                                                  |
| ------------------------ | ------------------------- | -------------------------------------------------------- |
| `list-viewers`           | `--callId <id> [--limit]` | Viewers + watch totals + whether the view counted        |
| `get-call-insights`      | `--callId <id>`           | Aggregate: views, completion %, drop-off, tracker counts |
| `get-workspace-insights` |                           | Aggregate analytics for the current workspace            |

Granular per-event recording (view-start / watch-progress / seek / pause / resume / reaction) is a custom HTTP route at `POST /api/view-events`, not an action — the player hits it directly.

### Workspace + invites

| Action                  | Args                                    | Purpose                                                     |
| ----------------------- | --------------------------------------- | ----------------------------------------------------------- |
| `list-workspace-state`  |                                         | Roster + spaces + folders summary for the current workspace |
| `set-current-workspace` | `--id <workspaceId>`                    | Set which workspace is active                               |
| `create-workspace`      | `--name <name> [--brandColor] [--slug]` | Create a new workspace                                      |

(Framework-provided `invite-member`, `accept-invite`, etc. are auto-mounted from `@agent-native/core` and also available.)

### Folders + spaces

Folder / space CRUD is available through the shared core workspace scripts (see `list-workspace-state` for the current shape) and follows the same pattern as the `clips` template.

### Accounts (CRM-lite)

| Action             | Args                                        | Purpose                         |
| ------------------ | ------------------------------------------- | ------------------------------- |
| `create-account`   | `--name <n> [--domain] [--logoUrl]`         | Create a new account.           |
| `update-account`   | `--id <id> [--name] [--domain] [--logoUrl]` | Update account metadata.        |
| `delete-account`   | `--id <id>`                                 | Delete an account.              |
| `list-accounts`    | `[--workspaceId]`                           | List accounts in the workspace. |
| `set-call-account` | `--callId <id> --accountId <aid>`           | Tag a call with an account.     |

### Recall.ai bots

| Action                | Args                                                                     | Purpose                                                |
| --------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------ |
| `schedule-recall-bot` | `--meetingUrl <url> [--scheduledAt <iso>] [--botName] [--workspaceId]`   | Dispatch a Recall.ai bot to a Zoom / Meet / Teams URL. |
| `cancel-recall-bot`   | `--botId <id>`                                                           | Cancel a scheduled / joining bot.                      |
| `list-recall-bots`    | `[--status scheduled\|joining\|recording\|done\|failed] [--workspaceId]` | List bots + their statuses.                            |

### Zoom cloud

| Action                  | Args                      | Purpose                                                                  |
| ----------------------- | ------------------------- | ------------------------------------------------------------------------ |
| `connect-zoom`          |                           | Returns the Zoom OAuth URL. After consent, cloud recordings auto-import. |
| `disconnect-zoom`       |                           | Revoke tokens + clear `zoom_connections` row.                            |
| `import-zoom-recording` | `--recordingId <zoom-id>` | Import a Zoom cloud recording by id.                                     |

### Navigation + context

| Action               | Args                                                                                     | Purpose                                     |
| -------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------- |
| `view-screen`        |                                                                                          | Snapshot of what the user is looking at now |
| `navigate`           | `--view <name> [--callId] [--snippetId] [--spaceId] [--folderId] [--shareId] [--search]` | Navigate the UI                             |
| `refresh-list`       |                                                                                          | Bump the `refresh-signal` timestamp         |
| `list-notifications` |                                                                                          | List the current user's notifications       |

## API Routes

Custom routes only exist for things actions can't do well — file uploads (binary body), media streaming, high-frequency event writes, and third-party webhooks. Everything else is an action.

| Method | Route                           | Purpose                                                                  |
| ------ | ------------------------------- | ------------------------------------------------------------------------ |
| POST   | `/api/uploads/:callId/chunk`    | Receive a chunk of a browser-recorded or file upload.                    |
| POST   | `/api/uploads/:callId/complete` | Finalize chunked upload — delegates to `finalize-call`.                  |
| POST   | `/api/uploads/:callId/abort`    | Abort an in-progress upload and clean up stashed chunks.                 |
| POST   | `/api/uploads/direct`           | Receive a whole-file upload (small files / non-chunked client).          |
| GET    | `/api/call-media/:callId`       | Stream the media bytes (respects `visibility` / shares / password).      |
| GET    | `/api/call-thumbnail/:callId`   | Return the call thumbnail (or placeholder).                              |
| GET    | `/api/snippet-media/:snippetId` | Stream the snippet's window of the parent call's media.                  |
| POST   | `/api/view-events`              | Record a watch-progress / seek / pause / resume / reaction event.        |
| GET    | `/api/public-call`              | Public share resolver — applies visibility + password + expiry gating.   |
| GET    | `/api/public-snippet`           | Public snippet resolver — applies visibility + password + expiry gating. |
| POST   | `/api/webhooks/deepgram`        | Deepgram async callback (for webhook-based transcription).               |
| POST   | `/api/webhooks/recall`          | Recall.ai bot status callback (recording ready, failure, status change). |
| POST   | `/api/webhooks/zoom`            | Zoom cloud recording-ready callback (see the `call-capture` skill).      |
| GET    | `/api/oauth/zoom/callback`      | Zoom OAuth callback — completes `connect-zoom`.                          |

All standard CRUD (list, get, create, update) goes through `/_agent-native/actions/:name` — use `useActionQuery` / `useActionMutation` from the client.

## Keyboard Shortcuts

| Key                   | Action                                                |
| --------------------- | ----------------------------------------------------- |
| `Space`               | Play / pause                                          |
| `J`                   | Skip back 10s                                         |
| `K`                   | Play / pause                                          |
| `L`                   | Skip forward 10s                                      |
| `←` / `→`             | Skip back / forward 5s                                |
| `↑` / `↓`             | Volume up / down                                      |
| `F`                   | Fullscreen                                            |
| `M`                   | Mute / unmute                                         |
| `-` / `+`             | Slower / faster playback                              |
| `C`                   | Toggle captions                                       |
| `I`                   | Mark In-point for a snippet                           |
| `O`                   | Mark Out-point for a snippet                          |
| `Enter`               | Create snippet from current I/O marks                 |
| `T`                   | Toggle transcript panel                               |
| `S`                   | Toggle summary panel                                  |
| `1` / `2` / `3` / `4` | POI tabs: Summary / Trackers / Questions / Next Steps |
| `/`                   | Focus search                                          |
| `⌘K`                  | Command menu                                          |
| `Esc`                 | Close player / clear selection / exit snippet mode    |
| `G then L`            | Go to Library                                         |
| `G then S`            | Go to Search                                          |
| `G then T`            | Go to Trackers                                        |
| `G then A`            | Go to Archive                                         |
| `G then U`            | Go to Upload                                          |

## UI Components

- **shadcn/ui only** for all standard patterns (dialogs, popovers, dropdowns, tooltips, buttons). Never build custom modals or positioned overlays by hand.
- **Tabler Icons only** (`@tabler/icons-react`). No other icon libraries. Do **not** use robot or sparkle icons to represent the agent / AI.
- **Never** use `window.confirm`, `window.alert`, or `window.prompt`. Use shadcn `AlertDialog`.
- **Inter font** for all UI.
- **Monochrome palette** — `#111111` is the Calls primary brand color. It maps to `--brand` in the Tailwind config and is the default `workspaces.brand_color`.
- **1.0x** is the default playback speed for calls (stored in `calls.default_speed`). Calls are conversations, not demos — normal speed by default.
- **Keep shadcn default transitions** (animate-in/out, fade, zoom, slide). Avoid custom decorative transitions — keep the UI snappy.

## Rules

1. **All AI goes through the agent chat.** Call `sendToAgentChat({ background: true, context, message })` from UI or actions, or queue a delegation via `application_state` (`ai-delegation-:callId-:uuid`) for the agent pipeline. Do **not** `import OpenAI` / `@anthropic-ai/sdk`. The **one exception** is transcription — see Rule 2.
2. **Transcription is direct to Deepgram.** The `request-transcript` action calls Deepgram Nova-3 with `diarize=true` using `DEEPGRAM_API_KEY`. The browser's Web Speech API also runs during recording via `save-browser-transcript`, giving an instant transcript with no API key — Deepgram refines it afterward. No other AI features may bypass the agent. See the `transcription` skill.
3. **Snippets are pointer-only.** A snippet is a row with `call_id` + `[start_ms, end_ms]` — there is no re-encode, no second media file. The snippet player reads the parent call's bytes and enforces bounds client-side. See the `snippets` skill.
4. **View-counting rule.** A view counts when the viewer hits **≥ 5 seconds** OR **≥ 75% completion** OR scrubs to the end. Applies to both `call_viewers` and `snippet_viewers`. Always go through the canonical `shouldCountView` helper.
5. **Use the framework sharing system.** Never write custom share tables. `registerShareableResource({ type: "call", ... })` and `{ type: "snippet", ... }` are wired in `server/db/index.ts`. Compose with the auto-mounted actions. Add password, `expiresAt`, `shareIncludesSummary`, and `shareIncludesTranscript` as **additional** checks in the share-resolution path, not replacements. See the `call-sharing` skill.
6. **SQL must be dialect-agnostic.** The target is Neon Postgres. Use Drizzle operators only. No SQLite-specific functions (`datetime('now')`, `|| ''`), no `json_extract`, no `ROWID`. Use `now()` from `@agent-native/core/db/schema`. See the framework `portability` skill.
7. **Screen context is auto-included.** Check `<current-screen>` in the user's message before running `view-screen` — you usually don't need to call it.
8. **Trigger refresh after mutations.** `writeAppState("refresh-signal", { ts: Date.now() })` — `useDbSync` invalidates the affected query keys. Most actions do this automatically.
9. **Scoping.** All list/get actions filter via `accessFilter(schema.calls, schema.callShares)` (or the snippet equivalent). Write actions guard via `assertAccess("call", id, "editor")` (or `"viewer"` for reads that need explicit gating, `"admin"` for delete).
10. **No pre-capture state without consent.** MediaRecorder starts only on a direct user click. Meeting bots join only after the user explicitly invites them. The agent can `navigate --view=upload` or call `schedule-recall-bot` with an explicit meeting URL the user provided — it cannot start recording without that user action.

## Authentication

This template uses the framework's default auth — Better Auth, with email/password and optional Google / GitHub social providers. Use `getSession(event)` server-side and `useSession()` client-side; per-user scoping inside actions / handlers reads `getRequestUserEmail()` from `@agent-native/core/server/request-context`.

See the framework `authentication` skill for the full mode matrix (`AUTH_MODE=local`, `ACCESS_TOKEN`, `AUTH_DISABLED`, BYOA) and the `security` skill for the access-control model (`ownableColumns`, `accessFilter`, `assertAccess`).

## Skills

Read the skill files in `.agents/skills/` for detailed patterns:

| Skill            | When to read                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `call-capture`   | Before touching upload flow, browser recorder, Recall.ai bots, or Zoom cloud import.                          |
| `transcription`  | Before modifying the Deepgram pipeline, webhook handler, segment parsing, or participant materialization.     |
| `call-summary`   | Before adding or changing the AI summary prompt, the parse / validate step, or the `write-call-summary` flow. |
| `trackers`       | Before adding a new tracker kind, changing the keyword regex, or touching smart-tracker delegation.           |
| `snippets`       | Before wiring the snippet creation UI, the snippet player, or snippet sharing.                                |
| `call-sharing`   | Before wiring the Share dialog, password / expiry controls, embeds, or the public-call resolver.              |
| `talk-analytics` | Before modifying participant materialization, talk-time math, interruption / question detection.              |
| `call-search`    | Before changing the FTS tokenizer, LIKE-based search SQL, or the highlight-snippet logic.                     |

Framework-level skills (`actions`, `storing-data`, `real-time-sync`, `delegate-to-agent`, `sharing`, `portability`, `server-plugins`, `authentication`, `security`, `frontend-design`) are symlinked in via `agent-native setup-agents`.

## Development

For code editing and development guidance, read `DEVELOPING.md`.
