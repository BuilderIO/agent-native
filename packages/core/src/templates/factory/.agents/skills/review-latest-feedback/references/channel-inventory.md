# Channel parent inventory

Use this procedure before investigating, claiming, or using a CI rollup in
place of Slack source messages.

- For the exhaustive channel source scan, use `slack_search_public` with only
  `filters=in:<#CHANNEL>`, `after=cutoffTs`, `keywords=[]`, an empty
  `natural_language_query`, `include_bots=true`, `include_context=false`,
  `content_types=messages`, `limit=20`, `sort=timestamp`, `sort_dir=desc`, and
  `response_format=detailed`. Do not add lexical, semantic, date, author, or
  reaction filters: they silently hide reports. Record these exact arguments
  under that channel's `scanQuery`; the inventory checker rejects a missing or
  narrowed query. `after` is inclusive and must equal `cutoffTs`. Follow every
  `next_cursor` newest-first to Slack exhaustion, even after reaching the
  cutoff, because later pages can contain replies to older roots. Page and
  source-row timestamps must descend across the full chain. This is separate
  from thread replies, which are recorded oldest-first. `slack_read_channel`
  can supplement the search but cannot replace it: channel history does not
  surface replies posted into older report threads. Use the five-day boundary only when no
  explicit timestamp or permalink anchor was supplied; an explicit anchor
  overrides that default even when it is older than five days.
- For “this permalink and newer,” use the report parent's `ts` as the inclusive
  `cutoffTs`, `permalinkTs`, and `scanQuery.after`; `after` is inclusive, so do
  not subtract a second. For supplemental history, start exclusive `oldest` at
  least one second earlier, filter locally by `ts >= cutoffTs`, and record the
  exact `oldest` in `oldestQuery`.
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
  For a canonical Slack message permalink, inspect its `thread_ts` query value:
  if it differs from the message's `ts`, the message is a reply and that value
  is its root. A self-valued `thread_ts` or a canonical root permalink without
  a thread query identifies a root. Do not treat `slack_read_thread(message_ts)`
  returning the candidate text with no replies as root proof; Slack can return a
  reply as a pseudo-thread when given the reply timestamp. Resolve its canonical
  permalink or exact parent before counting, claiming, or replying. If neither
  the source row nor its permalink establishes the parent, leave it unresolved
  and do not count it as a report root.
- Save `.tmp/feedback-inventory.json` with `cutoffTs`, optional `permalinkTs`,
  the exact connector `sweepActorId`, and `channels`. Set `permalinkTs` when a
  supplied message anchors the scan. Each channel must include `channelId`,
  the exact `scanQuery`, `oldestQuery`, and `pages`. `scanQuery.after` is the
  inclusive lower bound used by `slack_search_public`; keep `oldestQuery: null`
  when no separate exclusive Slack `oldest` parameter was passed. Do not put
  `scanQuery.after` into `oldestQuery`. Record `readAt` on every page as a local ISO
  timestamp captured immediately after that complete Slack response returns;
  do not reuse a prior inventory's pages or timestamps. Set `oldestQuery` to
  the exact timestamp passed to Slack's separate `oldest` parameter, or
  explicitly to `null` when no such parameter was passed; a missing or empty
  value is invalid. The exact source manifest and
  cutoff-crossing page still define the scan. A page has its requested
  `cursor`, returned `nextCursor`,
  `exhausted`, the full Slack `messageCount`, the complete `sourceTimestamps`
  list copied from that response, and one disposition row per source message.
  Each row records `ts`, `threadParentTs`, and `rootResolution`: use the exact
  source `thread_ts` when exposed, or the canonical source permalink when the
  connector hides it. For permalink evidence, record `sourcePermalink`; the
  checker verifies its HTTPS Slack channel path and message timestamp, and
  requires a reply permalink's exact `thread_ts` query value to match
  `sourceThreadTs`. When a post-cutoff reply points to a root older than every
  page, record that root in `threadRoots` and its own audit row. Prove the
  root with `slack_reply_permalink.thread_ts`: store the reply's exact
  `sourceMessageTs` and `sourcePermalink`, plus its exact `thread_ts` as
  `sourceThreadTs`. Do not infer a root from a pseudo-thread read of the reply.
  Record the evidence source and resolved root; use a null source thread only
  when the source or canonical root permalink proves that the message is
  self-parented. The resolved `rootTs` must equal `threadParentTs`;
  `threadParentTs` equals `ts` for a root.
  Also record `reactionChecked: true`, `reactionSummary`, exact
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
  Supplemental roots must strictly predate the oldest `sourceTimestamps` entry
  across every scanned page, as well as `cutoffTs`; a root inside the scanned
  source range must have its own source-manifest row even when it predates the
  cutoff. A root at or after the cutoff is in scope and must have its own
  source-manifest row. A root present in a page must have its own row with
  `ts === threadParentTs` and must not be duplicated in `threadRoots`. A
  supplemental root exists to resolve an in-window reply;
  its presence does not make the older report a new in-scope claim. Read its
  exact root reactions and complete thread, then apply the ownership gate to
  the root itself. Do not add `👀`, `✅`, or `🎫`, or post a status, just because
  an unowned older root appears as context. If this actor already owns a mark
  on that older root, reconcile its current status and scopes as usual; record
  another actor's marks as ownership evidence and leave them untouched. Their
  `👀` is active ownership only while their latest same-thread human status
  shows an open disposition; a later closed status makes that eye historical.
  Keep
  the root disposition and any open scope in the audit row without claiming it.
  The inventory checker still requires a complete, oldest-first
  `threadSnapshot` for each supplemental root, including unowned roots, so a
  reply cannot predate or otherwise contradict its reported root.
