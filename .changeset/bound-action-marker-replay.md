---
"@agent-native/core": patch
---

Stop cold-started processes from replaying the entire durable action-marker
history. `seedVersionFromDb` rewound the marker watermark to `0` so a marker
written just before boot still reached the first poll, but the replay filter is
`updated_at > watermark` and the `__action_change__` table is one never-pruned
row per identity that has ever run a mutating action — so every boot re-emitted
all of it. On one production app that was 2,188 rows replayed ~32 times a
minute: 1,169 sync events/sec against ~1.7/sec of real traffic, and a 47 GB
`sync_events` table. The rewind is now bounded to a 60-second replay window,
which preserves its purpose, and the marker read is bounded by the same
watermark instead of selecting the whole table.

Also enables `deterministicEventIds` for the default sync state so concurrent
processes detecting the same external write collapse via `ON CONFLICT (id) DO
NOTHING`, and keys the action-marker dedupe on each row's own `updated_at`
rather than the table-wide maximum. That mechanism defaulted off and was never
set anywhere, so every `dedupeKey` in the poll path had been inert.

`manage-agent-engine` now classifies `test` and `get-app-default` as reads
alongside `list`, so those calls no longer announce a change.
