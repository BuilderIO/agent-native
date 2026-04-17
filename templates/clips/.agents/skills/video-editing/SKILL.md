---
name: video-editing
description: >-
  Non-destructive video editing in Clips — the editsJson model, trim / split /
  cut / speed / blur, transcript-based editing, and ffmpeg.wasm export. Use
  when building the editor UI, adding a new edit operation, or wiring the
  export pipeline.
---

# Video Editing

## When to use

Reach for this skill any time you modify how recordings are edited: new edit operations, the timeline UI, transcript-driven cuts ("remove the ums"), the preview overlay, or the export flow. Editing **must** be non-destructive — the recording blob is immutable after upload.

## Data model touched

- **`recordings.edits_json`** — a JSON column with the edit document. Shape:

  ```json
  {
    "trims": [{ "startMs": 0, "endMs": 3200, "excluded": true }],
    "cuts":  [{ "startMs": 12000, "endMs": 13500 }],
    "speed": [{ "startMs": 0, "endMs": 60000, "rate": 1.5 }],
    "blurs": [{ "startMs": 0, "endMs": 90000, "box": { "x": 10, "y": 10, "w": 200, "h": 80 } }]
  }
  ```

- **`recordings.chapters_json`** — JSON array of `{ startMs, title }`.
- **`application_state.editor-draft`** — in-progress edits the user is previewing but hasn't saved. Writing to `edits_json` only happens when the user hits Save.

## Rules

1. **Non-destructive.** Never re-encode on edit. The original webm/mp4 stays intact at `recordings.video_url`. Edits only change the JSON.
2. **Single source of truth.** The player renders edits at playback time — read `edits_json`, compute the virtual timeline, and skip excluded ranges via `HTMLVideoElement.currentTime` seeks. Do not fork the edit model for the editor vs the player.
3. **Export is explicit.** The user must click Export to render a new file. That call goes through `export-video` and kicks off ffmpeg.wasm (or server-side ffmpeg if the recording is long).
4. **Append, don't rewrite.** Prefer pushing a new entry into `edits_json` over editing an existing one, so undo/redo can reverse a single edit without ambiguity.

## Operations

| Operation | `apply-edit` args                                           | What it does                                                |
| --------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| Trim      | `--type=trim --startMs=0 --endMs=30000`                     | Exclude the first 30 seconds from playback                  |
| Cut       | `--type=cut --startMs=12000 --endMs=13500`                  | Remove a middle range — the timeline collapses               |
| Split     | `--type=split --atMs=<ms>`                                  | Put a cut marker at the playhead (no range removed)         |
| Speed     | `--type=speed --startMs --endMs --speed=1.5`                | Speed a range up (or down — `0.5` works too)                |
| Blur      | `--type=blur --startMs --endMs --x --y --w --h`             | Apply a blur rectangle to a time range                      |

All of these append to `edits_json`. The action validates non-overlapping ranges per type (except `speed`, which compounds) and throws on bad input.

## Transcript-based editing

Users love editing by text — click a filler word in the transcript, remove it. The editor uses `recording_transcripts.segments_json` to map words to `{ startMs, endMs }` ranges; clicking a segment creates a `cut` edit for that range.

"Remove the filler words" is **not** solved inline — it delegates to the agent. See the `ai-video-tools` skill. The agent analyzes the transcript, proposes a list of cuts, writes them to `editor-draft` for review, and the user one-click approves.

## Export

```ts
// actions/export-video.ts
export default defineAction({
  schema: z.object({ id: z.string(), format: z.enum(["mp4", "webm"]).default("mp4") }),
  run: async ({ id, format }) => {
    await assertAccess("recording", id, "editor");
    const rec = await getRecordingOrThrow(id);
    const edits = JSON.parse(rec.editsJson || "{}");
    // Short clips (< 2 min) render client-side via ffmpeg.wasm.
    // Longer ones are queued for server-side ffmpeg.
    return { exportId: enqueueExport({ recordingId: id, edits, format }) };
  },
});
```

For **short recordings**, load ffmpeg.wasm in a web worker, feed it the source blob + the edit list, and return the rendered file. For **long recordings**, enqueue a background job and have the UI poll `export-status` every 2s.

## Player integration

The player is the canonical renderer for edits. Given `edits_json`, compute a `VirtualTimeline`:

```ts
interface VirtualTimeline {
  // Maps virtual ms -> source ms, skipping cuts/trims.
  toSource(virtualMs: number): number;
  // Total virtual duration after edits applied.
  durationMs: number;
  // Ranges to skip on playback: the player listens for timeupdate and seeks past them.
  excludedRanges: { startMs: number; endMs: number }[];
}
```

Never call `video.currentTime` with a raw segment index — always go through `toSource`.

## Rules

- The edit UI writes to `editor-draft` on every change, and only writes to `edits_json` on Save (so Cmd+Z is cheap and the DB stays clean).
- Never mutate `edits_json` from `db-exec`. Use `apply-edit` or `reset-edits`.
- Speed edits compound (`1.5 × 2 = 3x`) — validate the result is in `[0.25, 4]`.
- Blur coordinates are in **source resolution**, not display pixels. Always normalize against `recordings.width` / `recordings.height`.

## Related skills

- `ai-video-tools` — filler-word removal and chapter generation propose edits via the agent.
- `real-time-sync` — when the agent writes `edits_json`, the player must reflect it; `edits_json` is part of the `recordings` row which is already on the sync list.
- `video-sharing` — exports honor the share's `enableDownloads` flag.
- `storing-data` — why edits live in a JSON column rather than a separate table.

---

## Editor implementation reference

### Concrete `editsJson` shape (editor team)

The editor writes and reads this exact shape. Any new edit operation MUST
preserve this shape so the player, editor, and export pipeline stay in sync.

```ts
interface EditsJson {
  version: 1;
  // Ripple-style trim ranges. `excluded:true` ranges are skipped during
  // playback and collapsed during export. `excluded:false` entries where
  // `startMs === endMs` are SPLIT MARKERS used by the editor UI — they
  // never affect playback.
  trims: Array<{ startMs: number; endMs: number; excluded: boolean }>;
  blurs: Array<{
    id: string;
    startMs: number;
    endMs: number;
    x: number; y: number; w: number; h: number; // normalized 0..1
    intensity: number;
  }>;
  thumbnail?:
    | { kind: "url"; value: string /* absolute URL */ }
    | { kind: "frame"; value: string /* timeMs as string */ }
    | { kind: "gif"; value: string /* JSON: { url, startMs, durationMs } */ }
    | null;
  // Provenance for stitched recordings — set by `stitch-recordings`.
  stitchedFrom?: string[];
}
```

Comment `videoTimestampMs`, reaction `videoTimestampMs`, and
`recording_transcripts.segmentsJson` timestamps all refer to **original**
video time. The player converts to edited time; never assume the two are
equal.

### Timestamp helpers

`app/lib/timestamp-mapping.ts` is the single source of truth:

| Helper                                 | Returns                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------- |
| `parseEdits(raw)`                      | A fully-populated `EditsJson` from the DB column (empty on bad input)   |
| `serializeEdits(edits)`                | Stringified JSON ready to write back                                    |
| `getExcludedRanges(edits)`             | Sorted, non-overlapping excluded ranges                                 |
| `getKeptRanges(durationMs, edits)`     | Ordered "kept" ranges in original time — the export pipeline iterates   |
| `originalToEdited(ms, edits)`          | Maps original → edited (playback) timeline                              |
| `editedToOriginal(ms, edits)`          | Maps edited → original (used when seeking the underlying `<video>`)     |
| `effectiveDuration(durationMs, edits)` | Edited duration after excluded ranges are removed                       |
| `isExcluded(ms, edits)`                | True if an original ms falls inside an excluded range                   |
| `mergeExcluded(edits, startMs, endMs)` | Append an excluded range; merges overlapping/adjacent entries           |
| `popLastExcluded(edits)`               | Remove the most-recently-added excluded range (used by `undo-edit`)     |
| `appendSplit(edits, atMs)`             | Append a zero-width split marker                                        |
| `formatMs(ms)`                         | `0:42`, `1:23:04` formatting for timestamps                             |

The player team may have its own copy of some of these. If so, consolidate on
`app/lib/timestamp-mapping.ts` — never let the two drift.

### Editor actions

