# Channel parent inventory

Use this procedure before investigating, claiming, or using a CI rollup in
place of Slack source messages.

- For the exhaustive channel source scan, use `slack_search_public` with only
  `filters=in:<#CHANNEL>`, `after=<channel cutoff>`, `keywords=[]`, an empty
  `natural_language_query`, `include_bots=true`, `include_context=false`,
  `content_types=messages`, `limit=20`, `sort=timestamp`, `sort_dir=desc`, and
  `response_format=detailed`. Do not add lexical, semantic, date, author, or
  reaction filters: they silently hide reports. Record these exact arguments
  under that channel's `scanQuery`; the inventory checker rejects a missing or
  narrowed query. `after` is inclusive and must equal that channel's effective
  cutoff. Follow every `next_cursor` newest-first to Slack exhaustion, even
  after reaching the cutoff, because later pages can contain replies to older
  roots. Page and
  source-row timestamps must descend across the full chain. This is separate
  from thread replies, which are recorded oldest-first. `slack_read_channel`
  can supplement the search but cannot replace it: channel history does not
  surface replies posted into older report threads. Use the five-day boundary
  only when no timestamp or permalink anchor was supplied. A supplied timestamp
  or permalink applies to every scoped channel. A permalink's channel ID only
  identifies where the exact linked root must appear; it does not limit the
  timestamp cutoff or channel scope.
- If Slack returns a next cursor but the search hits its page limit before
  exhaustion, keep that capped page and its unconsumed cursor as evidence; it is
  not a completed scan. Record the exact `page_limit_exceeded` result in
  `pageLimitRecoveries[]` with its exact failed request `args`, verbatim raw
  response, cursor, the capped page's oldest timestamp as `boundaryTs`, and its
  `readAt`. Restart the same channel-wide search at `cursor: null`
  with the same inclusive `after` and an inclusive `before` exactly one
  microsecond below the capped page's oldest source timestamp. Follow that
  slice's cursors to exhaustion. If another slice hits the limit, repeat from
  its oldest timestamp. Flatten all slices in newest-first order in `pages`;
  store the slice's exact `before` on every page and its full request `args` in
  the raw page wrapper. The checker verifies the cap cursor, exact one-
  microsecond boundary, the recovery event's cursor and boundary, page order,
  and final exhaustion. Save exploratory or failed recovery attempts outside
  the numbered source-pages directory.
- `cutoffTs` is the default five-day inclusive lower bound unless the invocation
  supplies a timestamp. For “this permalink and newer,” record the parent's
  `ts` as `permalinkTs` and its channel ID as `permalinkChannelId`. Use
  `permalinkTs` as `scanQuery.after` in every scoped channel, even when the
  anchor predates the five-day boundary. `permalinkChannelId` only identifies
  the channel whose exhausted source pages must contain the exact linked root.
  Without a permalink, use `cutoffTs` in every scoped channel. The selected
  bound is inclusive; do not subtract a second or move it to `oldest`. For
  supplemental history, start exclusive `oldest` at least one second before
  that channel's effective cutoff, filter locally by
  `ts >= effectiveCutoffTs`, and record the exact `oldest` in `oldestQuery`.
- Record `scope.channelIds` as the exact IDs requested and scanned. The default
  sweep lists all three default feedback channels. For an explicitly narrowed
  invocation, inspect the active user request itself. It can name the exact
  channel set with an explicit limit such as “only” and exact IDs or
  `#channel-name`s. It can also select exactly two channels by linking one
  report permalink in the first channel and directly asking for “the same in
  channel-name” (with or without `#`) in the second; that direct linked-report
  form selects exactly those two channels and does not need an exclusivity
  word. It requires exactly one linked root and one direct “same in” target. In
  that clause only, accept a single adjacent transposition in the channel name
  only when it uniquely resolves to one canonical channel in the requested
  set. Do not infer scope from incidental or quoted channel mentions or a
  channel-name prefix. A permalink or time anchor by itself does not narrow
  channel scope. Ask the user if the
  requested channels are unclear. Store the exact instruction in
  `scope.userRequest` and `scope.narrowingJudgment`, then create a separate
  `.tmp/feedback-scope-confirmation.json` from that active request with
  `source: "orchestrator"`, `decision: "explicitly-requested"`, the exact
  `userRequest`, and exact `channelIds`. Do not create the confirmation by
  copying inventory fields. Pass it as the checker's fourth input. Missing or
  mismatched confirmation leaves narrowed coverage incomplete. The checker
  validates consistency but cannot authenticate the original user message;
  creating this separate record is an explicit operator verification step. A
  partial default scan or IDs that differ from the inventory also fail.
