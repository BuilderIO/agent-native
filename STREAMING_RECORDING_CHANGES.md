# Streaming Recording Pipeline — What This Branch Does

Branch: `shomix-p-custom-capture` · ~4,200 lines across 10 files · Clips desktop + web player

## The one-sentence version

Recordings now **upload while they're being recorded**, so pressing Stop no
longer means waiting for a multi-hundred-MB upload — and the web player learned
to play the resulting files instantly.

## The problem this solves

Before this branch, the desktop recorder wrote the whole video to disk and only
started uploading after the user pressed Stop. A 20-minute recording meant a
long "Uploading…" wait at exactly the moment the user wants to paste a share
link. This branch streams the recording to the server *during* capture, so at
Stop only the last few seconds remain to send.

That one goal forced three interlocking pieces, described below in the order
the data flows.

---

## Piece 1: Custom capture engine (desktop, Rust)

`templates/clips/desktop/src-tauri/src/native_screen/custom_capture.rs`

Apple's stock recorder (`SCRecordingOutput`) is a black box: it owns the file
and the file is unreadable until recording ends. To upload during recording we
must control how the file is written, so this branch adds a custom pipeline:

```
ScreenCaptureKit ──screen frames──▶ ┌──────────────────────┐
                 ──system audio──▶  │ CustomScreenCapture-  │ ──1s segments──▶ local .mp4
                 ──mic audio─────▶  │ Writer (AVAssetWriter)│                  (append-only)
                                    └──────────▲───────────┘
                                          LiveAudioMixer
```

Key design points, each earned through a real failure during testing:

- **Fragmented MP4 via the segment-delegate API.** The writer has *no output
  file*. Apple hands us each ~1-second segment as bytes
  (`AVAssetWriterDelegate`), and *our* code appends them to the local file.
  Result: bytes, once written, **never change** — the property the live upload
  depends on. (The earlier `movieFragmentInterval` approach failed subtly:
  Apple silently rewrites the whole file at Stop, which corrupted everything
  already uploaded. See "war stories" below.)
- **Live audio mixing.** Mic + system audio arrive as separate streams with
  independent clocks and warm-up delays. `LiveAudioMixer` places both on a
  shared 48kHz timeline (zero-filling gaps, tolerating a source that stalls or
  never starts) and emits one premixed track — so no post-recording ffmpeg mix
  is needed.
- **Zero-based timestamps.** ScreenCaptureKit stamps frames with "seconds
  since boot". Every sample is re-timed onto a session timeline starting at 0
  (otherwise players show wall-clock times like `16:58:38`).
- **Pinned SDR pixel format (NV12).** Without pinning, macOS switches to HDR
  pixel formats when an HDR app is frontmost, and the H.264 encoder rejects
  every frame from then on.
- **Idle frames are kept.** On a static screen (e.g. after switching virtual
  desktops) SCK sends "idle" frames; dropping them starves the video track and
  freezes the whole file. Any frame carrying an image buffer is appended.
- **B-frames disabled + capture-time bitrate.** Frame reordering intermittently
  kills fragmented writers; disabling it fixed recordings dying at exact
  1-second boundaries. An explicit bitrate budget (~0.15 bits/pixel/frame)
  keeps files small enough to skip the upload-time transcode.