| Action               | Writes                                   | Purpose                                           |
| -------------------- | ---------------------------------------- | ------------------------------------------------- |
| `trim-recording`     | `editsJson.trims` (merged excluded)      | Append an excluded range, merged with neighbours  |
| `split-recording`    | `editsJson.trims` (split marker)         | UI-only marker at a given ms                      |
| `set-thumbnail`      | `thumbnailUrl` / `animatedThumbnailUrl` / `editsJson.thumbnail` | Three modes: upload / frame / gif |
| `set-chapters`       | `chaptersJson`                           | Overwrites the chapter array                      |
| `stitch-recordings`  | new `recordings` row                     | Client-side ffmpeg concat + upload + insert       |
| `undo-edit`          | `editsJson.trims`                        | Pop the last excluded range (no redo)             |
| `clear-edits`        | `editsJson`                              | Reset to defaults (chapters/thumbnailUrl kept)    |

Every mutation ends with `writeAppState("refresh-signal", { ts: Date.now() })`.

### ffmpeg.wasm usage

`app/lib/ffmpeg-export.ts` lazy-loads `@ffmpeg/ffmpeg` (only fetched on first
Export click; core wasm is ~30MB). Three entry points:

```ts
exportMp4(recording, edits, onProgress)  // kept-range concat → H.264+AAC MP4
exportGif(recording, startMs, durationMs, onProgress)  // animated thumbnail
exportConcat(sources, onProgress)  // stitching N recordings into one MP4
```

**Assumed limits (tested in practice — update if you hit new ceilings):**

- Single-threaded WASM, ~2GB memory ceiling per tab.
- Roughly 10 minutes of 1080p WebM→MP4 is the practical upper bound before
  tabs run out of memory. The editor surfaces a confirm dialog when
  `effectiveDuration(...) > LONG_EXPORT_THRESHOLD_MS` (10 min) and offers
  "Download original" as an escape hatch.
- Both the trim/concat paths and the `exportConcat` (for stitching) re-encode
  to H.264+AAC so the output plays everywhere.

### Stitching

Decision: **client-side ffmpeg concat** rather than a virtual playlist that
plays N sources sequentially. Rationale:

- A real combined MP4 plays in share links, embeds, iframes, and any mobile
  browser without special-case player logic.
- The virtual-playlist approach couples the player to the stitched structure
  and breaks sharing / thumbnails / comments (which are keyed off
  `recording_id`).

Flow from the UI:

1. `stitch-manager.tsx` collects the ordered list of source recordings.
2. `exportConcat()` fetches each `videoUrl` and concatenates with ffmpeg.wasm.
3. We upload the resulting blob via `uploadFile()` (or fall back to a data
   URL when no provider is configured — dev mode).
4. We call `stitch-recordings` with the uploaded URL + total duration; the
   action inserts a new `recordings` row with `status: "ready"` and
   `editsJson.stitchedFrom` set to the source IDs for provenance.

### Waveform peak caching

`computePeaks()` decodes the video's audio track via the Web Audio API and
downsamples to a 2000-point peaks array. Peaks are cached in
`application_state` under `waveform-<recordingId>` so remounts don't
recompute. The editor reads the cache first and falls back to computing only
when the key is missing or corrupted.

### Keyboard shortcuts (editor scope)

- **Space** — play / pause (even while focused in the editor area)
- **Cmd/Ctrl+Z** — undo the last trim (no redo stack)
- **I / O** — mark in / out of the current trim selection
- **S** — split at playhead (via `split-button.tsx`)
- **Delete / Backspace** — while the transcript editor has a selection: trim
  the selected text's timestamp range

### File map

```
actions/
  trim-recording.ts   split-recording.ts   set-thumbnail.ts
  set-chapters.ts     stitch-recordings.ts
  undo-edit.ts        clear-edits.ts
app/lib/
  timestamp-mapping.ts   waveform-peaks.ts   ffmpeg-export.ts
app/components/editor/
  editor-layout.tsx       editor-toolbar.tsx
  waveform.tsx            trim-handles.tsx      timeline.tsx
  transcript-editor.tsx   chapters-editor.tsx
  thumbnail-picker.tsx    stitch-manager.tsx    split-button.tsx
```

When the recording route enters edit mode, render `<EditorLayout recordingId={id} />` — it wires the toolbar, video preview, transcript editor, waveform, trim handles, timeline, and chapters sidebar. The dialogs for thumbnail picking and stitching are mounted inside the layout and toggled by the toolbar.

