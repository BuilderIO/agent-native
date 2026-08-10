# Clips — Agent Guide

Clips is an agent-native screen recording, transcript, meetings, dictation, and
video sharing app. The agent and the UI share the same SQL data and actions.

## Skills

Before building common workspace or agent UI, read `agent-native-toolkit` to
inventory existing public kits and installed package seams. Use
`customizing-agent-native` for the configure → compose → eject → propose seam
ladder.

Read the matching skill before deeper work in that area:

- `recording` — capture, upload, playback, Loom import, mobile, folders and bulk
  moves, Chrome extension.
- `ai-video-tools` — transcription, cleanup, titles, summaries, chapters,
  `voiceContext`, AI setup and Builder credits.
- `video-editing` — `editsJson`, trim/split/cut/speed/blur, export.
- `video-sharing` — visibility, passwords, expiry, embeds, Slack unfurls,
  agent-readable clips, discovery limits, view counting.
- `meetings`, `dictate` — calendar meetings, live notes, dictation.
- `brain-export` — `export-to-brain` exports, cursors, sweeps.
- `crm-call-evidence` — `prepare-crm-call-evidence` and CRM recipes.
- `screen-memory` — local-only desktop screen/app context.
- `bug-reports` — embedded `/bug-report` launcher and intake limits.
- `external-integrations` — Slack install, Atlassian/Jira, provider-API limits.
- `actions`, `security`, `storing-data`, `frontend-design`, `shadcn-ui` as
  needed.

## Core Rules

- Keep large payloads out of SQL: no video/audio, images, PDFs, thumbnails,
  base64, or `data:` URLs in app tables, `application_state`, `settings`, or
  `resources` — persist URLs, ids, or handles and keep bytes in configured
  file/blob storage. Hosted uploads require storage; never fall back to video
  bytes in SQL (local dev scratch chunks excepted).
- Never hardcode API keys, tokens, webhook URLs, signing secrets, private
  Builder/internal data, customer data, or credential-looking literals. Use
  secrets/OAuth/runtime config and obvious placeholders.
- Use actions for recording metadata, transcripts, cleanup, summaries, chapters,
  comments, spaces/folders, meetings, and sharing. Never bypass access helpers.
- Recording start/stop/pause are UI gestures — browser capture needs user
  activation. Navigate the user to the recording view instead of a server action.
- Native transcript first; cloud transcription is fallback-only. Never hide a
  usable native transcript behind failed metadata work.
- Use `import-loom-recording` for Loom or direct MP4/WebM URLs. Loom media and
  public transcripts import in the background; direct videos need
  `request-transcript` afterward.
- Internal transactional-email actions claim bounded two-Clip summary work and
  complete it with one plain-text sentence after reviewing both context packets.
- The `view-screen` transcript is a bounded preview: when `previewTruncated` is
  true it may end mid-sentence and says nothing about where transcription
  ended. Call `get-recording-player-data` before judging completeness or
  quoting.
- Public clips are unlisted-by-link, not a searchable catalog. Only inspect
  recordings the user owns, has viewed, or gave a share URL/id for. Never use
  `list-recordings` or `search-recordings` to find someone else's clip, answer a
  date question about the clip in context, or recover from a failed lookup —
  report the failure instead.
- Use framework sharing actions. Password and expiry only tighten visibility
  and share grants.
- Screen Memory is local-only, disabled by default, and never a hosted or
  shareable Clips recording.
- Use `view-screen` when the active recording, transcript segment, meeting, or
  share context is unclear.
- Never fabricate. Read real values through actions, verify writes with a
  read-back, and rely on the app refresh/polling path after mutations.

## Application State

- `navigation` — library, shared-with-me, recording, share, meeting, dictation,
  settings, and transcript context. `navigate` opens those surfaces;
  `navigate --view=shared` opens shared-with-me.
- `selection` — selected library recording ids while in selection mode.
- `recording-setup.import` — Loom import UI state while `/record` is open, never
  the pasted URL.
- `record-intent` — an agent-requested capture the recorder UI picks up, then
  clears.
- Read transcripts and media metadata through data actions, not screen context.

## Actions

| Action | Purpose |
| --- | --- |
| `view-screen`, `navigate` | Read context; open a surface |
| `list-recordings`, `search-recordings` | Library, trash, `--view=shared` |
| `get-recording-player-data` | Full transcript, chapters, diagnostics |
| `create-recording`, `finalize-recording` | Create row; finish upload |
| `import-loom-recording` | Import Loom or direct MP4/WebM URL |
| `update-recording` | Title, password, expiry, visibility |
| `move-recording` | Move `id` or `ids` to a folder or root |
| `archive-`, `trash-`, `restore-recording` | Lifecycle |
| `reprocess-recording` | Repair unseekable/frozen media |
| `generate-filmstrip` | Editor timeline frame sprite; `all` backfills |
| `request-transcript`, `cleanup-transcript` | Transcribe; `force`/`regenerate` |
| `regenerate-title`, `-summary`, `-chapters` | AI metadata |
| `trim-`, `split-recording`, `remove-silences`, `remove-filler-words` | Edits |
| `list-meetings`, `get-`, `update-`, `finalize-meeting` | Meetings |
| `list-dictations`, `cleanup-dictation` | Dictation history |
| `add-comment`, `update-comment`, `create-folder`, `create-space` | Comments, folders |
| `share-resource`, `set-resource-visibility`, `build-embed-url` | Share, embed |
| `create-recording-agent-link` | Two-hour `agent_access` share URL |
| `prepare-crm-call-evidence` | Opaque clip id plus `/r/<id>` for CRM |
| `export-to-brain` | Send ready transcripts to Brain |
| `get-builder-credit-status` | Whether credits pause AI work |
| `tool-search` | Any other Clips action, e.g. screen-memory reads |
