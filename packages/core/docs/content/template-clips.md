---
title: "Clips"
description: "Async screen recording, calendar-synced meeting notes, and push-to-talk voice dictation — all transcribed, summarized, and searchable in one app you own."
---

# Clips

A capture-everything app: screen recordings, meeting notes from your calendar, and Fn-hold voice dictation. The agent transcribes, titles, summarizes, and indexes all of it — then lets you ask "find the clip where we discussed the rollout plan" and searches across every transcript you've ever made.

<!-- screenshot:
  app: clips
  view: /library
  shows: Library with Acme Co. organization, folders (Onboarding videos / Customer calls / Bug repros) and spaces (Engineering / Design / Sales) in the sidebar, six recordings in a 3-column grid (Q3 OKRs review meeting, Walkthrough of new onboarding flow, Eng standup May 4, Dictation - Ideas for landing page copy, Customer call - Acme Corp pricing review, Bug repro - drag-and-drop in Safari)
  account: screenshot-account (recordings imported into this org via the standard upload + meetings flow)
  capture: 1400x800 viewport, cropped 90px from bottom (final 1400x710)
-->

![Clips library with recordings, folders, and spaces](/screenshots/clips.png)

Think along the lines of Loom + Granola + Wispr Flow rolled into one app — but the agent is a first-class editor across every surface, and the recordings, meetings, and dictations are yours, not a SaaS vendor's.

## What you can do with it

- **Record your screen** with a built-in recorder, webcam overlay, audio capture, and pause/trim.
- **Capture meetings from your calendar.** Connect Google Calendar, see upcoming meetings in the sidebar, and hit record on any one. You get a live transcript plus AI summary, bullet notes, and action items the moment it ends.
- **Push-to-talk dictation.** Hold Fn on your machine, speak, and the cleaned-up text drops into whatever app you're using. Every dictation is kept in a searchable history with originals and AI-cleaned versions side by side.
- **Get an auto-generated title, summary, and chapter markers** for every recording — the agent fills them in and keeps them current.
- **Search across every transcript** — screen recordings, meetings, and dictations all in one library. "Find the clip where we discussed the rollout plan."
- **Share clips** with per-clip permissions (public, team, private). Link tracking and threaded comments work too.
- **Smart library views.** Group by project, filter by speaker, auto-tag based on content.
- **Edit the transcript through chat.** "Fix the mis-transcribed word at 1:42." "Pull three quotes for a blog post." The agent edits the transcript and the UI updates live.

## Getting started

