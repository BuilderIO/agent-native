---
name: transcription
description: >-
  The Deepgram transcription pipeline — Nova-3 with diarization, segment and
  participant materialization, webhook handling, and retry flow. Use when
  changing transcription provider settings, the segment shape, the webhook
  handler, or the participant-stats derivation.
---

# Transcription

## Rule

Transcription is the **one AI operation that does not go through the agent chat**. Deepgram takes media bytes and returns text — it's a data pipeline, not reasoning. Every other AI feature (summary, topics, smart trackers, snippet suggestions) is delegated to the agent chat via `application_state`.

`OPENAI_API_KEY` is **not** used here — Whisper lives in the `clips` template. Calls uses **Deepgram Nova-3** because Deepgram gives us word-level timing, language detection, and — critically — **speaker diarization** that Whisper lacks. Diarization is the foundation for per-speaker talk stats, interruption counts, and the "who said this?" transcript UI.

## When to use

Read this skill before:

- Changing Deepgram model, language, or diarization parameters
- Modifying the `call_transcripts.segments_json` shape
- Wiring the async webhook path (`/api/webhooks/deepgram`)
- Debugging a stuck `transcribing` or `analyzing` status
- Touching the participant materialization logic

## Data model touched

- **`call_transcripts.segments_json`** — JSON array of `TranscriptSegment` (shape below).
- **`call_transcripts.full_text`** — concatenated text for FTS search. Lowercased is fine; normalization happens in the search tokenizer, not here.
- **`call_transcripts.language`** — Deepgram-detected language.
- **`call_transcripts.provider`** — `"deepgram"` (or `"assemblyai"` / `"whisper"` if we ever swap).
- **`call_transcripts.status`** — `pending` / `ready` / `failed`.
- **`call_participants`** — one row per unique `speakerLabel`. Populated from the segment stats (see `talk-analytics`).
- **`calls.status`** — advances from `transcribing` → `analyzing` on success, or → `failed` on error.

## Segment shape

Defined in `shared/api.ts`:

```ts
interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
  speakerLabel: string;        // "Speaker 0", "Speaker 1", etc. — or a relabeled name.
  confidence?: number;         // 0..1 from Deepgram
  words?: Array<{
    startMs: number;
    endMs: number;
    text: string;
    confidence?: number;
  }>;
}
```

Segments are **ordered** by `startMs`. Word-level timing is preserved so the editor can highlight active words and the snippet tool can snap I/O marks to word boundaries.

## Hybrid browser transcription

The browser's Web Speech API runs during in-browser recording via `useLiveTranscription`. When the user stops, the client calls `save-browser-transcript --callId=<id> --fullText="..."` to persist an instant transcript with no API key. If `request-transcript` later runs with a Deepgram key, it refines the browser draft with higher-quality diarized output. If no key is configured, the browser transcript is preserved as the final result.

## Flow (synchronous path)

`request-transcript` is the entry point. Flow:

1. `assertAccess("call", callId, "editor")` — gate writes.
2. Upsert `call_transcripts` with `status="pending"`, clear any prior `failureReason`.
3. Set `calls.status = "transcribing"`, bump `refresh-signal`.
4. Resolve `DEEPGRAM_API_KEY` — prefer per-user secret (framework `readAppSecret` with `scope: "user"`), fall back to credentials / env.
5. Resolve media bytes:
   - Local app-state stash (`/api/call-media/<id>` URLs): read the base64 from `call-blob-<id>`.
   - Relative URL (`/...`): fetch from `NITRO_PUBLIC_URL` + path.
   - Absolute URL: pass as `mediaUrl` — Deepgram fetches directly.
6. Call Deepgram's `pre-recorded` endpoint with `model=nova-3`, `diarize=true`, `utterances=true`, `punctuate=true`, `smart_format=true`. Language is auto-detected.
7. `labelSpeakers` normalizes Deepgram's `speaker` integers into `"Speaker 0"` / `"Speaker 1"` / etc. labels. If the workspace has prior relabels for the same speaker identity, reuse them.
8. `computeTalkStats(segments)` produces per-participant talk stats (see `talk-analytics`).
9. Upsert `call_transcripts` with `status="ready"`, `segmentsJson`, `fullText`, `language`, `provider="deepgram"`.
10. Materialize `call_participants` — insert new rows for new speaker labels, update stats on existing rows, delete rows for labels that no longer appear.
11. Set `calls.status = "analyzing"`.
12. Queue the agent pipeline tasks into `application_state.call-ai-queue-<callId>`: `summary`, `topics`, `trackers`, `suggest-snippets`. The agent chat picks these up.
13. Run keyword trackers synchronously (`run-trackers --kind=keyword`) — no LLM needed.
14. Bump `refresh-signal`.