- Record the actual canonical Slack `channelName` in every channel row. Use
  that name only when validating Slack's echoed channel search query; the
  checker also accepts the exact channel ID and rejects any other name. Never
  infer a custom channel name from its position in the inventory or substitute
  a default channel name for an unknown channel.
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
  Preserve each source row's exact `sourceText`. For every root, record a
  `rootClassificationJudgment` with this actor's ID, the same `report` or
  `administrative` decision, and a human rationale tied to that text. This is
  an attributed human triage judgment; the checker verifies its presence and
  source-text linkage but cannot prove the interpretation is correct.
  For every unheld classified root, including administrative posts, capture a
  complete thread read and make `sourceText` exactly match its `rootText`.
  A held root keeps the exact channel-scan `sourceText` and direct reaction
  evidence but has no thread-derived fields. Search output can confuse
  user-authored `Files:` or `Reactions:` lines with connector metadata, so do
  not classify from a truncated search excerpt.
  For a canonical Slack message permalink, inspect its `thread_ts` query value:
  if it differs from the message's `ts`, the message is a reply and that value
  is its root. A self-valued `thread_ts` or a canonical root permalink without
  a thread query identifies a root. Do not treat `slack_read_thread(message_ts)`
  returning the candidate text with no replies as root proof; Slack can return a
  reply as a pseudo-thread when given the reply timestamp. Resolve its canonical
  permalink or exact parent before counting, claiming, or replying. If neither
  the source row nor its permalink establishes the parent, leave it unresolved
  and do not count it as a report root.
- A failed Slack page, thread, or reaction read is unknown data, never an empty
  result. On HTTP 429, honor the returned `retry_after`, stop expanding the
  read fan-out, and retry only the failed exact page/thread/reaction at low
  concurrency. Record each failed target, exact error, and attempt time. Do not
  write `none`, `no reactions`, or a complete thread snapshot after a failed
  read. If any required source or final read remains failed, keep the inventory
  incomplete and do not report coverage totals or a successful checker result;
  retry the affected target and read it back before continuing.
- Save `.tmp/feedback-source-receipt.json` independently from the disposition
  inventory. Build it directly from each complete `slack_search_public`
  response before transforming messages into inventory rows. For each channel,
  record its `channelId`, every page in cursor order (`cursor`, `nextCursor`,
  `exhausted`, immediate ISO `readAt`, full `messageCount`, and every
  `sourceTimestamp`), and one `{ ts, root }` pair for every response message.
  Resolve `root` from that response's exact `thread_ts` or canonical permalink;
  preserve page-boundary duplicates in the same positions. Keep each complete
  response under `.tmp/feedback-source-pages/` as
  `rescan-feedback-qa-00.json`, `rescan-feedback-product-00.json`, and the
  next contiguous page number. The checker reparses those raw Slack responses
  and compares every message/root pair with both the receipt and inventory, so
  omitting the same row from the latter two cannot pass. Never generate the
  receipt by copying the inventory or change it to make a mismatch pass.
  Each page file must wrap the complete connector response: set `cursor` to the
  requested cursor (or `null` for the first page), capture `readAt` immediately
  after the response returns, and set `raw` to `JSON.stringify(response)` where
  `response` is the complete `slack_search_public` result containing `results`
  and `pagination_info`. Save the wrapper as formatted JSON, for example:

  ```ts
  const capturedPage = {
    cursor: requestedCursor ?? null,
    args: exactToolCallArgs,
    readAt: new Date().toISOString(),
    raw: JSON.stringify(response),
  };
  writeFileSync(pagePath, `${JSON.stringify(capturedPage, null, 2)}\n`);
  ```

  The wrapper's `cursor` property is mandatory. Use `null` only when that page
  was requested without a cursor; a missing value must never be treated as the
  first page. Recapture a page if its exact requested cursor was not saved.

  Do not save the connector response directly as the page file: `raw` is a JSON
  string inside the wrapper, not the top-level page object.

