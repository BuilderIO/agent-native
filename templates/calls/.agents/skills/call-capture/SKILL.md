---
name: call-capture
description: >-
  How calls get into the system — three paths: file upload (chunked or direct),
  browser recorder (MediaRecorder), and meeting bots (Recall.ai) or Zoom cloud
  auto-import. Use when adding or modifying the upload flow, recorder UI,
  bot scheduling, Zoom OAuth, or the finalize + transcribe handoff.
---

# Call Capture

## When to use

Reach for this skill any time you change how calls enter the system — drag-drop upload, the browser recorder button, the invite-a-bot dialog, the Zoom connection flow, or the server-side finalize path. If you're debugging "why did my upload stall at processing?" or "why didn't the bot join the meeting?", this is your map.

## The three capture paths

| Source       | How the call is created                                                                         | Media ends up in                                                 |
| ------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `upload`     | User drag-drops a file on `/upload`. UI creates the call, chunks the file, finalizes.           | Framework storage (preferred) or `application_state` stash (dev) |
| `browser`    | User clicks Record. `MediaRecorder` emits chunks; UI uses the same upload endpoints as `upload`. | Same as upload                                                   |
| `recall-bot` | User pastes a Zoom / Meet / Teams URL; `schedule-recall-bot` dispatches the bot; webhook returns the recording. | Framework storage (bot uploads on complete)                      |
| `zoom-cloud` | User has connected Zoom via OAuth; the Zoom webhook fires when a cloud recording is ready; `import-zoom-recording` fetches it. | Framework storage                                                |

`calls.source` captures which path was used. `calls.source_meta` (JSON) carries any path-specific metadata (Recall bot id, Zoom meeting uuid, etc.).

## Status machine

```
uploading → processing → transcribing → analyzing → ready
                                                  ↘
                                                    failed (any stage)
```

- `uploading` — call row exists, chunks are in flight.
- `processing` — `finalize-call` has run; blob is stored, metadata probed (duration / dimensions / mimeType).
- `transcribing` — Deepgram is running (or the webhook is pending).
- `analyzing` — transcript is ready; agent delegations are in flight (summary, topics, smart trackers, snippet suggestions). Keyword trackers have already run synchronously.
- `ready` — all pipeline steps done. The UI surfaces the full player.
- `failed` — `failure_reason` carries the human-readable cause. Use `retry-transcript` to recover from a transcript failure.

Always write status transitions through the actions — never raw SQL — so `refresh-signal` fires.

## Path 1 — Upload

### Chunked upload (large files)

1. UI calls `create-call` with `{ source: "upload", mediaKind, mediaFormat, title, folderId }`. Returns `{ id, uploadChunkUrl, uploadChunkUrlTemplate, abortUrl }`.
2. UI slices the file into chunks (typically 4–8 MB) and POSTs each to `/api/uploads/:callId/chunk?index=N&total=T&isFinal=0|1` with `Content-Type: application/octet-stream`.
3. On the last chunk (`isFinal=1`), the server triggers `finalize-call` which:
   - Concatenates chunks (from framework storage if available, else from `application_state` stashes).
   - Uploads the assembled blob via `@agent-native/core/storage` (`uploadFile`). In dev with no storage provider, it stashes the base64 bytes under `call-blob-<id>` in application state and points `media_url` at `/api/call-media/:callId`.
   - Sets `calls.status = "processing"`, populates `media_url`, `duration_ms`, `width`, `height`, `mediaFormat`.
   - Kicks off `request-transcript` (fire and forget).
4. The UI can also explicitly POST to `/api/uploads/:callId/complete` to trigger finalize without waiting for the last chunk.

### Direct upload (small files)

For small files where chunking is overkill, POST the whole file to `/api/uploads/direct` with `X-Call-Id` (optional — server will create) and `Content-Type: <mime>`. Server writes a single "chunk" + finalizes. Same status machine.

## Path 2 — Browser recorder

The recorder is a **UI gesture**. The agent can `navigate --view=upload` but cannot start `MediaRecorder` without a user click — permission + user-activation must come from a direct user action.

Flow:

1. User clicks Record on `/upload`. UI calls `navigator.mediaDevices.getUserMedia({ audio, video })` (audio default; video optional when the user toggles "with webcam").
2. UI calls `create-call` with `{ source: "browser", mediaKind: video ? "video" : "audio", mediaFormat: "webm" }`.
3. `new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" })` (or `video/webm;codecs=vp9,opus` for video). `timeslice: 2000`.
4. Each `ondataavailable` POSTs to `/api/uploads/:callId/chunk`.
5. On stop, POST `/api/uploads/:callId/complete`.

Pause / resume: keep the same `MediaRecorder` instance; do not tear down the stream (re-permission would re-prompt).

