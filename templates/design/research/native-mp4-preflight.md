# Native shader MP4 export preflight

Read-only investigation on 2026-10-06. No frame capture, GPU readback, encoder, muxer, dependency, or MP4 export was added or run. The local pixel-export authorization and browser proof are still pending.

## Existing workspace code

- Design has `export-html`, `export-png`, and `export-svg` actions but no MP4 action or `VideoEncoder`/`VideoFrame`/muxer implementation. Its existing media-upload path accepts MP4 files; that is not a frame-to-MP4 export path. Search: `rg -n -i 'VideoEncoder|VideoFrame|mp4-muxer|webm-muxer|mp4box|mediabunny|MediaRecorder|export-mp4' templates/design packages/core` returned no Design encoder/muxer implementation.
- Clips owns `@ffmpeg/ffmpeg@0.12.15`, `@ffmpeg/util@0.12.2`, and `ffmpeg-static@5.3.0` in `pnpm-lock.yaml` under the `templates/clips` importer. Its browser `app/lib/ffmpeg-export.ts` loads ffmpeg.wasm core from unpkg, reads a pre-existing recording URL, and invokes `libx264`/AAC for MP4. This is a recording transcode path with a remote core URL, not a local, frame-driven, standalone Design shader export. `app/lib/fmp4.ts` parses MP4 segments for playback; it does not mux frames. Reusing either would need new architecture and deployment review.

## Current muxer candidate, not installed

`npm view mediabunny version license repository.url homepage dist.unpackedSize --json` on 2026-10-06 reported `1.61.3`, `MPL-2.0`, `git+https://github.com/Vanilagy/mediabunny.git`, `https://mediabunny.dev/`, and unpacked package size `10867673` bytes. [The tagged package manifest](https://github.com/Vanilagy/mediabunny/blob/v1.61.3/package.json) and [tagged license](https://github.com/Vanilagy/mediabunny/blob/v1.61.3/LICENSE) confirm version and MPL-2.0 licensing. This is a license review input, not approval to add it; distribution would need to preserve its required notices and any modification obligations.

The [official writing guide](https://mediabunny.dev/guide/writing-media-files) documents `Output` + `Mp4OutputFormat` with an in-memory or streaming target, a canvas-backed AVC track, explicit start/finalize, and timestamped frames. The [CanvasSource API](https://mediabunny.dev/api/CanvasSource) says `add(timestamp, duration)` returns a promise that should be awaited for backpressure. The [official codec guide](https://mediabunny.dev/guide/supported-formats-and-codecs) says AVC encodability varies by browser and supplies `canEncodeVideo` for exact width, height, frame rate, and quality. A future implementation should fail explicitly when that check fails; container support alone does not prove an H.264 encoder is available.

`npm view mp4-muxer version deprecated license repository.url --json` reported `5.2.2`, MIT, and an explicit deprecation in favor of Mediabunny. [Its maintainer's README](https://github.com/Vanilagy/mp4-muxer) says it is unmaintained and receives no bug fixes. Its permissive license does not make it the stronger technical choice.

## Boundary to validate after pixel-export authorization

The unresolved work starts before muxing: establish a permitted, deterministic source frame from the native WebGPU/DOM composition at a fixed timeline time and size, without losing editable text, images, groups, glass backdrop, or authored source ordering. Only then compare `CanvasSource` versus a direct `VideoSampleSource` handoff, measure readback/copy/encode cost and memory at target duration/resolution, and verify playback on target browsers. A streaming target would limit whole-file memory, but it does not remove the frame-capture cost. This note does not claim GPU-to-encoder zero-copy or an MP4 visual result.
