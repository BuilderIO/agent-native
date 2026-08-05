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
- `video-projects` — the full multi-track editor (compositions, imports,
  project persistence, editor asset uploads).
- `annotations` — the unified timestamp/section/comment annotation layer.
- `edit-versions`, `edit-synthesis` — proposed edit sets, owner review, and
  marker→plan edit workflows.
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

- Annotations are the unified time-anchored layer for editorial intent:
  whole-video notes, point timestamps (`startMs`), and sections
  (`startMs`+`endMs`) with semantic kinds and group tags. Use
  `add-annotation` / `list-annotations` / `update-annotation` /
  `delete-annotation`; anchor a discussion with `add-comment
  --annotationId=<id>`. Marker hotkeys ⌥⇧M/E/B/N persist through
  `save-recording-markers`. Read the `annotations` skill before deeper work.
- Edited cuts return to the owner as edit versions: `propose-edit-version`,
  `review-edit-version`, `list-edit-versions` / `get-edit-version`. Never
  mutate `recordings.edits_json` directly for non-trivial AI edits. Read the
  `edit-versions` skill (and `edit-synthesis` for marker→plan workflows).
- Video projects are the full multi-track editor at `/video-projects/:id`
  (vendored Remotion Editor Starter — licensed third-party source; keep it in
  this repo only). Use `add-recording-to-video-project` and the
  video-project CRUD actions; export lands via `save-video-project-export`.
  Read the `video-projects` skill before deeper work.
- Cloud transcription fallback uses the configured Builder/Gemini or Groq
  paths, not OpenAI. Groq stays the BYOK backup speech-to-text option.

## Application State

- `navigation` — library, shared-with-me, recording, share, meeting, dictation,
  settings, and transcript context. `navigate` opens those surfaces;
  `navigate --view=shared` opens shared-with-me.
- `selection` — selected library recording ids while in selection mode.
- `view: "video-project"` includes the open `projectId`; `view-screen` returns
  a composition summary for it.
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
| `add-annotation`, `list-annotations`, `update-`, `delete-annotation` | Time-anchored notes, markers, sections |
| `propose-edit-version`, `review-edit-version`, `list-`, `get-edit-version` | Proposed cuts and owner review |
| `add-recording-to-video-project`, `*-video-project`, `save-video-project-export`, `list-editor-media-assets` | Multi-track video projects |
| `tool-search` | Any other Clips action, e.g. screen-memory reads |
