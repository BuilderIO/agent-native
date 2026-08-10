---
name: recording
description: >-
  How screen and camera recording works in Clips — MediaRecorder lifecycle,
  chunked upload, permission handling, pause/resume, camera bubble overlay,
  and error recovery. Use when adding or modifying the recorder UI, the
  upload endpoint, or permission prompts.
---

# Recording

## When to use

Reach for this skill any time you touch the recorder: the record button, the in-progress toolbar, permission prompts, chunked upload flow, or the camera bubble. If you're adding support for a new source (e.g. tab capture, iPhone continuity camera) or changing how chunks are finalized server-side, this is your map.

## Data model touched

- **`recordings`** — the row gets created as soon as the user presses Record or imports a source. Native/file recordings transition `uploading` → `processing` → `ready` (or `failed`). `videoUrl`, `durationMs`, `videoSizeBytes`, `width`, `height`, `hasAudio`, `hasCamera` are populated as the upload streams in. Loom imports use `import-loom-recording` and create a `ready` row whose `videoUrl` is a Loom embed URL.
- **`application_state.record-intent`** — the agent writes this when it wants to start a recording. The UI reads and clears it, then prompts for permission.
- **`application_state.navigation`** — set to `{ view: "record" }` while the recorder is active.

Binary uploads hit the **custom API** routes (`/api/uploads/:id/chunk` and `/api/uploads/:id/abort`) rather than actions, because actions aren't the right tool for binary streaming bodies. The final chunk calls `finalize-recording`. Loom URL imports are metadata-only and should go through the `import-loom-recording` action.

Some recordings are linked to a meeting — when `meeting_id` is non-null on the recording row, it was created via `start-meeting-recording` and both the `recording` and `meetings` skills apply. See the `meetings` skill for the bidirectional link.

## Lifecycle

1. **Intent.** Either the user clicks Record (global `Cmd+Shift+L`) or the agent calls `pnpm action start-recording --mode=screen`. The agent version writes `record-intent` to application state; the UI picks it up and initiates the same flow as a user click.
2. **Permission.** Call `navigator.mediaDevices.getDisplayMedia({ video, audio })` for screen, `getUserMedia({ video, audio })` for camera. Do **not** prompt without a user gesture. The agent path relies on the UI's button — we never bypass the browser's permission model.
3. **Create row.** As soon as the stream is granted, call `create-recording` to insert the row with `status: "uploading"` and a pre-generated id. That id is used for every subsequent chunk upload.
4. **Record.** Start a `MediaRecorder` with `mimeType: "video/webm;codecs=vp9,opus"` (fallback to vp8, then browser default). Use `timeslice: 2000` so chunks arrive every 2s.
5. **Upload each chunk.** `ondataavailable` POSTs the chunk bytes to `/api/uploads/chunk` with headers `X-Recording-Id` and `X-Chunk-Index`. Don't retry inline — buffer failed chunks in `IndexedDB` and let a background worker re-send.
6. **Live transcription.** Alongside the MediaRecorder, `useLiveTranscription` runs the Web Speech API to accumulate transcript text in real time. On stop, the client calls `save-browser-transcript` to persist the result immediately — no API key needed. Desktop recordings use local Whisper/macOS speech first when available, and fall back to Web Speech in the webview on non-mac before relying on upload transcription.
7. **Finalize.** On stop, send the final chunk to `/api/uploads/:id/chunk?isFinal=1`. The route calls `finalize-recording`, which stitches chunks, makes the media seekable (see below), uploads the finished media when storage is configured, transitions `status` to `ready`, then kicks off `request-transcript` for higher-quality output (see `ai-video-tools`).
8. **Navigate immediately.** Desktop recorders open `/r/:id` as soon as Stop
   starts finalization. The recording row already exists, so the page can show
   the title, share link, and upload progress while it polls from `uploading` or
   `processing` to `ready`. Do not wait for the upload/finalize response before
   opening the page.

## Mobile companion lifecycle

The Agent Native mobile app uses the same recording rows and binary upload
routes with native capture primitives:

1. Camera video/import uses `expo-camera` / the system photo picker; meeting
   audio uses `expo-audio` with background recording enabled.
2. The native file is copied into the documents directory and a typed
   AsyncStorage capture job is written before upload starts.
3. `create-recording` receives a stable client-generated id,
   `sourceAppName: "Agent Native Mobile"`, and the container MIME type.
4. Upload reads at most 3 MiB through an Expo FileHandle and persists the next
   chunk index after every acknowledged POST. The 4 MiB server cap still
   applies.
