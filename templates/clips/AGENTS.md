# Clips — Agent Guide

Clips manages screen and meeting recordings, transcripts, editing, and sharing through shared actions.

## Skills

App skills: `recording` (capture, upload, playback, Loom, mobile, folders), `ai-video-tools`, `video-editing`, `video-sharing`, `meetings`, `dictate`, `brain-export`, `crm-call-evidence`, `screen-memory`, `bug-reports`, `external-integrations`. Shared skills: `a2a-protocol`, `actions`, `adding-a-feature`, `agent-native-docs`, `agent-native-toolkit`, `authentication`, `client-side-routing`, `context-awareness`, `customizing-agent-native`, `delegate-to-agent`, `external-agents`, `frontend-design`, `performance`, `portability`, `real-time-sync`, `reliable-mutations`, `secrets`, `security`, `self-modifying-code`, `server-plugins`, `shadcn-ui`, `sharing`, `storing-data`, `turn-into-skill`, `workspace-conventions`. Read the exact `.agents/skills/<name>/SKILL.md` guide before deeper work.

Use local docs only, no web research: `pnpm action docs-search --query "<topic>"` or `pnpm action docs-search --slug "<slug>"`.
Hidden/linked skills: `rg --hidden --follow --files .agents/skills`.

## Core rules

- Use actions for recording metadata, transcripts, cleanup, chapters, comments, meetings, folders, sharing, and collaboration. Respect access helpers. Store large media/blob bytes in configured storage and persist references, not bytes in SQL, state, settings, or resources.
- For external integrations, inspect the workspace/provider connection catalog first. Reuse its scoped resolver. Never hardcode credentials, webhook URLs, private/customer data, or credential-like literals.
- Recording start/stop/pause are browser gestures requiring user activation; navigate to the recording view instead of using a server action. Prefer native transcripts; cloud transcription is fallback-only. Do not hide a usable transcript after failed metadata work.
- Use `import-loom-recording` for Loom, YouTube, or direct MP4/WebM URLs. Loom/public transcripts import in the background; request a transcript afterward for direct video. Transactional email claims two-Clip summary work and ends in one sentence.
- `view-screen` may return a transcript preview truncated mid-sentence without an ending marker. When `previewTruncated`, read `get-recording-player-data` before judging completeness or quoting.
- Clips are unlisted-by-link, not searchable. Only inspect recordings the user owns, viewed, or identified by URL/id. Never use `list-recordings` / `search-recordings` to find another person's clip, answer a date question, or recover a failed lookup; report the failure.
- Sharing actions control access; passwords/expiry only tighten it. Screen Memory is local-only and disabled by default; raw segments are never uploaded or shared. For an authorized private clip, use its chosen Rewind window only after the owner explicitly asks; the resulting Clip follows normal sharing rules.
- Never fabricate. Read via actions, verify writes by read-back, and refresh after writes. Use `view-screen` when recording, transcript segment, meeting, or share context is unclear.
- Read `dictate` before dictation work.
- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.

## Application state

- `navigation` tracks library, shared-with-me, recording, share, meeting, dictation, settings, and transcript context. A recording includes focused `panel` and requested `atMs`; `navigate` opens that viewer context.
- `selection` holds selected recording ids in selection mode. `recording-setup.import` holds the Loom-import UI state, never the pasted URL. `record-intent` is a UI-consumed capture request and is then cleared.

## Key actions

Use `tool-search` for the full surface, including screen-memory.

|Action|Purpose|
|---|---|
|`view-screen` / `navigate`|Read context or open a surface|
|`get-video-storage-status`|Check storage before asking to connect Builder|
|`list-recordings` / `search-recordings` / `get-recording-player-data`|Find authorized clips; read transcript and chapters|
|`create-recording-agent-link`|Make a temporary playback-only link|
|`get-recording-diagnostic-context`|Inspect explicitly authorized private context; see recording/video-sharing skills|
|`create-recording-upload` / `import-loom-recording`|Upload a local video file or import one from a URL|
|`request-transcript` / `import-transcript` / `cleanup-transcript` / `regenerate-title` / `regenerate-summary` / `regenerate-chapters`|Transcription, imported VTT/SRT/timestamped transcripts, and metadata|
|`trim-recording` / `split-recording` / `remove-silences` / `remove-filler-words`|Edit video|
|`share-resource` / `set-resource-visibility` / `build-embed-url`|Share or embed|
|`list-meetings` / `search-meetings` / `list-dictations`|Meetings and dictation|
|`export-to-brain` / `prepare-crm-call-evidence`|Send transcripts or CRM call evidence|

Before building common workspace or agent UI, read `agent-native-toolkit`; for supported customization, read `customizing-agent-native`.
