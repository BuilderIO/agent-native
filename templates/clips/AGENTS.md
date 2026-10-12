# Clips — Agent Guide

Clips records screens and meetings, manages transcripts, dictation, editing, and video sharing through shared SQL state and actions.

## Skills

Search with `rg --hidden --follow`; read the exact linked guide before deeper work. App: `.agents/skills/recording/SKILL.md` (capture, upload, playback, Loom, mobile, folders), `.agents/skills/ai-video-tools/SKILL.md` (transcription, cleanup, summaries, AI setup), `.agents/skills/video-editing/SKILL.md`, `.agents/skills/video-sharing/SKILL.md`, `.agents/skills/meetings/SKILL.md`, `.agents/skills/dictate/SKILL.md`, `.agents/skills/brain-export/SKILL.md`, `.agents/skills/crm-call-evidence/SKILL.md`, `.agents/skills/screen-memory/SKILL.md`, `.agents/skills/bug-reports/SKILL.md`, `.agents/skills/external-integrations/SKILL.md`. Shared: `.agents/skills/a2a-protocol/SKILL.md`, `.agents/skills/actions/SKILL.md`, `.agents/skills/adding-a-feature/SKILL.md`, `.agents/skills/agent-native-docs/SKILL.md`, `.agents/skills/agent-native-toolkit/SKILL.md`, `.agents/skills/authentication/SKILL.md`, `.agents/skills/client-side-routing/SKILL.md`, `.agents/skills/context-awareness/SKILL.md`, `.agents/skills/customizing-agent-native/SKILL.md`, `.agents/skills/delegate-to-agent/SKILL.md`, `.agents/skills/external-agents/SKILL.md`, `.agents/skills/frontend-design/SKILL.md`, `.agents/skills/performance/SKILL.md`, `.agents/skills/portability/SKILL.md`, `.agents/skills/real-time-sync/SKILL.md`, `.agents/skills/reliable-mutations/SKILL.md`, `.agents/skills/secrets/SKILL.md`, `.agents/skills/security/SKILL.md`, `.agents/skills/self-modifying-code/SKILL.md`, `.agents/skills/server-plugins/SKILL.md`, `.agents/skills/shadcn-ui/SKILL.md`, `.agents/skills/sharing/SKILL.md`, `.agents/skills/storing-data/SKILL.md`, `.agents/skills/turn-into-skill/SKILL.md`, `.agents/skills/workspace-conventions/SKILL.md`.

Use local docs only (no web research): `pnpm action docs-search --query "<topic>"` and `pnpm action docs-search --slug "<slug>"`.

## Core rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Use actions for recording metadata, transcripts, cleanup, chapters, comments, meetings, folders, sharing, and collaboration. Respect access helpers. Keep large media/blob payloads out of SQL, state, settings, and resources; store bytes in configured storage and persist references.
- For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver. Never hardcode credentials, webhook URLs, private/customer data, or credential-like literals.
- Recording start/stop/pause are browser gestures requiring user activation; navigate to the recording view instead of using a server action. Prefer native transcripts; cloud transcription is fallback-only. Do not hide a usable transcript after failed metadata work.
- Use `import-loom-recording` for Loom or direct MP4/WebM URLs. Loom/public transcripts import in the background; request a transcript afterward for direct video. Transactional email claims two-Clip summary work and ends in one sentence.
- `view-screen` may return a transcript preview truncated mid-sentence without an ending marker. When `previewTruncated`, read `get-recording-player-data` before judging completeness or quoting.
- Clips are unlisted-by-link, not searchable. Only inspect recordings the user owns, viewed, or identified by URL/id. Never use `list-recordings` / `search-recordings` to find another person's clip, answer a date question, or recover a failed lookup; report the failure.
- Sharing actions control access; passwords/expiry only tighten it. Screen Memory is local-only and disabled by default; raw segments are never uploaded or shared. The one exception is an owner's explicit request: a chosen window of Rewind history is uploaded as a private recording attached to one Clip, that Clip stays private, and sharing is refused until that context is removed.
- Never fabricate. Read via actions, verify writes by read-back, and refresh after writes. Use `view-screen` when recording, transcript segment, meeting, or share context is unclear.

## Application state

- `navigation` tracks library, shared-with-me, recording, share, meeting, dictation, settings, and transcript context. A recording includes focused `panel` and requested `atMs`; `navigate` opens that viewer context.
- `selection` holds selected recording ids in selection mode. `recording-setup.import` holds the Loom-import UI state, never the pasted URL. `record-intent` is a UI-consumed capture request and is then cleared.

## Key actions

Use `tool-search` for the full surface, including screen-memory.

| Action | Purpose |
| --- | --- |
| `view-screen` / `navigate` | Read context or open a surface |
| `list-recordings` / `search-recordings` / `get-recording-player-data` | Find authorized clips; read transcript, chapters, diagnostics |
| `create-recording-agent-link` | Make a temporary scoped link for an authorized private clip |
| `create-recording` / `finalize-recording` / `import-loom-recording` | Create, upload, or import a recording |
| `request-transcript` / `cleanup-transcript` / `regenerate-title` / `regenerate-summary` / `regenerate-chapters` | Transcription and metadata |
| `trim-recording` / `split-recording` / `remove-silences` / `remove-filler-words` | Edit video |
| `share-resource` / `set-resource-visibility` / `build-embed-url` | Share or embed |
| `list-meetings` / `search-meetings` / `list-dictations` | Meetings and dictation |
| `export-to-brain` / `prepare-crm-call-evidence` | Send transcripts or CRM call evidence |

Before building common workspace or agent UI, read `agent-native-toolkit`; for supported customization, read `customizing-agent-native`.