5. Foreground/resume reconciliation polls `/api/uploads/:id/status`; retryable
   failures back off and never discard the local file. Completion can post a
   local notification and the recording appears in Clips everywhere.

Mobile audio M4A is an MP4 container and uses the recording route's MP4 MIME
alias. The bytes are not converted or loaded whole into JavaScript memory.

Because the phone persists each audio/video file before any network work and
resumes bounded chunk uploads from its durable queue, a transient upload failure
never loses the capture. Do not ask users to keep a capture screen open or to
re-record after a failed upload; tell them to reconnect Clips and retry the
saved job from mobile Home.

Mobile meeting capture is microphone-only; never claim it has the desktop
mic-plus-system-audio fidelity. See the **meetings** skill for what that means
for attendee attribution.

## Seekable playback (don't ship raw MediaRecorder output)

Raw `MediaRecorder` files are not friendly to progressive HTTP playback, which
shows up as "clip takes minutes to load" and "re-buffers every time I seek"
even though the file downloads fine:

- **MP4** is written with the `moov` metadata atom _after_ `mdat`, so a player
  must fetch the whole file before it can start or seek.
- **WebM** is a live stream with no Cues (seek index) and an unknown Segment
  duration, so Chrome won't honor `currentTime = X` and has to scan/download.

`finalize-recording` fixes this before upload: MP4 gets pure-TS faststart
(`server/lib/faststart.ts`), WebM gets a lossless `ffmpeg -c copy` remux that
writes a SeekHead + Cues + real duration (`server/lib/video-remux.ts`). Both are
best-effort — on failure we upload the original, never block finalize. Recordings
above `CLIPS_INLINE_REMUX_MAX_BYTES` (default 200 MB) skip the inline pass and
are repaired in the background.

The **streaming/resumable** upload path forwards raw bytes straight to the
provider and cannot rewrite them inline, so `finalize-recording` schedules a
background `ensureRecordingSeekable` pass for those.

To repair clips uploaded before this existed (or via streaming), call the
`reprocess-recording` action: `--id`, `--ids='[...]'`, or `--all --limit=N`. It
re-fetches provider media, rewrites it, re-uploads, and repoints the row. It's
idempotent (already-seekable clips are skipped unless `--force`) and only touches
provider-hosted clips owned by the caller. This is the right tool when a user
reports a specific slow/buffering clip.

Seekability remuxing cannot repair a recording whose audio continues while the
video track has a large timestamp gap (common when a mobile browser suspends the
camera after the user switches apps). For a clip that freezes or appears to stop
before its declared duration, call `reprocess-recording` with
`--normalizeTimeline=true`. That explicit mode uses the same owner-scoped fetch
and upload flow but fully transcodes to a constant-30-fps faststart MP4 (H.264 +
AAC). It preserves audio and duplicates the last decoded video frame through
missing-frame gaps. The action uploads to a new media object and atomically
repoints the row only after verified output is stored; any transcode, audio
verification, upload, or concurrent-update failure leaves the original URL and
format untouched.

## Loom import

Use `import-loom-recording` for Loom share or embed URLs. The action validates
the Loom URL, reads Loom oEmbed metadata from Loom's public endpoint, and creates
a `ready` recording with Loom's embed URL, thumbnail, title, duration, and
dimensions. When Loom exposes a signed public transcript JSON URL on the share
page, the action imports that transcript into Clips and stores normalized
segments; never store Loom's signed CDN URLs.

When Loom exposes a downloadable public MP4, `import-loom-recording` downloads
it, reuploads the bytes to Clips storage, and creates a ready, playable
Clips-hosted recording, importing Loom's public transcript when the share page
exposes one. If Loom does not expose a downloadable MP4, ask the user to download
the original from Loom and use "Upload video".

Loom imports are embed-backed, not Clips-owned video files. The player renders a
Loom iframe and the native Clips editor is hidden for those recordings. If the
user needs Clips-native trimming, exports, frame extraction, or upload-based
transcription, ask them to upload the original video file instead.

## Browser diagnostics and recorder install options

Browser recordings can save bounded, redacted diagnostics through
`createBrowserDiagnosticsCapture`: console messages plus fetch/XHR method, URL,
status, duration, and errors. The browser recorder only captures activity from
the recorder page itself. The Clips Chrome extension is the active-tab path for
browser logs: it launches `/record` with an extension capture session and passes
`developerLogs=1/0`, then saves diagnostics with source `extension`.

