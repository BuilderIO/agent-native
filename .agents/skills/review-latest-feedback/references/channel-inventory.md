# Channel parent inventory

Use this procedure before investigating, claiming, or using a CI rollup in
place of Slack source messages.

- Read each scoped channel newest-first, following `next_cursor` until the
  five-day boundary, the inclusive permalink cutoff, or Slack exhaustion.
- For “this permalink and newer,” use the parent message's `ts` as the inclusive
  `cutoffTs` and `permalinkTs`. Slack's `oldest` parameter is exclusive, so
  query from at least one second earlier and filter locally by `ts >= cutoff`.
- Record every top-level parent returned in every fetched page before filtering
  or triage. This includes duplicates, owned items, bots, and boundary overlap.
  Reactions and ownership determine what to investigate, not what to inventory.
- Save `.tmp/feedback-inventory.json` with `cutoffTs`, optional `permalinkTs`,
  and `channels`. Set `permalinkTs` when a supplied message anchors the scan. A channel
  has `channelId`, `oldestQuery`, and `pages`. A page has its requested `cursor`,
  returned `nextCursor`, `exhausted`, the full Slack `parentCount`, the complete
  `sourceTimestamps` list copied from that response, and `parents`. Each parent
  records `ts`, `reactionChecked: true`, `reactionSummary` (`none` if empty),
  and `disposition`.
- Keep the source manifest separate from disposition rows. Copy every timestamp
  and the count from the full Slack response before filtering; the checker
  compares both lists, catches missing parents and requires the requested
  permalink timestamp to appear. Continue until a fetched page contains a
  parent older than cutoff or Slack reports exhaustion.
- Run `pnpm feedback:inventory-check -- .tmp/feedback-inventory.json`. It checks
  boundary overlap, page/cursor order, count parity, timestamps, reaction state,
  and dispositions. Include each channel's parent and page counts in the recap.

A grouped CI report or attachment is a discovery index, never a replacement for
the channel-parent inventory.
