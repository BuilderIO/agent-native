# Clips — Agent Guide

Clips is an agent-native screen-recording, transcript, meetings, and video
sharing app. The agent assists with recordings, transcripts, summaries, chapters,
comments, folders/spaces, meetings, dictation, and sharing through actions.

Detailed media, meeting, dictation, editing, and sharing rules live in
`.agents/skills/`.

## Core Rules

- Store large file/blob payloads in configured file/blob storage, not SQL: no
  base64, `data:` URLs, images, video/audio, PDFs, ZIPs, screenshots,
  thumbnails, or replay chunks in app tables, `application_state`, `settings`,
  or `resources`; persist URLs, ids, or handles instead.
- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Use actions for recording metadata, transcripts, cleanup, summaries, chapters,
  comments, spaces/folders, meetings, and sharing. Do not bypass access helpers.
- Use `move-recording` for both single and bulk folder moves. Pass `id` for one
  clip or `ids` for selected clips, and `folderId: null` to move them to the
  library or space root.
- Recording start/stop/pause are UI gestures because browser media capture needs
  user activation; navigate the user to the recording view instead of trying a
  server action.
- Screen Memory is a local-only desktop buffer, not a hosted Clips recording.
  Users enable/pause/export/clear it from the desktop tray settings. External
  local agents can read recent app/window context through
  `agent-native mcp screen-memory`; do not upload raw Screen Memory segments or
  treat them as shareable Clips unless the user explicitly exports/imports them.
- Use `import-loom-recording` for Loom share/embed URLs. It downloads Loom's
  public MP4, reuploads it to Clips storage, creates a ready playable
  Clips-hosted recording, and imports Loom's public transcript when the share
  page exposes one. If Loom does not expose a downloadable MP4, ask the user to
  download the original from Loom and use "Upload video".
- Native transcript first. Cleanup and title generation can run in the
  background; do not hide a usable native transcript behind a failed cleanup.
- Dictation cleanup, Clip title/cleanup, and meeting summaries should pass
  bounded `voiceContext` to the shared cleanup/transcription path when active
  app context, learned vocabulary, user notes, or AGENTS.md preferences are
  available.
- Cloud transcription is fallback-only for Clips recordings and should use the
  configured Builder/Gemini or Groq paths, not OpenAI.
- AI setup must be visible and paid-account-backed: lead with Builder.io Connect
  for managed credits, object storage, uploads, and transcription. BYOK belongs
  in the agent sidebar's API Keys & Connections panel; template settings may
  signpost that panel but should not create a second credential vault.
  Anthropic/OpenAI power the agent chat; Gemini powers cleanup, titles, and
  meeting notes; Groq powers backup speech-to-text.
- Hosted/shared recording uploads require configured storage. Do not preserve
  video bytes in SQL as a production fallback; only local SQLite/dev flows may
  keep scratch chunks while a user connects Builder.io or S3-compatible storage.
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
- If public agent context or transcript APIs report `transcript.status` as
  `"pending"`, wait 15-30 seconds and retry the context/transcript URL a few
  times, especially for long recordings. Do not pivot straight to frames or tell
  the user there is no transcript until the retry budget is exhausted.
- If transcription failed because Builder transcription credits are exhausted,
  tell the user that clearly and point them to Builder.io credits/upgrade or a
  Groq key for backup speech-to-text. Generic OpenAI or Anthropic chat keys do
  not transcribe Clips recordings.
- Use `get-builder-credit-status` when the user asks whether Builder.io credit
  limits are pausing backup transcription, transcript cleanup, summaries, or AI
  title generation. Treat an exhausted status as an FYI/upgrade path, not an app
  error.
- Slack unfurls use `/api/slack/unfurl` for `link_shared` events and only
  return playable `chat.unfurl` video blocks for ready public clips with no
  password, no expiry hit, and no archive/trash marker. Private, org-only,
  passworded, expired, or unfinished clips should fall back to normal link
  metadata and require opening Clips.
- Slack installs should go through the Clips Settings OAuth flow
  (`connect-slack`, `/api/slack/oauth/callback`) so each Slack workspace gets
  its own encrypted bot token in `app_secrets`. `SLACK_BOT_TOKEN` is only a
  legacy single-workspace fallback and must remain behind the team allowlist.
