# Channel parent inventory

Use this procedure before investigating, claiming, or using a CI rollup in
place of Slack source messages.

- Read each scoped channel newest-first, following `next_cursor` until the
  five-day boundary, the inclusive permalink cutoff, or Slack exhaustion.
- For “this permalink and newer,” use the report parent's `ts` as the inclusive
  `cutoffTs` and `permalinkTs`. Slack's `oldest` parameter is exclusive, so
  query from at least one second earlier and filter locally by `ts >= cutoff`.
- Resolve every returned message's `thread_ts` or permalink before calling it a
  report parent. Only a message whose thread parent is itself is a top-level
  report. Keep reply rows to audit reactions and reporter answers, but do not
  count them as additional reports. This includes duplicate, owned, bot, and
  boundary rows; reactions and ownership determine investigation, not inventory.
- Save `.tmp/feedback-inventory.json` with `cutoffTs`, optional `permalinkTs`,
  the exact connector `sweepActorId`, and `channels`. Set `permalinkTs` when a
  supplied message anchors the scan. A channel has `channelId`, `oldestQuery`,
  and `pages`. Set `oldestQuery` to `null` when Slack was read without an
  `oldest` bound; the exact source manifest and cutoff-crossing page still
  define the scan. A page has its requested `cursor`, returned `nextCursor`,
  `exhausted`, the full Slack `messageCount`, the complete `sourceTimestamps`
  list copied from that response, and one disposition row per source message.
  Each row records `ts` and the verified `threadParentTs` (equal to `ts` for a
  root message), `reactionChecked: true`, `reactionSummary`, exact
  `reactionOwners` user IDs by emoji, and `disposition`. Use exactly `none`
  with an empty owner map when there are no reactions. Otherwise serialize every
  reaction as `emoji (count): ID, ID`, separated by semicolons; counts must
  equal the listed unique actor IDs, and the summary and owner map must agree.
  If the connector truncates the owner list, leave the row unreconciled rather
  than infer missing actors. If the connector hides `thread_ts`, resolve the
  row's permalink before recording it; never
  infer the root from a message timestamp. For each reply whose verified root
  predates every page's source manifest, add that exact root timestamp to the
  channel's `threadRoots` array. Read the reply's actual `thread_ts` or resolve
  its permalink to establish the root; do not guess from nearby timestamps.
  Supplemental roots must predate `cutoffTs`; a root at or after the cutoff is
  in scope and must have its own source-manifest row. A root present in a page
  must have its own row with `ts === threadParentTs` and must not be duplicated
  in `threadRoots`.
- For each source message with `eyes` owned by `sweepActorId`, record a current
  status reply in that message's root thread, after the eyed message. Include
  the root `threadParentTs`, reply timestamp, author ID, matching disposition,
  evidence, and read-back text. For each human handoff, the visible reply must
  name its recorded owner and action; include the scope when the report
  context does not make it clear. Reuse a qualifying reply while disposition
  and evidence remain current; update it when either materially changes. Do
  not send a new message on every sweep. For a recent unanswered question, do
  not repeat the question; if no qualifying reply exists, send at most one
  status update that points to the existing ask, then wait silently. Record an
  explicit decision for both `✅` and `🎫`: `present` with its scope, or `none`
  with the reason no mark applies.
  Record each verified `fixedScopes` entry with its proof; record every
  distinct human handoff in `handoffs[]`, with scope, owner, and action. Finish
  the reply and both
  reaction decisions for each owned eye before advancing to the next one. A
  verified fixed scope requires this actor's `✅` even when the overall
  disposition is `Partially fixed`; a distinct human handoff requires this
  actor's `🎫`. Do not add status requirements or reactions to another actor's
  eye.
- Keep the source manifest separate from disposition rows. Copy every message
  timestamp and the count from the full Slack response before filtering; the
  checker compares both lists, catches missing messages, and requires the
  requested permalink timestamp to appear. Preserve the one repeated message
  Slack may return at a cursor boundary in both page manifests and rows. The
  checker counts it as a page overlap, not as a second unique source message.
  Continue until a fetched page contains a message older than cutoff or Slack
  reports exhaustion.
- Run `pnpm feedback:inventory-check -- .tmp/feedback-inventory.json` before
  recapping. It rejects an owned eye without a current same-actor reply, a
  handoff reply omitting its recorded owner/action, a missing or
  inconsistent `✅`/`🎫` decision, a verified fixed scope without that actor's
  `✅`, a `✅` without verified scope, and a `🎫` without a distinct handoff
  owner/action. It rejects supplemental roots at or after the cutoff and checks
  that `reactionSummary` and `reactionOwners` contain the same emoji and exact
  unique actor IDs. A partial fixed scope is valid with disposition `Partially
  fixed` and its own `✅`; a human handoff for another scope can additionally
  carry `🎫`. It also checks that a
  reply row maps to an in-page self-root or a verified `threadRoots` entry,
  along with boundary overlap, page/cursor order, count parity, timestamps,
  reaction state, and dispositions. A failed check means the sweep is not
  reconciled. Include each channel's top-level
  report, source-message, and page counts in the recap.

At recap, count this actor's `👀`, `✅`, and `🎫` separately. Account for every
owned eye as a verified fixed scope, a named human handoff, or an explicit
waiting, unresolved, or skipped reason. An eye-only row is still pending; do
not count it as handled without naming why it has no checkmark or ticket.

A grouped CI report or attachment is a discovery index, never a replacement for
the channel-message inventory.
