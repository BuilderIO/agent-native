# Channel parent inventory

Use this procedure before investigating, claiming, or using a CI rollup in
place of Slack source messages.

- Read each scoped channel newest-first, following `next_cursor` until the
  five-day boundary, the inclusive permalink cutoff, or Slack exhaustion.
- For “this permalink and newer,” use the report parent's `ts` as the inclusive
  `cutoffTs` and `permalinkTs`. Slack's `oldest` parameter is exclusive, so
  query from at least one second earlier and filter locally by `ts >= cutoff`.
- Resolve every returned message's `thread_ts` or permalink before calling it a
  report parent. Only a message whose thread parent is itself is a candidate
  report root. Classify every self-parented source row explicitly as
  `rootClassification: "report"` or `"administrative"`; use the latter only
  for a channel post such as a CI ledger or process notice that is not user
  feedback, and record `rootClassificationReason`. Keep every such row in the
  source manifest and disposition inventory. Count only `report` roots as
  reports; list administrative roots separately. Keep reply rows to audit
  reactions and reporter answers, but do not count them as additional reports.
  Duplicates, bot reports, owned reports, and boundary rows remain in the
  source inventory; reactions and ownership determine investigation, not
  whether a report is counted.
- Save `.tmp/feedback-inventory.json` with `cutoffTs`, optional `permalinkTs`,
  the exact connector `sweepActorId`, and `channels`. Set `permalinkTs` when a
  supplied message anchors the scan. Each channel must include `channelId`,
  `oldestQuery`, and `pages`. Record `readAt` on every page as a local ISO
  timestamp captured immediately after that complete Slack response returns;
  do not reuse a prior inventory's pages or timestamps. Set `oldestQuery` to the
  exact timestamp passed to
  Slack, or explicitly to `null` when the request had no `oldest` bound; a
  missing or empty value is invalid. The exact source manifest and
  cutoff-crossing page still define the scan. A page has its requested
  `cursor`, returned `nextCursor`,
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
  channel's `threadRoots` array and add the root's own complete
  reaction/disposition row to `threadRootAudits`. Read the reply's actual
  `thread_ts` or resolve its permalink to establish the root; do not guess from
  nearby timestamps. A reply row does not stand in for auditing the inherited
  root message.
  Supplemental roots must predate `cutoffTs`; a root at or after the cutoff is
  in scope and must have its own source-manifest row. A root present in a page
  must have its own row with `ts === threadParentTs` and must not be duplicated
  in `threadRoots`.
- For every in-scope root classified as a report, pass the ownership gate. If
  it is still open and no other actor owns it, claim it with this actor's root
  `👀` and post a current status in its root thread. The checker rejects an
  eligible open report without this claim and status. For every root already
  owned by this actor (`👀`, `✅`, or `🎫`), record or reuse a current status
  after the latest human reply; update it only when new human input, proof,
  disposition, or next action changes. Do not reply on another actor's owned
  root, an administrative post, or a duplicate; record the reason and link a
  duplicate to its canonical report. Include
  the root `threadParentTs`, reply timestamp, author ID, matching disposition,
  evidence, and read-back text. For each human handoff, the visible reply must
  name its recorded owner and action; include the scope when the report
  context does not make it clear. A person being named or assigned is not
  acceptance: each `handoffs[]` entry must record the owner's exact Slack ID
  and accepting reply read from the source thread. A contextual assent qualifies
  only when a preceding direct request names the owner and exact action; record
  both the request and assent as described below. The accepting actor must match
  the owner, differ from `sweepActorId`, and reply after the root and before the
  status reply. Do not create a ticket or use **Blocked on
  human owner** until this acceptance exists; never assign the handoff to
  yourself. Reuse a qualifying reply while disposition and evidence remain
  current; update it when either materially changes. Do
  not send a new message on every sweep. For a recent unanswered question, do
  not repeat the question; if no qualifying reply exists, send at most one
  status update that points to the existing ask, then wait silently. Record an
  explicit decision for both `✅` and `🎫`: `present` with its scope, or `none`
  with the reason no mark applies.
  For every parent with this actor's `👀`, `✅`, or `🎫`, include
  `latestRelevantHumanReply`. Set it to `null` only when the root thread has no
  relevant non-sweep human reply. Otherwise record the reply's exact Slack
  timestamp (`ts`), `actorId`, and verbatim `text`; exclude this actor's status
  replies and bot messages. The status reply must be newer than this human
  reply. If a human answers later, update the disposition and status before
  reconciling it.
  Record each verified `fixedScopes` entry with its proof; record every
  distinct human handoff in `handoffs[]`, with scope, assigned individual,
  owner Slack ID, action, and an `acceptanceReply` containing exact `ts`,
  `threadParentTs`, `actorId`, and verbatim `text`. When the acceptance is a
  contextual assent that does not repeat the action, also record `requestReply`
  with the exact preceding in-thread request's `ts`, `threadParentTs`,
  `actorId`, and verbatim `text`. The request must be by this sweep actor, name
  the accepted owner, request the exact ticketed action, and precede the
  owner's unambiguous assent. Scope the ticket only to the request; do not infer
  a broader fix, PR, or delivery promise. A role or unassigned team is not an
  owner. As soon as direct post-change proof passes, add this actor's
  `✅` to the root and read it back before moving to another scope or report,
  including while its PR is open. Before merge, record **Verified locally** and
  say merge is pending. `✅` and `👀` can coexist: the check marks the verified
  scope; the eye marks the open merge or another scope/follow-up. After merge,
  record **Fixed** (or **Partially fixed** when another scope remains); remove
  this actor's `👀` only when no report scope or follow-up remains. Do not wait
  for unrelated scopes to close. This actor's single root `✅` covers the
  verified scopes listed in `fixedScopes[]`; a distinct human handoff requires
  this actor's `🎫`. Keep `👀` for
  every open scope. The same-thread status reply must name the verified scope(s),
  the remaining open scope(s), each open scope's blocker and next action, and
  why `✅` or `🎫` is absent when it does not apply. A reply does not replace a
  reaction, and a reaction does not replace a reply. Do not add status
  requirements or reactions to another actor's eye. When every report scope
  and follow-up is closed, post or reuse the final same-thread status, remove
  only this actor's `👀`, and read back the status and reactions. Do not keep a
  closed eye as claim history.
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
  handoff without the named owner's explicit acceptance, a handoff reply
  omitting its recorded owner/action, a missing or
  inconsistent `✅`/`🎫` decision, a verified fixed scope without that actor's
  `✅`, a `✅` without verified scope, and a `🎫` without a distinct handoff
  owner/action. It rejects supplemental roots at or after the cutoff and checks
  that `reactionSummary` and `reactionOwners` contain the same emoji and exact
  unique actor IDs. Every `threadRoots` timestamp must have exactly one matching
  `threadRootAudits` row with its own reaction read-back and disposition; an
  owned eye or mark on that root also needs its own current reply and two mark
  decisions. A partial fixed scope is valid with disposition `Partially
fixed` and its own `✅`; a human handoff for another scope can additionally
  carry `🎫`. It also checks that a
  reply row maps to an in-page self-root or a verified `threadRoots` entry,
  along with boundary overlap, page/cursor order, count parity, timestamps,
  reaction state, and dispositions. A failed check means the sweep is not
  reconciled. Include each channel's top-level
  report, source-message, and page counts in the recap.