The agent's `analyzing` work — `write-call-summary`, `write-call-topics`, `run-smart-tracker-hit` writes — ultimately flips the call to `ready` once all queue entries are done. (The framework considers the call ready as soon as `call_transcripts.status == "ready"`; the UI surfaces a progress shimmer for the remaining AI tasks.)

## Async path (webhook)

For long calls or when running Deepgram with `callback=<url>`, the flow is split:

1. `request-transcript` submits the job with `callback=<NITRO_PUBLIC_URL>/api/webhooks/deepgram` and exits immediately with `status="transcribing"`.
2. Deepgram POSTs the result to `/api/webhooks/deepgram` with the call id in the `request_id` field.
3. The webhook handler writes the transcript, materializes participants, and continues the pipeline (steps 8–14 above).

Current wiring in `server/routes/api/webhooks/deepgram.post.ts` handles this path. Synchronous-by-default is simpler and what `request-transcript` uses today; webhook is there for long calls.

## Retry

```bash
pnpm action retry-transcript --callId=<id>
```

Resets `call_transcripts.status` to `pending`, clears `failureReason`, sets `calls.status = "transcribing"`, and re-runs `request-transcript`. Idempotent — safe to call on any call.

## Languages

Deepgram Nova-3 auto-detects across English, Spanish, French, German, Dutch, Portuguese, Italian, Polish, Japanese, and others. `call_transcripts.language` stores the BCP-47 code (`en`, `es-419`, etc.). The AI summary prompt is language-aware — see the `call-summary` skill.

## Speaker labeling

Deepgram emits an integer `speaker` per utterance. `labelSpeakers` maps those to stable labels:

- First unique speaker the agent sees in the call → `"Speaker 0"`, next → `"Speaker 1"`, etc.
- If the user has previously relabeled `"Speaker 0"` to `"Alice"` for this call, we preserve the relabel by looking up `call_participants` before regenerating.
- Across calls, labels are **not** re-identified by voice — each call restarts at `Speaker 0`. Cross-call speaker identification is not implemented.

Users relabel via the Participants panel; the update lands in `call_participants.display_name` and the transcript UI resolves labels through that table.

## Retry and failure modes

| Failure                              | Handling                                                                                                                           |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `DEEPGRAM_API_KEY` missing           | If a browser transcript exists, preserve it and return early. Otherwise fail with `failureReason: "DEEPGRAM_API_KEY not configured"`. |
| Media URL unreachable                | Transcript failed with the fetch error. Usually means `NITRO_PUBLIC_URL` misconfigured.           |
| Deepgram 4xx (invalid audio)         | Transcript failed with Deepgram's reason. Suggest re-upload.                                      |
| Deepgram 5xx / timeout               | Transcript failed. User can `retry-transcript`.                                                   |
| Webhook delivered twice (duplicate)  | Upsert is idempotent; the second write is a no-op.                                                |

Always set `calls.failureReason` and `call_transcripts.failureReason` to a human-readable string — the UI surfaces both.

## Rules

- **Transcription is the ONLY AI feature that bypasses the agent.** Summary, topics, smart trackers, snippet suggestions all delegate to the agent chat. See `delegate-to-agent`.
- **Never store raw Deepgram response JSON in `call_transcripts`.** Normalize into the `TranscriptSegment` shape first. The agent and UI should never have to know Deepgram's field names.
- **`full_text` is lowercased by convention** — normalization lives in the search tokenizer. Don't mix casing between writers and readers.
- **Participants are derived, not authored** — `computeTalkStats` is the single source of truth. Never update talk stats directly from other actions.
- **Segment `startMs` / `endMs` are in the CALL's timeline** — snippet bounds are in the CALL's timeline too (not the snippet's own). The snippet player offsets at render time.

## Related skills

- `call-capture` — `request-transcript` is triggered from `finalize-call`.
- `call-summary` — consumes the transcript, generates the summary JSON.
- `trackers` — keyword trackers run synchronously after transcription; smart trackers delegate to the agent.
- `talk-analytics` — participant materialization happens inside `request-transcript`.
- `call-search` — `full_text` is the search index.