Live demo: [clips.agent-native.com](https://clips.agent-native.com).

1. **Open Library.** Browse screen recordings, meeting recordings, dictations,
   folders, and spaces from one place.
2. **Record or import.** Capture a screen recording, start from a calendar
   meeting, or use push-to-talk dictation.
3. **Let the agent clean it up.** Generate a title, summary, chapters, action
   items, or cleaned-up transcript text.
4. **Search and reuse.** Ask for the clip, quote, action item, or decision you
   need, then share the result with the right visibility.

## Useful Prompts

- "Summarize this clip for a product update."
- "Find the meeting where we discussed the rollout plan."
- "Pull three customer quotes from this transcript."
- "Create action items from the last sales call."
- "Clean up this dictation and turn it into a Linear ticket."

## Why it's interesting

Three things make Clips a good showcase of what agent-native enables:

1. **The agent edits the transcript.** Fix a mis-transcribed word, generate chapter timestamps, pull quotes for a blog post — all in natural language, in the chat, with the UI updating live via polling.
2. **Context awareness on recordings.** When you're viewing a clip, the agent knows the clip id, the current playhead, and the selected transcript range. Ask "summarize from here to the end" and it understands what "here" means.
3. **Clips you own, not a vendor.** The recordings live in your storage, the transcripts live in your SQL, and the agent is yours. Fork the template, change how chapters get built, wire it to your own CDN — it's your code.

## For developers

The rest of this doc is for anyone forking the Clips template or extending it.

### Scaffolding

```bash
npx @agent-native/core create my-clips --standalone --template clips
cd my-clips
pnpm install
pnpm dev
```

Clips is a larger template with a native recorder (it ships a desktop companion for local capture). Three setup steps are needed before recordings can upload:

1. **Video storage (required).** Connect a storage backend through the onboarding wizard. The easiest path is Builder.io (free during beta, one-click). For self-hosted storage, set `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and optionally `S3_REGION` and `S3_PUBLIC_BASE_URL`. Cloudflare R2 and DigitalOcean Spaces use the same env vars with the `R2_*` prefix.
2. **Google Calendar (optional).** To sync upcoming meetings, connect a Google Calendar account from Settings. The OAuth callback URL in dev is `http://localhost:8094/_agent-native/google/callback`. Set up a Google OAuth client in [Google Cloud Console](https://console.cloud.google.com/) with the Gmail and Google Calendar APIs enabled.
3. **Screen-capture permissions.** On macOS, grant Screen Recording permission to the browser (or the desktop companion app) in System Settings → Privacy & Security → Screen Recording.

### Data model

All data lives in SQL via Drizzle ORM. Schema: `templates/clips/server/db/schema.ts`. Recordings, meetings, dictations, calendar accounts, and vocabulary all carry the standard `ownableColumns` and have a matching framework shares table, so they slot into the per-user / per-org sharing model.

| Table                                           | What it holds                                                                                                                                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recordings`                                    | The core resource — title, video URL/format/size, duration, thumbnails, status, non-destructive `edits_json`, `chapters_json`, privacy (password, expiry), and player toggles |
| `recording_transcripts`                         | Per-recording transcript: `segments_json` (`{startMs,endMs,text}`), `full_text`, language, and status                                                                         |
| `recording_tags`                                | Free-form tags on a recording                                                                                                                                                 |
| `recording_ctas`                                | Call-to-action buttons (label, url, color, placement) overlaid on a recording                                                                                                 |
| `recording_comments`                            | Threaded, timestamped comments with emoji-reaction map and resolved flag                                                                                                      |
| `recording_reactions`                           | Emoji reactions pinned to a video timestamp (anonymous viewers allowed)                                                                                                       |
| `recording_viewers` / `recording_events`        | View analytics: per-viewer watch time and completion, plus granular events (view-start, watch-progress, seek, pause, cta-click, reaction)                                     |
| `clips_meetings`                                | Calendar-sourced or ad-hoc meetings — schedule/actual spans, platform, user notes, AI `summary_md`, `bullets_json`, `action_items_json`, and the link to its `recording_id`   |
| `meeting_participants` / `meeting_action_items` | Attendees and extracted action items for a meeting                                                                                                                            |
| `calendar_accounts` / `calendar_events`         | Connected calendar accounts (OAuth tokens live in `app_secrets`, only referenced here) and synced event snapshots                                                             |
| `clips_dictations`                              | Push-to-talk dictation history — raw `full_text`, optional `cleaned_text`, source (`fn-hold`, etc.), and target app                                                           |
| `clips_vocabulary`                              | Personal vocabulary corrections (term → preferred replacement) that bias future dictations                                                                                    |
| `spaces` / `space_members` / `folders`          | Library organization — spaces (topic-scoped containers), their members, and nestable folders                                                                                  |
| `organization_settings`                         | Per-org Clips sidecar: brand color, logo, default visibility                                                                                                                  |

Recordings and transcripts are intentionally separate tables so the library and transcript views can each render fast. Meetings compose with recordings rather than duplicating media: a meeting owns the recording it captures, but the `recordings` row remains the source of truth for the video and per-segment transcript.

Routes in the UI live under `templates/clips/app/routes/` — the authenticated app sits under `_app.*` (library, spaces, folders, meetings, dictate, insights, trash, settings), with public surfaces at `r.$recordingId`, `share.$shareId`, `embed.$shareId`, and `invite.$token`.

### Key actions

Every agent-callable operation is a TypeScript file in `templates/clips/actions/`, auto-mounted at `POST /_agent-native/actions/:name` and runnable from the CLI as `pnpm action <name>`. There are ~80 actions; the useful groupings:

- **Recording lifecycle** — `create-recording`, `finalize-recording`, `update-recording`, `set-thumbnail`, `archive-recording` / `restore-recording` / `trash-recording` / `delete-recording-permanent`, `move-recording`, `tag-recording`.
- **Transcript & AI** — `request-transcript`, `cleanup-transcript`, `regenerate-title` / `regenerate-summary` / `regenerate-chapters`, `set-chapters`, `generate-workflow`. (`cleanup-transcript` and `finalize-meeting` are server-side media-pipeline calls; most other AI features delegate to the agent chat.)
- **Editing** — non-destructive `trim-recording`, `split-recording`, `remove-filler-words`, `remove-silences`, plus `stitch-recordings`, `undo-edit`, `clear-edits`. Edits accumulate in `edits_json`; the client concatenates/exports via ffmpeg.wasm.
- **Meetings** — `create-meeting`, `start-meeting-recording` / `stop-meeting-recording`, `finalize-meeting`, `update-meeting`, `get-meeting`, `list-meetings`, plus calendar wiring `connect-calendar` / `disconnect-calendar` / `sync-calendars` / `list-calendar-accounts`.
- **Dictation** — `create-dictation`, `cleanup-dictation`, `update-dictation`, `list-dictations`, and `add-vocabulary-term` / `list-vocabulary` for personal vocabulary biasing.
- **Library organization** — `create-space` / `rename-space` / `delete-space`, `add-space-member` / `remove-space-member`, `create-folder` / `rename-folder` / `delete-folder`, `add-recording-to-space`.
- **Sharing, comments & engagement** — framework sharing actions plus `create-cta` / `update-cta` / `delete-cta`, `add-comment` / `reply-to-comment` / `resolve-comment` / `react-to-comment` / `delete-comment`, `react-to-recording`, `list-viewers`.
- **Organizations & members** — `create-organization`, `set-organization-branding`, `invite-member` / `accept-invite` / `decline-invite` / `get-invite`, `remove-member`, `update-member-role`, `list-organization-state`, `list-notifications`.
- **Search, insights & export** — `search-recordings` (matches titles, descriptions, transcript text, and comments, with timestamps), `get-recording-insights`, `get-organization-insights`, `export-insights-csv`, `export-to-brain`.
- **Context & navigation** — `view-screen` (current clip, playhead, selected transcript range) and `navigate`; `refresh-list` after mutations.

### Customizing it

Clips is a complete, cloneable template — fork it and ask the agent to extend it. Some examples:

- "Add a filler-word removal button that strips ums and uhs from the transcript and re-stitches the video."
- "Auto-post my standup notes to Slack #eng whenever a meeting ends." (Connect Slack first via [Messaging](/docs/messaging).)
- "Add a hotkey that drops the last dictation into Linear as a new ticket."
- "Group the library by project — detect the project from the first words of each transcript."
- "Add a 'Generate blog post from this clip' button that drafts a post from the transcript and saves it as a draft."
- "Let viewers leave timestamped reactions on a shared clip."

The agent edits routes, components, the transcript pipeline, and the schema as needed. See [Templates](/docs/cloneable-saas) for the full clone, customize, deploy flow, and [Getting Started](/docs/getting-started) if this is your first agent-native template.

## What's next

- [**Templates**](/docs/cloneable-saas) — the clone-and-own model
- [**Context Awareness**](/docs/context-awareness) — how the agent knows the current clip and playhead
- [**Agent Teams**](/docs/agent-teams) — delegate transcript cleanup to a specialist sub-agent