- Save `.tmp/feedback-inventory.json` with the default five-day `cutoffTs`,
  optional `permalinkTs` and its required `permalinkChannelId`, the exact
  connector `sweepActorId`, and `channels`. Set both permalink fields when a
  supplied message anchors the scan. Each channel must include `channelId`,
  the exact `scanQuery`, `oldestQuery`, and `pages`. `scanQuery.after` equals
  `permalinkTs` for every scoped channel when an anchor is supplied; otherwise
  it equals `cutoffTs`. Keep `oldestQuery: null`
  when no separate exclusive Slack `oldest` parameter was passed. Do not put
  `scanQuery.after` into `oldestQuery`. Record the recovery slice's `before`
  bound on its pages and capture the exact tool-call `args` in each raw page
  wrapper. Record `readAt` on every page as a local ISO
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
  Read and capture a complete, oldest-first `threadSnapshot` after the final
  channel page for every in-scope classified root, including administrative
  posts, unmarked roots, and roots with no replies, except roots held by the
  reaction ownership boundary below. The checker rejects a classified root
  without this read or with `rootText` that differs from its `sourceText`.
  Supplemental roots must strictly predate the oldest `sourceTimestamps` entry
  across every scanned page, as well as `cutoffTs`; a root inside the scanned
  source range must have its own source-manifest row even when it predates the
  cutoff. A root at or after the cutoff is in scope and must have its own
  source-manifest row. A root present in a page must have its own row with
  `ts === threadParentTs` and must not be duplicated in `threadRoots`. A
  supplemental root exists to resolve an in-window reply;
  its presence does not make the older report a new in-scope claim. Read its
  exact root reactions, then apply the ownership gate before opening the thread.
  Do not add `👀`, `✅`, or `🎫`, or post a status, just because
  an unowned older root appears as context. If this actor already owns a mark
  on that older root, reconcile its current status and scopes as usual; record
  another actor's marks as ownership evidence and leave them untouched. Their
  `👀` is active ownership only while their latest same-thread human status
  shows an open disposition; a later closed status makes that eye historical.
  Keep
  the root disposition and any open scope in the audit row without claiming it.
  For an unheld supplemental root, the inventory checker still requires a
  complete, oldest-first `threadSnapshot`, so a reply cannot predate or
  otherwise contradict its reported root.
- **Held thread:** If the exact root reaction read shows another actor owns any
  workflow mark (`👀`, `✅`, or `🎫`), or this actor owns `:mag:`, do not open or
  read the thread, inspect reply reactions, react, or reply. Record an
  `ownershipSkip` with the root timestamp and `foreign_workflow_mark` or
  `mag_opt_out`; use `Skipped` and leave thread-derived fields empty. Mark every
  channel reply linked to that root with the same skip reference. The checker
  requires direct root reaction evidence and the matching skip reason, but no
  full-thread snapshot. For a linked pre-window root without source text, use
  `unclassified`; do not guess from its in-window reply. This boundary also
  applies when the other actor's eye has no visible status reply: ownership is
  not permission to inspect.