- Browser recordings can include redacted browser diagnostics captured during
  the recording session. `save-browser-diagnostics` is UI/internal and stores
  bounded console logs plus fetch/XHR method, URL path/query keys, status, and
  duration; it never captures headers, bodies, cookies, or network URL query
  values. Console text keeps useful non-secret values while redacting
  credential-looking keys/headers. Use `get-recording-player-data` for full
  diagnostics when you have editor access. Public agent context exposes the
  redacted console stream (all levels) as `browserDiagnostics.consoleLogs` and
  the fetch/XHR stream as `browserDiagnostics.networkRequests` (method,
  sanitized URL with query values redacted, status, duration), plus
  `consoleIssues` and `failedNetworkRequests` highlights. All bounded; page
  URL, headers, bodies, and cookies stay omitted.
- Embedded bug reports use `/bug-report` as an iframe-friendly launcher and
  `/record?intent=bug-report` for the actual top-level capture flow. The
  launcher stores redacted host metadata through `save-bug-report-context`; the
  recording remains the canonical resource and defaults to workspace visibility.
  Do not present this as anonymous customer intake until a signed intake/upload
  token flow exists, because the current upload endpoints are owner-scoped.
- The Chrome extension lives in `chrome-extension/`. It launches `/record` with
  `clipsExtensionId` and `clipsCaptureSessionId`, then the recorder sends
  `CLIPS_CAPTURE_START/STOP/CANCEL` back to the extension. The extension uses
  the Chrome debugger API only on the tab the user launched from, only while a
  recording is active, and returns the same redacted diagnostics shape saved by
  `save-browser-diagnostics`.
- The Chrome extension also enhances GitHub issue and PR markdown: a narrow
  `github.com` content script detects Clips `/r/`, `/share/`, and `/embed/`
  links, then renders the existing `/embed/:id` player in an extension-owned
  preview iframe so the video is playable without leaving GitHub. Keep this
  scoped to GitHub unless there is a deliberate permission review.
- Screen Memory is a disabled-by-default, local-only desktop capability for
  recent screen/app/window context. Use `get-screen-memory-status` before
  relying on it, then `query-screen-memory-context` for bounded recent snippets
  when local context files are present. If the local Screen Memory MCP built-in
  is connected, the agent may also use `screen_memory_status`,
  `screen_memory_recent_context`, and `screen_memory_recent_segments`; only
  inspect or export segment file paths when the user explicitly asks. Never
  describe Screen Memory as hosted, shared, exhaustive, or enabled by default.
- After mutations, rely on the app refresh/polling path; do not invent a second
  sync mechanism.

## Application State

- `navigation` exposes library, recording, share, meeting, dictation, settings,
  and transcript context. `selection` exposes selected library recording ids
  when the user is in selection mode.
- `recording-setup.import` exposes Loom import UI state while the `/record`
  surface is open, without storing the pasted URL in ambient screen context.
- `navigate` moves the UI to recording/library/meeting/share surfaces.
- Use data actions for full transcripts and media metadata.
- For the in-app Clips agent, prefer `get-recording-player-data` for full
  private/authenticated recording context. When preparing a link for another
  agent outside Clips, use `create-recording-agent-link`; it mints a two-hour
  `agent_access` share URL without changing recording visibility.
- Use `@agent-native/core/server` and `@agent-native/core/shared` agent-access
  helpers for scoped token mint/verify and bot-visible URL construction. Keep
  Clips-specific visibility, password, transcript, frame, and player behavior
  in Clips. New URLs should use `agent_access`; existing agent API routes should
  keep accepting legacy `t` tokens for copied links.

## Skills

Read the relevant skill before deeper work:

- `recording` for recording lifecycle and transcript handling.
- `video-editing` and `ai-video-tools` for edits, cleanup, titles, and summaries.
- `video-sharing` for public links, passwords, expiry, embeds, and grants.
- `meetings` and `dictate` for calendar-sourced meetings and dictation flows.
- `actions`, `security`, `frontend-design`, and `shadcn-ui` as needed.
