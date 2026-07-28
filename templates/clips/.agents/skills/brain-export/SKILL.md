---
name: brain-export
description: >-
  How `export-to-brain` sends ready Clips transcripts to Brain — single
  exports, bounded historical imports, cursor pagination, required secrets,
  and the retry sweep. Use when exporting transcripts to Brain, backfilling
  past recordings, or debugging a missing or stuck Brain export.
---

# Brain Export

## Rule

Transcripts reach Brain through the `export-to-brain` action and the durable
post-finalize worker — never through an ad hoc fetch to the Brain ingest URL.

## Single export

Use `export-to-brain --recordingId=<id>` for one ready transcript.

## Bounded historical import

For a bounded historical import, omit `recordingId` and pass `lookbackDays`,
`limit`, and `concurrency`. When `nextCursor` is non-null, pass it as `cursor`
on the next call until `nextCursor` is null.

The cursor keeps the original lookback snapshot and advances by recording
creation time plus id, so pages cannot reselect the same recordings or expand
forever as new clips arrive.

The action only selects current-user recordings with ready transcripts in the
active organization, and reports exported, quarantined, skipped, and failed
counts.

## Required secrets

Both `BRAIN_INGEST_URL` and `BRAIN_INGEST_TOKEN` must be available as scoped
Clips secrets. Never hardcode either value — read them through the app secret
surface.

## Durable delivery and the retry sweep

Transcript completion persists a pending export before handing it to the durable
post-finalize worker. Delivery receipts include the Brain capture or sensitivity
receipt id, while transient failures are swept and retried.

The sweep also discovers ready transcripts from the last seven days that predate
export-state tracking, in bounded batches, so recent recordings are backfilled
after the connection is configured.

Netlify builds emit a protected per-minute scheduled sweep because in-process
intervals are not durable there. Other serverless hosts must invoke
`runBrainExportSweepOnce` from their own scheduler.

## Related skills

- `ai-video-tools` — how a transcript becomes ready in the first place.
- `recording` — the finalize path that triggers the post-finalize worker.
- `security` — scoped secret storage for the ingest URL and token.