- After each bounded channel scan, search this actor's `👀`, `✅`, and `🎫`
  separately with `slack_search_public`. Each query uses only
  `in:<#CHANNEL> hasmy::EMOJI:` and the exact same inclusive `after` value as
  that channel's `scanQuery`. Exhaust every cursor within that window. Do not
  omit `after` or expand an anchored or default-window sweep to older, unrelated
  roots. Reconcile owned marks on every in-window root and every older root
  linked by an in-window reply; unheld roots already have exact reaction and
  full-thread evidence in the source or supplemental-root audit. Unreferenced
  pre-window marks stay outside this invocation's scope.
  If Slack caps a cursor before exhaustion, preserve that capped page and
  record the exact `page_limit_exceeded` response in that search's
  `pageLimitRecoveries[]`, including its failed cursor and request args, raw
  response, read time, and the capped page's oldest result as `boundaryTs`.
  Restart the same `hasmy` query at `cursor: null` with the same inclusive
  `after` and a `before` exactly one microsecond below that boundary. Keep both
  bounds on every page in the restarted cursor slice and in each raw request
  wrapper. Follow the restarted slice to exhaustion and repeat this recovery
  for every later cap. The checker proves each failed cursor against exactly
  one restarted slice, checks the boundary and read order, and requires
  explicit exhaustion. If Slack does not let you recover a capped tail, report
  the in-window ownership search as incomplete; do not claim every scoped mark
  was reconciled.
  Record each exact query and page in `ownedMarkSearches`; save raw wrappers
  named `owned-marks-{channelName}-{eyes|white_check_mark|ticket}-00.json` and
  continue numbering for each cursor page. Each wrapper preserves exact
  request `args`, the complete `raw` connector response, requested `cursor`,
  and local `readAt`. Keep each result's exact `{ts, root, text}`. Treat a
  `hasmy` hit as a discovery candidate, not proof that the query's emoji is on
  that message: the connector can return the same messages for different
  emoji-specific queries. For a root candidate (`ts === root`), read reactions
  on that exact timestamp and confirm the expected emoji and this actor's ID
  in its owner list. Only exact reaction read-back establishes root ownership;
  a candidate returned by the wrong emoji query must not create an owned mark,
  status, or root checkoff. Keep the mismatch and candidate in the audit
  evidence; if the exact read fails or is incomplete, leave ownership
  unresolved rather than treating the query as confirmation. A result with
  `ts !== root` is reply-level evidence: resolve and preserve its parent, but
  never count it as a root checkoff. For an unheld root, verify reply reactions
  from the exact reply read-back in its complete thread snapshot; if that
  historical reply cannot be read back, report reply-level reconciliation as
  incomplete. For a held root, preserve the reply parent and matching skip
  reason without opening the thread.
  Deduplicate confirmed roots across the three searches. Every in-window root
  candidate must appear in the source pages. An older root linked by an
  in-window reply belongs in `threadRoots` and `threadRootAudits`. If a bounded
  search hit has no matching source row or linked supplemental root, rerun the
  source scan and include the missing evidence; do not invent an audit row.
  Reconcile each unheld discovered root's latest human message, status reply,
  scopes, and exact current reaction state. Read its full thread after the final
  ownership-search page and preserve every raw
  `slack_read_thread` page under `thread-{channelName}-{rootTs}-00.json` and
  contiguous page numbers. Each wrapper records exact request `args`,
  requested `cursor`, raw response, and `readAt`; the raw response must
  explicitly report cursor exhaustion. The checker compares every page and
  reply against the complete `threadSnapshot`.
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
  evidence, and read-back text. For each human/team handoff, the visible status
  reply must name its distinct scope, owner state, and action. Every distinct
  unfinished team action gets this actor's root `🎫`, even when no person has
  accepted it. For `status: "unassigned"`, record the responsible team/role or
  `unassigned`; omit the owner Slack ID and acceptance. If this actor asked a
  named person to take the action but they have not accepted, record the exact
  request and keep the handoff unassigned. For `status: "accepted"` or
  `"completed"`, a person being named or assigned is not enough: record that
  owner's exact Slack ID and acceptance reply from the source thread. A
  contextual assent qualifies only when a preceding direct request names the
  owner and exact action; an explicit first-person commitment that names the
  action also qualifies without a preceding request. Record the exact
  acceptance reply and, for contextual assent, both the request and assent as
  described below. The accepting actor must match the owner, differ from
  `sweepActorId`, and reply after the root and before the status reply. Reserve
  **Blocked on human owner** for an accepted named-owner action that blocks
  progress; keep an unassigned action in **In progress** or another accurate
  open disposition while still marking it with `🎫`. A Slack `🎫` does not
  mean an external tracker ticket exists; link one only if it already exists.
  Never assign a handoff to yourself. Reuse a qualifying reply while
  disposition and evidence remain
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
  Record each verified `fixedScopes` entry with its proof; record each
  unfinished team/engineering action in `handoffs[]` and each outstanding
  reporter input request in `reporterRequests[]` with its scope, exact action,
  and exact `requestReply`. For
  `status: "unassigned"`, record its scope, exact action, and responsible
  team/role or `unassigned`; omit `ownerSlackId` and `acceptanceReply`. If this
  sweep actor already asked a named person to take the exact action, record
  that exact `requestReply` while the handoff stays unassigned. For
  `status: "accepted"`, record the named individual, their Slack ID, and an
  `acceptanceReply` with exact `ts`, `threadParentTs`,
  `actorId`, and verbatim `text`. When that acceptance is a contextual assent
  that does not repeat the action, also record `requestReply` with the exact
  preceding in-thread request's `ts`, `threadParentTs`, `actorId`, and verbatim
  `text`. The request must be by this sweep actor, name the accepted owner,
  request the exact action, and precede the owner's unambiguous assent. A
  direct request may ask whether the named person's TODO or PR already includes
  the exact action; a clear “yes, it's on my PR” plus a stated next step also
  qualifies. Record the exact request and assent. The Slack `🎫` covers only
  the recorded action; do not infer a broader fix, PR, or delivery promise. A
  role or unassigned team is not a named individual owner. When an accepted
  action is completed, keep it in `handoffs[]` with
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
  verified scopes listed in `fixedScopes[]`; every unfinished team handoff
  and active reporter request requires this actor's `🎫`. Handoffs track team
  actions, while reporter requests track input this workflow asked for. The
  mark remains as history after completion. For an eligible open scope this
  workflow takes, retain the root `👀` as permanent history; do not use it to
  infer whether work remains.
  The same-thread status reply must name the verified scope(s), the remaining
  open scope(s), each open scope's blocker and next action, and why `✅` or `🎫`
  is absent when it does not apply. A reply does not replace a
  reaction, and a reaction does not replace a reply. Do not add status
  requirements or reactions to another actor's eye. When later evidence
  invalidates a retained `✅`, remove that scope from active `fixedScopes[]`
  and add `historicalReactionMarks[]` with the mark's `emoji`, `scope`, exact
  `reason`, and the earlier `previousStatus` (`ts`, `threadParentTs`, `actorId`,
  `disposition`, `evidence`, and verbatim `text`). When an accepted handoff owner
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
- Run `pnpm feedback:inventory-check -- .tmp/feedback-inventory.json .tmp/feedback-source-receipt.json .tmp/feedback-source-pages [scope-confirmation.json]`
  before recapping. Supply `.tmp/feedback-scope-confirmation.json` as the
  fourth input for narrowed scope; the first three inputs remain required. The
  checker compares the
  independent receipt's channel set, page chain, timestamps, message counts,
  and every source `{ ts, root }` row with the reviewed inventory and raw Slack
  responses. If it finds a mismatch,
  rebuild the inventory from the captured Slack pages and rerun the check; never
  edit the receipt to fit the inventory. Each receipt page must also be fresh
  within the checker's 15-minute window, so repeat the complete channel scan and
  required final thread/reaction reads before recap when that window expires.
  It rejects any root mark this actor owns without a current same-actor
  status reply, a
  assigned-human handoff without that person's explicit acceptance, an
  unassigned handoff that claims a Slack owner or acceptance, a handoff reply
  omitting its scope/owner/action, a missing or
  inconsistent `✅`/`🎫` decision, a verified fixed scope without that actor's
  `✅`, a `✅` without verified scope, a `🎫` without a distinct unfinished team action or active reporter
  request (an unassigned or unaccepted team action qualifies), or a completed
  handoff without
  read-back completion evidence. A
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
the root `✅`; record each distinct unfinished human/team action and add/read
back `🎫` even when it is unassigned or unaccepted. Record acceptance only
after a named person's exact reply; otherwise state `owner: unassigned` and
`status: unassigned`. For reporter evidence, access, or clarification
requests, record `reporterRequests[]` and add/read back `🎫`; explain that it
tracks requested input, not a team handoff. In the current status, state the
exact proof gap, blocker, and next owner/action. An
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

Record the completed exact reply reaction read time as
`workflowReactionReadAt`. For every root, record the completed exact reaction
read time as `reactionReadAt`; when this sweep writes a reaction, record
`reactionWriteAt` so the checker can require a later read-back. The checker
also requires each owned root reaction read and the full-thread reaction reads
to follow the final channel page.

The normal inventory check also requires every source, owned-mark search, and
thread page or snapshot to have been read within the last 15 minutes, allows at
most one minute of local clock skew, and requires owned-root reaction and thread
read-backs to follow all three cutoff-bounded mark searches. An old, complete
inventory is stale: rerun the channel scan and in-window mark searches, then
read every marked root thread again before recap. This freshness gate prevents
a complete earlier scan from silently omitting reports or replies that arrived
during investigation.

The inventory checker requires a complete `threadSnapshot` for every in-scope
classified root and every supplemental root included to resolve an in-scope
reply, except roots recorded under the held-thread boundary. For unheld roots it
checks raw thread page cursor exhaustion, Slack's reply count, exact source
text, attachments, and snapshot order, and rejects a newer human or sweep reply
than the recorded status. A failed check means the sweep is not reconciled.

A grouped CI report or attachment is a discovery index, never a replacement for
the channel-message inventory.
