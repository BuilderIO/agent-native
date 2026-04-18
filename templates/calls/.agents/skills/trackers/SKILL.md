---
name: trackers
description: >-
  Per-workspace tracker definitions and per-call hits. Two kinds — keyword
  (regex word-boundary, synchronous) and smart (agent-classified). Use when
  adding a new tracker kind, tuning the keyword regex, changing the smart
  tracker delegation, or touching the default tracker seed.
---

# Trackers

Trackers are the "recurring moment detector" — per-workspace definitions that look for a concept across every call and mark the moments it shows up. Each hit carries a quote, a speaker, and a timestamp so the UI can render it as a chip on the transcript line and as a filter in the library.

## When to use

Read this skill before:

- Adding a new tracker kind
- Changing how keyword matches are detected (regex, word boundaries, casing)
- Touching the smart-tracker delegation payload
- Modifying the default trackers seeded on first run
- Debugging "why didn't the tracker fire on this quote?"

## Data model

- **`tracker_definitions`** — per-workspace rows. Fields:
  - `kind: "keyword" | "smart"` — the matcher.
  - `keywords_json` — JSON array of phrases (for keyword kind).
  - `classifier_prompt` — free-text criterion (for smart kind).
  - `enabled` — disabled trackers are skipped by `run-trackers`.
  - `is_default` — seeded defaults carry this so we can refresh them.
- **`tracker_hits`** — per-call match rows:
  - `speaker_label` — may be null if the hit spans multiple speakers.
  - `segment_start_ms` / `segment_end_ms` — the segment the hit lives in.
  - `quote` — verbatim substring from the transcript.
  - `confidence` — 0–100. Keyword hits are 100; smart hits carry the agent's confidence.

## Two kinds

### Keyword trackers

Implementation: `server/lib/trackers/keyword-tracker.ts`. Synchronous; no LLM.

- Each phrase becomes a case-insensitive regex with **word boundaries** (so `"refund"` matches `Refund?` but not `refundable`).
- Multi-word phrases (`"next steps"`) are matched as an ordered regex `\bnext\s+steps\b` with flexible whitespace.
- Hits are recorded per segment — one segment can have multiple hits across phrases, but duplicates on the same segment+tracker are deduped.
- Confidence is always 100 (exact match).

When a user tweaks keywords via `update-tracker`, existing hits are **not** retroactively refreshed — the user must run `run-trackers --callId=<id>` on affected calls (or the library can lazy-rerun on the next view).

### Smart trackers

Implementation: `server/lib/trackers/smart-tracker.ts`. Agent-delegated.

- The tracker carries a `classifier_prompt` — a single-sentence criterion, e.g. `"Is the prospect raising a pricing objection?"`.
- `run-trackers --kind=smart` iterates enabled smart trackers and, for each, writes a delegation payload to `application_state.ai-delegation-<callId>-<uuid>`:
  ```json
  {
    "kind": "smart-tracker",
    "callId": "...",
    "trackerId": "...",
    "trackerName": "Objections",
    "trackerDescription": "...",
    "classifierPrompt": "Is the prospect raising a pricing objection?",
    "segmentsJson": "[...]",
    "message": "Run smart tracker \"Objections\" against call .... For each paragraph that matches, call run-smart-tracker-hit --callId=... --trackerId=... --speakerLabel=... --segmentStartMs=... --segmentEndMs=... --quote=\"<verbatim>\" --confidence=<0-100>. Do not invent quotes — quotes must be verbatim sub-strings of the transcript."
  }
  ```
- The agent reads the segments, finds matching paragraphs, and emits one `run-smart-tracker-hit` per match.
- **Quotes must be verbatim** — `run-smart-tracker-hit` rejects hits whose `quote` is not a substring of the transcript's `fullText`. This is the anti-hallucination guard.
- Confidence is the agent's own estimate (0–100).

## The `run-trackers` flow

```bash
pnpm action run-trackers --callId=<id> [--kind=keyword|smart|all]
```

1. Loads all enabled tracker definitions for the call's workspace.
2. For each tracker matching the requested kind:
   - **Keyword:** delete existing hits on `(callId, trackerId)`, run the regex over segments, insert new hits.
   - **Smart:** write the delegation payload to app-state. Agent picks it up and calls `run-smart-tracker-hit` per match.
3. Bumps `refresh-signal`.

`request-transcript` calls `run-trackers --kind=keyword` at the end of the pipeline so keyword hits appear immediately when the call flips to `analyzing`. Smart hits trickle in as the agent works through the queue.

## Default trackers

On first workspace create, `server/lib/trackers/seed-defaults.ts` inserts these with `isDefault=true`:

| Name           | Kind    | Keywords / Prompt                                                              |
| -------------- | ------- | ------------------------------------------------------------------------------ |
| Pricing        | keyword | `price`, `pricing`, `cost`, `quote`, `dollars`, `budget`                        |
| Competitors    | smart   | "Is the speaker mentioning a competing vendor or alternative solution?"        |
| Objections     | smart   | "Is the prospect raising an objection (price, authority, timing, need, trust)?" |
| Next Steps     | smart   | "Is the speaker proposing or agreeing to a concrete next step or follow-up?"    |
| Budget         | smart   | "Is the conversation touching on budget, ROI, or procurement process?"         |
| Timing         | smart   | "Is the speaker referencing a deadline, go-live date, or urgency?"              |
| Filler words   | keyword | `um`, `uh`, `like`, `you know`, `basically`, `actually`                         |

Users can edit, disable, or delete these via the Trackers page.

## `run-smart-tracker-hit` guards

The agent-only action in `actions/run-smart-tracker-hit.ts` validates:

- `assertAccess("call", callId, "editor")`.
- `tracker_definitions.kind == "smart"` (can't pipe keyword hits through this endpoint).
- `confidence` in `[0, 100]`, `segmentStartMs < segmentEndMs`, both within the call duration.
- `quote` is a verbatim substring of `call_transcripts.full_text` (case-insensitive substring match is allowed; exact case preferred).

Reject with a descriptive error — the agent will retry with a corrected quote.

## UI

Hits render in two places:

- **Transcript line chips** — a colored dot + tracker name at the start of the segment that has hits.
- **POI tab → Trackers** — grouped list of hits with click-to-jump to the quote.

Library filter: `list-calls --trackerId=<id>` filters to calls with at least one hit for that tracker. Pair with `search-calls` for full-text across transcript.

## Rules

- **Keyword regex is always case-insensitive + word-bounded.** Don't ship a tracker that matches mid-word (`"ref"` matching "reference") — the false positives will drown the signal.
- **Smart trackers must carry a `classifier_prompt`.** The shape validator rejects smart trackers without one.
- **Hits must cite verbatim quotes.** Never generate a synthetic quote — the UI renders the quote verbatim, and any drift will look like a hallucination to the user.
- **`run-trackers` is idempotent per `(callId, trackerId)`** — keyword runs DELETE then INSERT; smart runs queue a fresh delegation each time.
- **Always bump `refresh-signal` after writing hits.** The library chip counts and the transcript marks both depend on it.

## Related skills

- `transcription` — `run-trackers --kind=keyword` runs synchronously at the end of the transcription pipeline.
- `delegate-to-agent` — smart trackers are the canonical delegation example.
- `call-search` — tracker filters combine with full-text search in the library.
- `storing-data` — why `keywords_json` and `tracker_hits` are separate tables.