The Web Store listing is live, so the public Chrome extension option shows by
default. UI prompts that otherwise say "Download desktop app" use the shared
install-choice component (`CaptureInstallButton` / `CaptureInstallInlineLink`)
to offer two options: Chrome extension for browser logs, and desktop app for the
most seamless native capture. Set `VITE_CLIPS_CHROME_EXTENSION_ENABLED=0` to hide
the Chrome option again, or `VITE_CLIPS_CHROME_EXTENSION_URL` to point at a
different listing.

`save-browser-diagnostics` is UI/internal. It stores bounded console logs plus
fetch/XHR method, URL path/query keys, status, and duration. It never captures
headers, bodies, cookies, or network URL query values. Console text keeps useful
non-secret values while redacting credential-looking keys and headers. Use
`get-recording-player-data` for the full diagnostics payload when you have
editor access; see the **video-sharing** skill for the narrower redacted stream
that public agent context exposes.

## Chrome extension

The extension lives in `chrome-extension/`. It launches `/record` with
`clipsExtensionId` and `clipsCaptureSessionId`, and the recorder sends
`CLIPS_CAPTURE_START` / `CLIPS_CAPTURE_STOP` / `CLIPS_CAPTURE_CANCEL` back to the
extension. It uses the Chrome debugger API only on the tab the user launched
from, only while a recording is active, and returns the same redacted
diagnostics shape saved by `save-browser-diagnostics`.

The extension also enhances GitHub issue and PR markdown: a narrow `github.com`
content script detects Clips `/r/`, `/share/`, and `/embed/` links, then renders
the existing `/embed/:id` player in an extension-owned preview iframe so the
video is playable without leaving GitHub. Keep this scoped to GitHub unless there
is a deliberate permission review.

## Folders, spaces, and bulk moves

Use `move-recording` for both single and bulk folder moves. Pass `id` for one
clip or `ids` for the selected clips, and `folderId: null` to move them to the
library or space root.

## Pause / resume

`MediaRecorder.pause()` / `.resume()` are supported in all evergreen browsers. Keep a single `MediaRecorder` instance across pauses — don't tear down the stream, or the permission prompt will fire again. While paused, the upload worker keeps draining its buffer so we catch up before the user stops.

## Camera bubble

When mode is `screen+camera`, "the bubble" is two different things:

- **On-screen self-view.** `CameraBubble` renders a plain, unrecorded `<video>` element the user drags around to frame themselves during countdown/recording. It is never captured — it's just local framing UI.
- **Recorded composite.** Display capture can't include that DOM element once the user records another window/app, so the saved video has to bake the camera circle in before `MediaRecorder` ever sees a frame. `createCameraCompositeStream` (`app/lib/camera-composite.ts`) draws the display video plus a clipped, mirrored camera circle onto an offscreen `<canvas>` and feeds `canvas.captureStream()` into a single `MediaRecorder`. There is **no** second `MediaRecorder` and **no** server-side ffmpeg stitching — the composite happens client-side, live, before upload.

Because that draw loop runs continuously for the whole recording, keep its CPU/GPU cost bounded: a Worker-based timer drives the draw loop at the capture frame rate (`SCREEN_CAPTURE_FRAME_RATE`, 24fps — falling back to `requestAnimationFrame` only if Worker creation fails, e.g. under a strict CSP), the canvas is hard-capped to 1080p-class dimensions (1920px on its longest edge) even if the source display track is Retina/4K, and the bubble's drop shadow is pre-rendered into a small cached sprite (keyed by bubble size) instead of re-blurring with `shadowBlur` every frame.

## Restart (desktop)

Restart throws the current take away and immediately starts another one. It
must never re-acquire the screen: the toolbar click reaches the popover through
async Tauri IPC, which carries no user activation, so a second `getDisplayMedia`
would throw. Instead the dying session hands its live display and mic streams to
the replacement — `RecorderHandle.discardForRestart()` returns a `RestartHandoff`
that `startRecording` accepts as `preAcquiredDisplayStream` /
`preAcquiredAudioStream`.

Ownership is the opposite of the camera's. The popover owns the camera stream for
the whole session and re-hands it unchanged, so restart must not bump
`bubbleSessionEpoch` or clear `bubbleStreamTransferredToRecorder`. The handed-off
display and mic streams belong to the **recorder**, so the new session stops them
on its own stop/cancel, and whoever asked for the restart must stop them if the
new session never comes up.

`cancel()` and `discardForRestart()` share one `discardTake(forRestart)` per
backend, and the difference is which teardown they run. Cancel ends the
*session*: `hide_overlays` (which destroys the camera bubble window too) and
`clearRecordingState()`. A restart ends only the *take*, so it uses
`hide_recording_chrome`, which spares the bubble, and leaves the recording state
active.