## Path 3 — Meeting bot (Recall.ai)

For live meetings the user doesn't want to record themselves, the agent or the user dispatches a bot:

```bash
pnpm action schedule-recall-bot --meetingUrl=https://zoom.us/j/1234567890 --scheduledAt=2026-04-17T15:00:00Z
```

What happens:

1. `schedule-recall-bot` calls the Recall.ai `POST /api/v1/bot` endpoint with the meeting URL, optional join time, and `webhook_url` set to `<NITRO_PUBLIC_URL>/api/webhooks/recall`.
2. A `recall_bots` row is inserted with status `scheduled` / `joining` / `recording` / `failed` depending on the Recall.ai response.
3. When the bot finishes, Recall.ai POSTs `/api/webhooks/recall` with a download URL. The handler inserts a `calls` row (`source: "recall-bot"`), downloads the media, stores it, marks `status: "processing"`, then triggers `request-transcript`.

Requires `RECALL_AI_API_KEY` in the env. Without it, `schedule-recall-bot` throws with a clear "not configured" error.

## Path 4 — Zoom cloud OAuth

For teams that record natively in Zoom's cloud:

1. User runs `connect-zoom`. The action returns the Zoom OAuth URL.
2. UI redirects to Zoom. On consent, Zoom redirects to `/api/oauth/zoom/callback` which exchanges the code for access + refresh tokens and inserts a `zoom_connections` row (tokens encrypted via framework encryption).
3. User's Zoom account is configured to send recording-ready webhooks to `<NITRO_PUBLIC_URL>/api/webhooks/zoom`. When a cloud recording completes, the webhook auto-imports it via `import-zoom-recording`.
4. `import-zoom-recording` uses the user's refresh token to download the `MP4`, creates a `calls` row (`source: "zoom-cloud"`, `source_meta` = Zoom meeting uuid), and hands off to `finalize-call`.

Requires `ZOOM_OAUTH_CLIENT_ID`, `ZOOM_OAUTH_CLIENT_SECRET`, `ZOOM_OAUTH_REDIRECT_URI` in the env.

## Dev fallback — the application-state stash

When no framework storage provider is configured (local dev with nothing set up), chunks are base64-encoded and stashed in `application_state` keyed by `call-chunk-<callId>-<index>`. `finalize-call` concatenates them into `call-blob-<callId>` and sets `media_url = "/api/call-media/<callId>"`. The `/api/call-media/:callId` route reads that stash when it detects a local URL.

This lets the full pipeline work end-to-end on a fresh clone with no S3 / R2 setup.

## Permission prompts

- Browser recorder: `getUserMedia` prompts the first time. If denied, mark the call `failed` with `failure_reason: "permission"` and surface a retry with a user-gesture button. Never re-prompt mid-recording.
- Recall.ai bot: no browser permissions — the bot joins as a meeting participant. The meeting host must admit it unless the room is open.
- Zoom cloud: OAuth consent once per user; after that, webhooks flow automatically.

## Error recovery

| Failure                             | Handling                                                                                             |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Chunk upload returns 5xx            | Retry 3× with exponential backoff; if still failing, stash the chunk and surface a banner in the UI. |
| Browser loses tab before finalize   | On reload, scan `application_state` for `call-upload-<id>` entries with status `uploading` and offer resume. |
| `finalize-call` fails mid-concat    | Set `calls.status = "failed"`, `failure_reason = <message>`. User can retry via `finalize-call --id=<id>`. |
| Deepgram fails                      | See the `transcription` skill — `retry-transcript` is the entry point.                               |
| Bot fails to join (403 / meeting locked) | `recall_bots.status = "failed"`, `raw_json.failureReason` set. Surface in the bots tab.          |
| Zoom token expires                  | Refresh flow fires automatically; if refresh fails, wipe the connection and prompt `connect-zoom` again. |

## Rules

- **Never** start `MediaRecorder` without a user gesture. The agent dispatches intent via `navigate`, never starts recording itself.
- **Never** bypass `finalize-call` — it's the one place that probes metadata and hands off to transcription.
- **Never** write chunks directly to `calls.media_url`; always go through `/api/uploads/:callId/chunk` so the finalize path is uniform.
- **Always** include a `webhook_url` when dispatching Recall.ai bots so the recording-ready callback lands.
- Chunk upload and finalize are idempotent — `finalize-call` can be called twice on the same call safely; the second call returns the already-ready state.

## Related skills

- `transcription` — kicks off automatically from `finalize-call`.
- `call-sharing` — share and expiry controls on the call row.
- `server-plugins` — why `/api/uploads/...` and `/api/webhooks/...` are custom routes, not actions.
- `real-time-sync` — how the UI learns about status transitions.
- `storing-data` — how the framework storage provider is configured.
