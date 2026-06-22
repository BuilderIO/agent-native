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
- Use `import-loom-recording` for Loom share/embed URLs. It downloads Loom's
  public MP4, reuploads it to Clips storage, creates a ready playable
  Clips-hosted recording, and imports Loom's public transcript when the share
  page exposes one. If Loom does not expose a downloadable MP4, ask the user to
  download the original from Loom and use "Upload video".
- Native transcript first. Cleanup and title generation can run in the
  background; do not hide a usable native transcript behind a failed cleanup.
- Cloud transcription is fallback-only for Clips recordings and should use the
  configured Builder/Gemini or Groq paths, not OpenAI.
- Use `view-screen` when the active recording, transcript segment, meeting, or
  share context is unclear.
- Calendar-sourced meeting actions are shortcuts, but do not add raw
  `provider-api-request` for Google Calendar until the provider API runtime can
  resolve Clips `calendar_accounts` through sharing/access checks and read their
  encrypted `app_secrets` token refs. Clips calendar grants are not stored in
  core `oauth_tokens`, and bypassing that model would break the account
  sharing/status boundary.
- Use framework sharing actions for recordings. Password and expiry are extra
  controls on top of visibility/share grants.
- Public recordings expose AI-readable URLs for external agents:
  `/api/agent-context.json?id=<recordingId>` for metadata, transcript, and frame
  API discovery; `/api/agent-transcript.json?id=<recordingId>` for transcript
  segments; `/api/agent-frame.jpg?id=<recordingId>&atMs=<ms>` for a screen
  frame at a timestamp. Password-protected clips require the password once to
  mint a short-lived token returned inside agent-context links.
- Slack unfurls use `/api/slack/unfurl` for `link_shared` events and only
  return playable `chat.unfurl` video blocks for ready public clips with no
  password, no expiry hit, and no archive/trash marker. Private, org-only,
  passworded, expired, or unfinished clips should fall back to normal link
  metadata and require opening Clips.
- Browser recordings can include redacted browser diagnostics captured during
  the recording session. `save-browser-diagnostics` is UI/internal and stores
  bounded console logs plus fetch/XHR method, URL path/query keys, status, and
  duration; it never captures headers, bodies, cookies, or query values. Use
  `get-recording-player-data` for full diagnostics when you have editor access;
  public agent context only exposes a compact issue summary.
- The Chrome extension lives in `chrome-extension/`. It launches `/record` with
  `clipsExtensionId` and `clipsCaptureSessionId`, then the recorder sends
  `CLIPS_CAPTURE_START/STOP/CANCEL` back to the extension. The extension uses
  the Chrome debugger API only on the tab the user launched from, only while a
  recording is active, and returns the same redacted diagnostics shape saved by
  `save-browser-diagnostics`.
- After mutations, rely on the app refresh/polling path; do not invent a second
  sync mechanism.

## Application State

- `navigation` exposes library, recording, share, meeting, dictation, settings,
  selected ids, and transcript context.
- `recording-setup.import` exposes Loom import UI state while the `/record`
  surface is open, without storing the pasted URL in ambient screen context.
- `navigate` moves the UI to recording/library/meeting/share surfaces.
- Use data actions for full transcripts and media metadata.
- For the in-app Clips agent, prefer `get-recording-player-data` for full
  private/authenticated recording context. Use the public agent-context URLs
  when preparing a link for another agent outside Clips.

## Skills

Read the relevant skill before deeper work:

- `recording` for recording lifecycle and transcript handling.
- `video-editing` and `ai-video-tools` for edits, cleanup, titles, and summaries.
- `video-sharing` for public links, passwords, expiry, embeds, and grants.
- `meetings` and `dictate` for calendar-sourced meetings and dictation flows.
- `actions`, `security`, `frontend-design`, and `shadcn-ui` as needed.