- For every in-scope root classified as a report, pass the ownership gate. If
  it is still open and no other actor owns it, claim it with this actor's root
  `👀` and post a current status in its root thread. The checker rejects an
  eligible open report without this claim and status. For every root already
  owned by this actor (`👀`, `✅`, or `🎫`), record or reuse a current status
  after the latest human reply; update it only when new human input, proof,
  disposition, or next action changes. For **Owned elsewhere**, record another
  actor's root `👀` and their latest same-thread open status after the latest
  human reply; do not claim or reply on that root. Do not reply on an
  administrative post or duplicate; record the reason and link a duplicate to
  its canonical report. Include
  the root `threadParentTs`, reply timestamp, author ID, matching disposition,
  evidence, and read-back text. For each human handoff, the visible status reply
  must name its distinct scope, recorded owner, and action. A person being
  named or assigned is not acceptance: each `handoffs[]` entry must record the
  owner's exact Slack ID
  and accepting reply read from the source thread. A contextual assent qualifies
  only when a preceding direct request names the owner and exact action; an
  explicit first-person commitment that names the action also qualifies without
  a preceding request. Record the exact acceptance reply and, for contextual
  assent, both the request and assent as described below. The accepting actor must match
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
  owner's unambiguous assent. A direct request may ask whether the named
  person's TODO or PR already includes the exact action; a clear “yes, it's on
  my PR” plus a stated next step also qualifies. Record the exact request and
  assent. Scope the ticket only to the request; do not infer
  a broader fix, PR, or delivery promise. A role or unassigned team is not an
  owner. When the accepted action is completed, keep it in `handoffs[]` with
  `status: "completed"` and `completion: { evidence, sourceUrl }` or an exact
  owner `reply` (`ts`, `threadParentTs`, `actorId`, and verbatim `text`). The
  current status must cite that completion evidence. Keep the root `🎫` as
  history; completed actions are not open follow-ups and do not block a closed
  disposition. Only an owner withdrawal moves an accepted action to
  `historicalReactionMarks[]`. As soon as direct post-change proof passes, add this actor's
  `✅` to the root and read it back before moving to another scope or report,
  including while its PR is open. Before merge, record **Verified locally** and
  say merge is pending. `✅` and `👀` can coexist: the check marks the verified
  scope; the eye is permanent workflow history and does not say whether work
  remains open. After merge, record **Fixed** (or **Partially fixed** when
  another scope remains). Never remove or clean up a reaction. Do not wait for
  unrelated scopes to close. This actor's single root `✅` covers the
  verified scopes listed in `fixedScopes[]`; an accepted human action requires
  this actor's `🎫`, including after completion. For an eligible open scope this workflow takes, retain the
  root `👀` as permanent history; do not use it to infer whether work remains.
  The same-thread status reply must name the verified scope(s), the remaining
  open scope(s), each open scope's blocker and next action, and why `✅` or `🎫`
  is absent when it does not apply. A reply does not replace a
  reaction, and a reaction does not replace a reply. Do not add status
  requirements or reactions to another actor's eye. When later evidence
  invalidates a retained `✅`, remove that scope from active `fixedScopes[]`
  and add `historicalReactionMarks[]` with the mark's `emoji`, `scope`, exact
  `reason`, and the earlier `previousStatus` (`ts`, `threadParentTs`, `actorId`,
  `disposition`, `evidence`, and verbatim `text`). When an accepted ticket owner
  withdraws, move that action out of current `handoffs[]` and record a historical
  `🎫` with its earlier accepted `handoff` plus the owner's exact
  `withdrawalReply` (`ts`, `threadParentTs`, `actorId`, and verbatim `text`).
  Explain each retained mark in the current status and its reaction decision;
  preserve it without presenting it as current proof or an active handoff. The
  checker validates historical evidence against the captured thread. When every report scope
  and follow-up is closed, post or reuse the final same-thread status and read
  back the status and reactions. Preserve every reaction; disposition and
  status show that work is closed even when the root still has `👀`.
