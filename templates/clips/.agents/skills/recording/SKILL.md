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
6. **Live transcription.** Alongside the MediaRecorder, `useLiveTranscription` runs the Web Speech API to accumulate transcript text in real time. On stop, the client calls `save-browser-transcript` to persist the result immediately — no API key needed.
7. **Finalize.** On stop, send the final chunk to `/api/uploads/:id/chunk?isFinal=1`. The route calls `finalize-recording`, which stitches chunks, uploads the finished media when storage is configured, transitions `status` to `ready`, then kicks off `request-transcript` for higher-quality output (see `ai-video-tools`).
8. **Navigate.** Once the row is `ready` the UI navigates to `/r/:id`.

## Loom import

Use `import-loom-recording` for Loom share or embed URLs. The action validates
the Loom URL, reads Loom oEmbed metadata from Loom's public endpoint, and creates
a `ready` recording with Loom's embed URL, thumbnail, title, duration, and
dimensions. When Loom exposes a signed public transcript JSON URL on the share
page, the action imports that transcript into Clips and stores normalized
segments; never store Loom's signed CDN URLs.

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

## Pause / resume

`MediaRecorder.pause()` / `.resume()` are supported in all evergreen browsers. Keep a single `MediaRecorder` instance across pauses — don't tear down the stream, or the permission prompt will fire again. While paused, the upload worker keeps draining its buffer so we catch up before the user stops.

## Camera bubble

When mode is `screen+camera`, we composite a circular camera feed in the corner. Render the bubble in a separate `<video>` element and record it into a second `MediaRecorder`; the server side stitches them with ffmpeg.wasm during `processing`. Do **not** try to pre-composite in the browser — that burns GPU and drops frames.

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
- The `recordings` row must exist **before** the first chunk is sent.
- On every lifecycle change, write `navigation` → `{ view: "record" }` → `{ view: "recording", recordingId }` so the agent can see what's happening.
- All AI generated during/after recording goes through the agent chat — see `ai-video-tools`.

## Related skills

- `ai-video-tools` — transcription kicks off when upload completes.
- `video-editing` — after recording, users edit via non-destructive `editsJson`.
- `server-plugins` — why the upload is an `/api/` route, not an action.
- `real-time-sync` — how the UI learns about `status` transitions from `uploading` → `ready`.