Stop, cancel and restart are mutually exclusive terminal transitions, so each
gets its own promise slot — never reuse `cancelPromise` for a discard, or a
cancel arriving mid-restart returns the take-level teardown and the session
never ends. A cancel that lands after a discard still owes the session half,
plus stopping the capture the retake never took ownership of. On the app side
`restartInFlightRef` latches synchronously so stop and cancel events cannot act
on the recorder a restart is already tearing down.

Native full-screen backends re-acquire capture in Rust and hand off nothing.
`resolveRestartHandoff` vets the inherited streams before anything is acquired,
and it treats the two kinds of capture differently: an ended display share is
fatal and fails with `RESTART_CAPTURE_ENDED_MESSAGE`, because re-acquiring it
would surface an activation error that names the wrong cause, while an ended
microphone is just dropped and re-acquired normally. A restart also has to wait
for the old take's `transcriptionCapture.cancel()` — the engine is process-global
(`audio_transcription_stop` / `native_speech_stop`), so a late cancel would stop
the replacement's engine. And `stop()` after a discard must throw rather than
answer with the discarded take's id, or an aborted recording gets published as a
finished one. The
recording-flow latches (`recordingFlowGateRef`, `recordingFlowActive`,
`clipsForceAlive`, `set_recording_state`) stay held across the restart; releasing
them the way cancel does lets the popover blur auto-hide fire mid-restart.

Holding those latches has a catch. The `show_toolbar` effect is keyed on
`isRecording || recordingFlowActive`, so it does not re-run when the flow never
leaves — but the discard already closed the toolbar window. Restart therefore
bumps `recordingChromeEpoch` to rebuild it. The countdown needs no such nudge;
the recorder recreates it on every start.

## Error recovery

| Failure                       | Handling                                                                  |
| ----------------------------- | ------------------------------------------------------------------------- |
| Permission denied             | Mark the recording row `status: "failed"`, `failureReason: "permission"`. |
| Chunk upload fails (5xx)      | Retry 3× with backoff; if still failing, park the chunk in IndexedDB.     |
| `MediaRecorder` error event   | Stop, finalize what we have, set `failureReason`; let the user retry.     |
| User closes tab mid-recording | On reload, check for unflushed chunks in IndexedDB and resume upload.     |

## Code sketch

```ts
// app/hooks/use-recorder.ts
export function useRecorder() {
  const start = async (mode: "screen" | "camera" | "screen+camera") => {
    const stream =
      mode === "camera"
        ? await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
          })
        : await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true,
          });

    const { id } = await callAction("create-recording", {
      title: "Untitled recording",
    });

    const rec = new MediaRecorder(stream, {
      mimeType: "video/webm;codecs=vp9,opus",
    });
    let chunkIndex = 0;
    rec.ondataavailable = async (e) => {
      if (!e.data.size) return;
      const params = new URLSearchParams({
        index: String(chunkIndex++),
        total: "unknown-until-stop",
        isFinal: "0",
      });
      await fetch(`/api/uploads/${id}/chunk?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: e.data,
      });
    };
    rec.onstop = async () => {
      // Send the final chunk with isFinal=1; the route calls finalize-recording.
    };
    rec.start(2000);
    return {
      id,
      stop: () => rec.stop(),
      pause: () => rec.pause(),
      resume: () => rec.resume(),
    };
  };

  return { start };
}
```

## Rules

- **Never** start a `MediaRecorder` without a user gesture (or a user-initiated `record-intent`).
- **Never** re-prompt for permissions on pause/resume — reuse the stream.
- **Never** fire the upload from the main thread if the chunks are large — prefer a web worker for anything longer than ~60s.
- **Never** read a complete mobile recording into JavaScript memory. Use bounded
  FileHandle reads and checkpoint every acknowledged chunk.
- The `recordings` row must exist **before** the first chunk is sent.
- On every lifecycle change, write `navigation` → `{ view: "record" }` → `{ view: "recording", recordingId }` so the agent can see what's happening.
- All AI generated during/after recording goes through the agent chat — see `ai-video-tools`.

## Related skills

- `ai-video-tools` — transcription kicks off when upload completes.
- `video-editing` — after recording, users edit via non-destructive `editsJson`.
- `server-plugins` — why the upload is an `/api/` route, not an action.
- `real-time-sync` — how the UI learns about `status` transitions from `uploading` → `ready`.