- **Capture watchdog.** ScreenCaptureKit sometimes stops delivering frames
  (Space switches, display sleep) — sometimes with a callback, sometimes
  silently. A watchdog thread notices (no buffers for 4s, or an OS "stream
  stopped" report) and rebuilds the SCStream in place; the writer and file
  survive. A user clicking macOS's own "Stop Sharing" is recognized
  (`UserStopped` error code) and triggers the normal stop flow instead of a
  fight.
- **Crash safety for free.** Because the file is a chain of self-contained
  fragments, it is playable up to the last written second even if the app
  dies mid-recording.

Safety net around all of it: every AVFoundation call that can throw an
Objective-C exception is contained (`objc2::exception::catch`) — otherwise a
single bad sample aborts the entire process — and append failures record a
detailed NSError (domain/code/underlying OSStatus) instead of a generic
message. Those error codes are how most of the bugs above were found.

The stock pipeline is untouched and selectable via
`USE_CUSTOM_SCREENCAPTUREKIT_PIPELINE` (a const, our rollback lever).

## Piece 2: Live upload (desktop, Rust)

`templates/clips/desktop/src-tauri/src/native_screen/live_upload.rs`

A background task tails the growing file and streams it to the server:

```
local .mp4 (growing) ──every 250ms──▶ whole 3.75MB chunks ──POST──▶ server
                                                                    (assembles by index)
press Stop ──▶ writer finalizes ──▶ drain tail + final post ──▶ done in ~1s
```

- Chunks are only sent when **complete** (3.75MB = a multiple of 256KiB —
  Google Cloud Storage's resumable-upload alignment rule; unaligned chunks get
  silently truncated by GCS, which corrupted early uploads).
- The **last** tail chunk doubles as the final post (GCS allows any size only
  on the final chunk).
- Every POST retries with exponential backoff; a cancelled upload stops
  between attempts.
- **Pause abandons the live upload** (pausing makes the recording
  multi-segment, which breaks the single-append-only-file assumption). The
  stop path then clears the server's partial chunks and uploads the
  consolidated file whole — correctness first, speed only when safe.
- The local file is **kept after successful upload** (only its retry metadata
  is deleted) so failures are always recoverable and debuggable.

## Piece 3: MSE playback (web player, TypeScript)

`app/lib/mse-video-loader.ts`, `app/lib/fmp4.ts`, `app/hooks/use-mse-video-source.ts`,
wired into `app/components/player/video-player.tsx`

The streamed files have one unavoidable quirk: **they cannot state their own
duration up front** (the file's header is written — and uploaded — at second
zero of the recording, when the duration doesn't exist yet; no container
format escapes this). A plain `<video src>` player reacts by downloading the
*entire file* looking for the duration before showing anything — from a CDN
that's an endless spinner.

Fix: for these files only, the player uses **Media Source Extensions** — our
JavaScript fetches the bytes and feeds the decoder, instead of the browser
guessing:

- Duration comes from the **database** (`durationMs`, always stored) — set
  programmatically, no scanning, first frame after a few hundred KB.
- The asset is sniffed (first KB: fragmented brand/`mvex` box?) — classic MP4s,
  WebM, and Loom embeds keep the native path byte-for-byte unchanged.
- Seeks estimate a byte offset and re-align to a fragment boundary; watched
  ranges are evicted to bound memory; any failure falls back to the plain
  `<video src>` path (i.e. worst case = old behavior).
- Cross-origin note: JS range fetches require a CORS preflight the CDN
  rejects, so MSE reads go through the app's existing same-origin
  `/api/video/:id` proxy (the same route the editor's waveforms use). The
  native `<video>` path keeps the direct CDN URL.

This player is also what the Chrome extension shows inside GitHub PR previews
(it renders `/embed/:id`), so GitHub playback inherits the fix automatically.

## War stories (why the code looks the way it does)

Each of these was a reproduced-in-testing failure; the fixes above map 1:1:

| Symptom | Root cause |
| --- | --- |
| Recording died at exactly 2.000s / 4.000s | H.264 B-frames vs fragment boundaries (OSStatus -16341) |
| Recording died when an HDR app came frontmost | SCK switched to EDR pixel formats (-16122) |
| File froze after switching virtual desktops | Idle frames dropped → video track starved → fragments stalled |
| Uploaded clip truncated at 29s of 193s | `finishWriting` defragmented the file in place, invalidating streamed chunks → segment-delegate rewrite |
| Uploaded clip corrupt at chunk boundaries | GCS 256KiB alignment rule for non-final chunks |
| Player showed `16:58:38 / 16:59:21` | Host-clock PTS leaking into the media timeline |
| Frozen first frame, then black | Video re-timing lost in a merge; audio was rebased, video wasn't |
| CDN clip spins forever in the browser | No up-front duration → full-file scan → MSE player |

## What's deliberately NOT here yet

- **Third-party players (Slack unfurl, raw-URL consumers).** MSE only helps
  players we control. The plan: after Stop, the desktop remuxes the file to a
  classic faststart MP4 (`ffmpeg -c copy -movflags +faststart`, ~0.3s for
  90MB, no re-encode) and re-uploads it in the background; Slack unfurls gate
  on that "promoted" asset. Designed, not yet implemented.
- **Feature flags are consts** (`USE_CUSTOM_SCREENCAPTUREKIT_PIPELINE`,
  `UPLOAD_CHUNKS_WHILE_RECORDING`) — deliberate while testing; a real flag
  system can come at graduation.
- Diagnostic logging is verbose (`[mixer]`, `[live-upload]` namespaces) —
  intentional while the pipeline is being proven; trim before wide release.

## File map

| File | Role |
| --- | --- |
| `templates/clips/desktop/src-tauri/src/native_screen.rs` | Session orchestration: start/stop/pause, segments, upload fallbacks (pre-existing, extended) |
| `…/native_screen/custom_capture.rs` | The capture engine: writer, mixer, watchdog, AVFoundation FFI (new) |
| `…/native_screen/live_upload.rs` | Chunk streaming + retries (new) |
| `templates/clips/desktop/src/lib/recorder.ts` | Threads server credentials into the native recorder (6 lines) |
| `templates/clips/app/lib/fmp4.ts` (+ tests) | fMP4 sniffing + init-segment/codec parsing (new) |
| `templates/clips/app/lib/mse-video-loader.ts` | The MSE engine: range fetches, appends, seek, eviction (new) |
| `templates/clips/app/hooks/use-mse-video-source.ts` | React lifecycle for the loader (new) |
| `templates/clips/app/components/player/video-player.tsx` | Chooses MSE vs native per asset; same-origin proxy for MSE reads |
