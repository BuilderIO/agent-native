---
name: talk-analytics
description: >-
  Per-speaker stats derived from transcript segments — talk time, talk %,
  longest monologue, interruption count, question count, plus derived
  interactivity and patience metrics. Use when changing participant
  materialization, the talk-time math, or adding new derived metrics.
---

# Talk Analytics

Talk analytics are the "who dominated the call?" view — per-speaker stats computed from the diarized transcript. They drive the Participants panel, the interactivity chip, the "talk-to-listen ratio" insight, and filters like `list-calls --participantEmail=...`.

## When to use

Read this skill before:

- Changing how `call_participants` rows are populated
- Adding a new per-speaker metric
- Tuning the longest-monologue gap heuristic
- Debugging wrong talk percentages after relabeling a speaker

## Data model

`call_participants` — one row per unique speaker label in a call:

- `speaker_label` — `"Speaker 0"` / `"Alice"` / etc.
- `display_name` — user-set override (populated via the Participants UI).
- `email` — optional; used to cross-link with `workspace_members`.
- `is_internal` — flagged via the UI; affects how the summary prompt treats the speaker.
- `avatar_url`, `color` — display.
- `talk_ms` — total milliseconds this speaker was talking.
- `talk_pct` — integer 0–100, percentage of total talk time (across all speakers).
- `longest_monologue_ms` — longest consecutive run this speaker held the floor.
- `interruptions_count` — times this speaker started while another was still active.
- `questions_count` — segments attributed to this speaker ending in `?`.

## The compute path

`computeTalkStats(segments: TranscriptSegment[])` in `server/lib/calls.ts` is the **single source of truth**. Always call this — do not recompute inline.

Output shape:

```ts
{
  participants: Array<{
    speakerLabel: string;
    talkMs: number;
    talkPct: number;
    longestMonologueMs: number;
    interruptionsCount: number;
    questionsCount: number;
  }>;
  totalTalkMs: number;
}
```

### Talk time

For each segment, accumulate `endMs - startMs` under the segment's `speakerLabel`. Simple sum — no overlap correction needed since Deepgram segments are non-overlapping per-speaker within an utterance group.

### Talk percentage

`talkPct = round(100 * talkMs / totalTalkMs)` where `totalTalkMs` is the sum of all participants' `talkMs`. **Not the call duration** — silence and music don't count as talk time. A 30-minute call with 20 minutes of talk where Alice talks for 15 of those → 75%, not 50%.

Sum of percentages may drift by ±1% due to rounding; we accept that rather than allocate fractional percents to a "lost round" participant.

### Longest monologue

A monologue is a consecutive run of the same `speakerLabel` where each gap between adjacent segments is **≤ 1.5 seconds**. If gap > 1.5s, the monologue ends (even if the same speaker resumes after — they "yielded the floor").

```ts
const MAX_MONOLOGUE_GAP_MS = 1500;
for (let i = 0; i < segments.length; i++) {
  const seg = segments[i];
  const prev = segments[i - 1];
  if (
    prev &&
    prev.speakerLabel === seg.speakerLabel &&
    seg.startMs - prev.endMs <= MAX_MONOLOGUE_GAP_MS
  ) {
    currentRunMs += seg.endMs - seg.startMs + (seg.startMs - prev.endMs);
  } else {
    currentRunMs = seg.endMs - seg.startMs;
  }
  longest[seg.speakerLabel] = Math.max(longest[seg.speakerLabel] ?? 0, currentRunMs);
}
```

### Interruptions

An interruption is when speaker B starts a segment **before** speaker A's current segment has ended. We only count B's interruption — not A's segment.

```ts
for (let i = 1; i < segments.length; i++) {
  const cur = segments[i];
  const prev = segments[i - 1];
  if (cur.speakerLabel !== prev.speakerLabel && cur.startMs < prev.endMs) {
    interruptions[cur.speakerLabel] = (interruptions[cur.speakerLabel] ?? 0) + 1;
  }
}
```

Small overlaps (< 200ms) are filtered out — those are usually diarization noise or back-channel "mhm" acknowledgments.

### Questions

A question is a segment whose `text` ends with `?` after trimming. We don't try to detect rhetorical questions — the raw count is directly useful as a signal ("reps who ask fewer than 5 questions per call are telling, not selling"). Multi-sentence segments are counted once if any sentence ends in `?`.

## Derived metrics (UI only — not in the schema)

The UI computes two rollup chips from the raw stats. These are **not persisted** — they're render-time derivations.

### Interactivity

`Low` / `Medium` / `High`. Heuristic:

- High: questionsCount + responses > 20 AND average gap between speaker changes < 30s
- Medium: either condition partially met
- Low: long monologues from one speaker, few questions

A "response density" is how many speaker-change events happen per minute. A call with one speaker holding the floor for 10 minutes straight is Low regardless of question count.

### Patience (rep-side)

Measures how long the rep waits after asking a question before speaking again. Compute:

- For each segment attributed to the internal (rep) speaker ending in `?`:
  - Find the next segment (any speaker).
  - If it's the same speaker, gap = 0 (the rep kept talking).
  - If it's a different speaker, patience = that gap.
- Report the average across all such questions, rendered as "Waits {x}s after questions".

Low patience (< 500ms average) is a coaching signal — the rep talks over their own questions. High patience (> 1.5s) suggests they let prospects think.

## Materialization

`request-transcript` calls `materializeParticipants(db, callId, segments)` after Deepgram returns:

1. `computeTalkStats(segments)` → stats.
2. Load existing `call_participants` for the call.
3. For each speaker label in stats:
   - If a row exists: UPDATE stats fields.
   - Else: INSERT new row with defaults (`displayName: null`, `isInternal: false`, `color` from speaker palette).
4. For each existing row with a label no longer present in stats: DELETE.

This is **non-destructive for user edits** — `displayName`, `email`, `isInternal`, `avatarUrl` are preserved across re-runs.

## Relabeling

When a user renames `"Speaker 0"` to `"Alice"` in the UI, the mutation updates `call_participants.display_name` only. The transcript UI resolves labels at render time by joining segments against participants. This means:

- The transcript's segment.speakerLabel stays as `"Speaker 0"` forever.
- Recomputing stats on a relabeled call is still correct — stats key off speakerLabel.
- Cross-call identity is not maintained — each call's speakers start fresh.

If we want cross-call speaker identification, that's a future feature (voice embedding + workspace-level speaker roster). Not in the current model.

## Rules

- **`computeTalkStats` is the single source of truth.** Never inline-compute these numbers anywhere else.
- **Talk percentage denominator is total talk time, not call duration.** Otherwise silent / music calls produce weird percentages.
- **Interruption threshold is 200ms minimum overlap.** Smaller overlaps are diarization noise.
- **Monologue gap threshold is 1.5 seconds.** Tune this here, not in callers.
- **Materialization is idempotent and preserves user edits** (`displayName`, `email`, `isInternal`).
- **Participant avatars / colors are display only** — never gate access on them.

## Related skills

- `transcription` — `materializeParticipants` runs inside `request-transcript`.
- `call-search` — `list-calls --participantEmail=...` joins through `call_participants.email`.
- `call-summary` — the summary prompt references participant display names and `isInternal` flags.
- `trackers` — tracker hits carry `speaker_label` so you can compute per-speaker hit counts.