At recap, count current-window top-level report roots separately from the
source-message and reply-row totals. Count this actor's `👀`, `✅`, and `🎫` on
those roots separately; list in-scope reply-row marks and pre-cutoff boundary
audits apart from report totals. Never include older cutoff-overlap rows in
current report counts. Account for every owned eye as a verified fixed scope,
an accepted human handoff, or an explicit waiting, unresolved, or skipped
reason. An eye-only row is still pending. If most roots are eye-only, inspect
each one again for a fix that can be verified now, and preserve the concrete
proof gap or next action for every remaining eye-only row. Slack thread
replies appear under the root's reply count, not as separate channel posts;
do not broadcast routine status replies.

After any long investigation, CI/deploy wait, or handoff, a newest-first scan
from the saved high-water mark can identify new activity. Immediately before
recap, however, rerun the complete original bounded scan from the exact
`oldestQuery` for every scoped channel, follow every cursor, and replace the
saved page responses, timestamps, source manifests, and source rows. Do not
append a delta to an older page chain or refresh its `readAt` without rereading
the page. Resolve every newly found reply to its actual root, refresh root
reactions, and reconcile human answers before replacement. Then reopen every
marked root thread after the last channel page, read all replies, and refresh
reply-level workflow reaction owners. If this final scan or any thread read is
older than 15 minutes, repeat the full bounded scan and marked-thread reads
before checking the inventory. Only a complete fresh pass can certify coverage.

Channel history does not include the contents of existing thread replies. In
that final pass, also enumerate every distinct root thread carrying this
actor's `👀`, `✅`, or `🎫` from both source rows and supplemental-root audits.
Call `slack_read_thread` on each root after the channel delta scan, following
thread pagination until complete, even when its reply count did not change in
channel history. Record one `threadSnapshots` entry per root: the exact `rootTs`,
the local ISO `readAt` captured after the read, Slack's full `replyCount`, and
every reply oldest-first with its exact `ts`, author `actorId`, `kind`
(`human`, `sweep`, or `bot`), and verbatim `text`. Include bot and sweep replies
so the snapshot proves the recorded status is the latest reply by this actor.
Use the full thread to refresh `latestRelevantHumanReply`, `latestOwnedReply`,
and `statusReply`; if a human replied after the last status, reconcile that
answer and post a newer status before updating marks or closing the sweep.

For every reply in each `threadSnapshot`, record `workflowReactionSummary` and
`workflowReactionOwners`. Copy the exact owner IDs for `eyes`,
`white_check_mark`, and `ticket`; omit unrelated emojis. Use `"none"` and `{}`
when no workflow reaction is present. When the thread read shows any of those
three reactions, call `slack_get_reactions` on that exact reply timestamp and
use its full owner list; never infer reply owners from the root reaction read or
from reply text. This proves that a visible checkoff or ticket is on the report
root, and lets the checker reject workflow marks accidentally left on replies.

The normal inventory check also requires every page and thread snapshot to have
been read within the last 15 minutes, allows at most one minute of local clock
skew, and requires every owned-thread snapshot to come after the channel's final
page read. An old, complete inventory is stale: rerun the channel scan, then
read every marked root thread again before recap. This freshness gate prevents a
complete earlier scan from silently omitting reports or replies that arrived
during investigation.

The inventory checker requires a complete `threadSnapshot` for each distinct
owned root, checks Slack's reply count and snapshot order, and rejects a newer
human or sweep reply than the recorded status. A failed check means the sweep
is not reconciled.

A grouped CI report or attachment is a discovery index, never a replacement for
the channel-message inventory.
