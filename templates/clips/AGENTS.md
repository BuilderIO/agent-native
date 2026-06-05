# Clips — Agent Guide

Clips is an agent-native screen-recording, transcript, meetings, and video
sharing app. The agent assists with recordings, transcripts, summaries, chapters,
comments, folders/spaces, meetings, dictation, and sharing through actions.

Detailed media, meeting, dictation, editing, and sharing rules live in
`.agents/skills/`.

## Core Rules

- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Use actions for recording metadata, transcripts, cleanup, summaries, chapters,
  comments, spaces/folders, meetings, and sharing. Do not bypass access helpers.
- Recording start/stop/pause are UI gestures because browser media capture needs
  user activation; navigate the user to the recording view instead of trying a
  server action.
- Native transcript first. Cleanup and title generation can run in the
  background; do not hide a usable native transcript behind a failed cleanup.
- Cloud transcription is fallback-only for Clips recordings and should use the
  configured Builder/Gemini or Groq paths, not OpenAI.
- Use `view-screen` when the active recording, transcript segment, meeting, or
  share context is unclear.
- Use framework sharing actions for recordings. Password and expiry are extra
  controls on top of visibility/share grants.
- After mutations, rely on the app refresh/polling path; do not invent a second
  sync mechanism.

## Application State

- `navigation` exposes library, recording, share, meeting, dictation, settings,
  selected ids, and transcript context.
- `navigate` moves the UI to recording/library/meeting/share surfaces.
- Use data actions for full transcripts and media metadata.

## Skills

Read the relevant skill before deeper work:

- `recording` for recording lifecycle and transcript handling.
- `video-editing` and `ai-video-tools` for edits, cleanup, titles, and summaries.
- `video-sharing` for public links, passwords, expiry, embeds, and grants.
- `meetings` and `dictate` for calendar-sourced meetings and dictation flows.
- `actions`, `security`, `frontend-design`, and `shadcn-ui` as needed.