- Keep the source manifest separate from disposition rows. Copy every message
  timestamp and the count from the full Slack response before filtering; the
  checker compares both lists, catches missing messages, and requires the
  requested permalink timestamp to appear. Preserve the one repeated message
  Slack may return at a cursor boundary in both page manifests and rows. The
  checker counts it as a page overlap, not as a second unique source message.
  Follow every returned cursor until Slack reports exhaustion. A page crossing
  the cutoff filters which messages count, but never ends the cursor chain.
- Run `pnpm feedback:inventory-check -- .tmp/feedback-inventory.json` before
  recapping. It rejects any root mark this actor owns without a current same-actor
  status reply, a
  handoff without the named owner's explicit acceptance, a handoff reply
  omitting its scope/owner/action, a missing or
  inconsistent `✅`/`🎫` decision, a verified fixed scope without that actor's
  `✅`, a `✅` without verified scope, a `🎫` without a distinct accepted
  handoff, or a completed handoff without read-back completion evidence. A
  completed accepted handoff retains its `🎫` but is excluded from open-follow-up
  disposition checks. It rejects supplemental roots at or after the cutoff and checks
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
current report counts. Revisit every owned marked root, including every
eye-only root, regardless of how many other roots have checkmarks or tickets.
Check each scope for new proof; record each verified scope and add/read back
the root `✅`; record each separately accepted human action and add/read back
`🎫`; otherwise state the exact proof gap, blocker, and next owner/action. An
eye-only root with unfinished work is pending; an eye-only root with a closed
verified disposition may retain the eye as history. Never remove or clean up a
reaction. Slack thread replies appear under the root's reply count, not as
separate channel posts; do not broadcast routine status replies.

After any long investigation, CI/deploy wait, or handoff, a newest-first scan
from the saved high-water mark can identify new activity. Immediately before
recap, however, rerun the exact original channel-wide `slack_search_public`
query for every scoped channel, including its recorded `scanQuery.after`, and
follow every cursor to Slack exhaustion. Replace the saved page responses,
timestamps, source manifests, and source rows. Do not
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

Inspect the `Files:` metadata on every channel source message, root, and thread
reply. Preserve each attachment's exact Slack file ID, filename, and MIME type
on its source row or thread snapshot. Open/read every supplied image, clip, or
linked artifact before deciding what it shows; a filename or MIME type is not
content evidence. If the connector cannot expose the file contents, keep that
scope unresolved and state the access limitation. An attachment-only human
reply is still a reply: record its exact timestamp, actor, empty text, and
non-empty `files` list as `latestRelevantHumanReply`. Do not discard it, call it
absent, or let the status predate it. The checker rejects blank human replies
without attachment metadata and checks that source and thread attachment
read-backs agree.

For every reply in each `threadSnapshot`, record `workflowReactionSummary` and
`workflowReactionOwners`. Copy the exact owner IDs for `eyes`,
`white_check_mark`, and `ticket`; omit unrelated emojis. Use `"none"` and `{}`
when no workflow reaction is present. When the thread read shows any of those
three reactions, call `slack_get_reactions` on that exact reply timestamp and
use its full owner list; never infer reply owners from the root reaction read or
from reply text. New workflow reactions belong on the report root. If a legacy
workflow reaction is already on a reply, preserve and inventory it as a reply
mark, then audit the actual root separately; a reply mark does not check off a
root scope.

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
