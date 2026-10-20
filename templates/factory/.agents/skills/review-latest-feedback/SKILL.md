---
name: review-latest-feedback
description: >-
  Review Slack, GitHub, CI, Sentry, Analytics, diagnostics, linked trackers,
  and app/template, desktop, and package deploy/release lanes. Answer reporters
  first; fix verified defects, verify delivery, build upvoted features, and
  recap. Use for scheduled or manual sweeps.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# Review Latest Feedback

Four phases, in order. Phase 0 comes before any investigation, not after.

0. **Gate, then claim** every eligible item you intend to tackle with `👀`,
   before investigating any of it.
1. **Answer the people who answered you.** Older open questions first.
2. **Fix** what the evidence actually proves, at the owning boundary.
3. **Reply** with useful questions, then recap.

Output is fixes. For every unheld in-scope report root this task owns, keep one concise, current same-actor status reply after the latest human message. It names every verified `✅` scope and its evidence, every open scope, and each `🎫` action and owner (or why a mark does not apply). Add and read back root `✅` as soon as direct post-change proof verifies a scope, and root `🎫` as soon as another person or team must act. An `👀` alone never completes the status. Preserve all reaction history, and follow [`slack-reaction-replies.md`](references/slack-reaction-replies.md). Do not reply on held, person-assigned, or `:mag:` items.

### Read the root marks as history; use the reply for current status

- `👀` records this workflow's claim. It does not mean the report is still open.
- `✅` records a scope that passed direct post-change proof. Add it as soon as
  any scope passes, even when another scope remains open; name the verified
  scope and evidence in the status reply.
- `🎫` records a distinct action another person must take, including a reporter
  request. Keep the reaction as history after that action is completed,
  answered, or abandoned; the current reply must say whether the action is
  still open or historical.
- Every owned root needs one current same-actor reply after the latest human
  reply. Reuse it while the disposition and evidence remain current; do not
  send a duplicate progress reply on every sweep. The reply names verified
  scopes, open scopes, human actions and owners, and why either `✅` or `🎫` is
  absent. An eye-only root is correct when no scope is verified and no separate
  human action is pending; say whether the next step is this workflow's
  investigation or no further action.

## Slack channels and ownership

Use the connected Slack integration for every read and write. The default
channels are `#product-agent-native-feedback` (`C0ATH3CCZT4`),
`#qa-agent-native` (`C0C4U4XRT6X`), and `#dev-agent-native-feedback`
(`C0AJ5QV0J03`); honor a narrower invocation. Scan five days by default. A
timestamp or permalink applies its inclusive lower bound to every scoped
channel. For a permalink, its channel ID identifies only where the exact linked
root must appear; it does not limit the cutoff or channel scope. For an
explicitly narrowed sweep, verify that the active request names every selected
channel, then record its exact text and IDs in the separate scope-confirmation
file. A request can select exactly two channels by linking one report in the
first and directly asking for “the same in” the second, without saying “only.”
The checker permits one adjacent-transposition typo in that target only when it
uniquely matches a selected canonical channel; it rejects incidental or quoted
mentions and prefixes. See [`channel-inventory.md`](references/channel-inventory.md)
for the scope gate and its confirmation requirements. `#dev-agent-native-feedback`
is not excluded.

In every scoped channel, run the complete bot-inclusive `slack_search_public`
scan with only the channel filter and that channel's inclusive lower bound.
Freeze one `windowEndTs` at sweep start and use it for every channel and
owned-mark search. Messages newer than it belong to the next scheduled sweep;
never move the boundary to chase arrivals. Exhaust every cursor;
`slack_read_channel` cannot replace this inventory. Resolve
each row to its true parent and read the root reactions before opening the thread.
If another actor owns any workflow mark (`👀`, `✅`, or `🎫`), or this actor owns
`:mag:`, apply the held-thread boundary below: do not read the thread, react, or
reply. Otherwise read the report's full thread and attachments before
classifying or claiming it. Follow
[`channel-inventory.md`](references/channel-inventory.md) for exact query
arguments, raw-page receipts, cap recovery, root classification, fixed-window
source scans, bounded ownership searches for this actor's `👀`, `✅`, and `🎫`,
and checker requirements. Owned-mark searches use Slack's exact syntax
`hasmy::eyes:`, `hasmy::white_check_mark:`, or `hasmy::ticket:` with the channel
filter and the same inclusive `after` and `before` as that channel's source
scan. Do not widen a finite catch-up request into an all-history audit. A root
older than `after` is in scope only when an in-window reply links to it. A
missing trailing colon is not a valid ownership query.

Only the invoking Slack actor's root marks are owned here. Another task's eye
plus its current open status remains theirs; an explicit handoff naming this
task and scope is required to transfer investigation. An eye is a permanent
claim, not proof of open or completed work. A mark on a reply never claims or
checks off its parent. Before exit, reconcile every in-window root carrying
this actor's `👀`, `✅`, or `🎫` found by the bounded searches. Also reconcile an
older root when an in-window reply links to it. For every owned root, compare
the latest human reply, current status, verified scopes, open scopes, human
actions, and exact root reactions.
Never let a high eye count hide a verified scope without `✅` or a missing
current status reply.

**Held-thread boundary:** A direct root reaction read showing another person's
`👀`, `✅`, or `🎫` means the thread belongs to that workflow; this actor's
`:mag:` means this actor opted out. Record the exact root, reaction owners, and
one reason (`foreign_workflow_mark` or `mag_opt_out`) in `ownershipSkip`, with
`Skipped` disposition. When this actor owns both `:mag:` and a workflow mark,
use `mag_opt_out` and preserve the exact root reaction-owner record as history.
Do not open/read that thread, inspect reply reactions, add or remove reactions,
or post a reply. Apply the same skip to channel reply
rows linked to that root. A linked pre-window root without source text remains
`unclassified`; do not infer its original report from the reply. This explicit
exception keeps ownership boundaries intact while allowing the rest of the
window to be reconciled. A foreign `👀` without current status is still held;
do not read it to decide whether its owner is active.

Only Steve's `:mag:` and `:yes-party:` count (`U0GCV21HC`). When Steve invokes,
exhaust `hasmy::mag:` and `hasmy::yes-party:` searches within each channel's
same inclusive cutoff; otherwise inspect root reactions in the requested
window. `:mag:` opts out and wins over `:yes-party:`. The latter authorizes only
an otherwise review-only item; it never overrides an assignment or another
task's claim.

## Phase 0: claim and reconcile

Resolve known duplicates before claiming. Check ownership, then add and read
back this task's root `👀` before investigating an eligible unowned report.
Reconcile only owned roots inside this invocation's fixed window and older
roots explicitly linked by an in-window reply. Never expand a finite sweep to
all historical roots just because this actor owns an old mark; widen the range
only when the invocation explicitly requests it or hands off exact roots. Finish
this bounded reconciliation before discovering new questions. Keep one
concise canonical status by the same actor after the latest human message; read
back the visible reply and root reactions after each write. Use
[`slack-reaction-replies.md`](references/slack-reaction-replies.md) for exact
status and reaction rules.

**Bounded exit gate:** enumerate the complete candidate set from the fixed
source window, the three matching owned-mark searches, and older roots linked
by in-window replies. For every unheld owned root, compare the latest human
message, current status reply, verified scopes, open scopes, and root marks.
Add and read back `✅` for each newly verified scope and `🎫` for each distinct
pending human action; the status reply must follow the latest human message and
name current evidence, remaining work, and owners. An `👀` with a verified
scope missing `✅`, a pending human action missing `🎫`, or no current status is
unfinished. Finish the complete bounded set once, then stop; do not chase
unrelated historical marks.

Split reports into distinct scopes. Add root `✅` as soon as any named scope
passes direct post-change proof, even while its PR is open; say **Verified
locally** and that merge is pending. Use **Fixed** only after merge and direct
proof. Add root `🎫` for each distinct unfinished action another human must take,
including a requested reporter URL, access grant, evidence, or clarification.
The mark tracks an outstanding human action, not an accepted team handoff.
Record reporter requests in `reporterRequests[]`, separately from
team/engineering `handoffs[]`. Enumerate each verified scope, open scope,
reporter request, and handoff in the status reply; explain any absent mark. Keep
marks after completion and never remove them. For a closed reporter request,
preserve its request and closure evidence in the historical ticket record; see
[`slack-reaction-replies.md`](references/slack-reaction-replies.md).

Reuse proof across roots only when an exact stable identifier and scope match.
Trace each symptom to its owner; one verified fix does not close a separate
scope. Inspect our access, configuration, and observability before requesting
reporter details. Try local reproduction before calling a defect
non-reproducible, and ask only for the missing fact or action that gates the
next step. An **Open - no question** row is ledger-only: state the internal next
action and owner. Use **Skipped** only for non-defects.

## Phase 1: answer the people who answered you

Phase 0 handles new human replies on owned roots first; never hide a newer
reporter reply behind a mark. Then find prior unanswered questions using the
exact bot disclosure and the saved channel reply cursor, bounded by this
invocation's fixed window. On a first run, use the same default five-day window;
never scan all available history to initialize the cursor. Exhaust pages, use a
one-day overlap for date-only cursors, resolve every hit to its parent, and read
the full thread after checking reactions. An older root is eligible only when
an in-window reply links to it. Follow
[`slack-reaction-replies.md`](references/slack-reaction-replies.md) for exact
searches, legacy identity handling, and answer criteria.

A valid answer is a human post after the question, without this workflow's
disclosure, that addresses the question. Rebuild the evidence and attempt the
fix before asking anything else. An answer that says the issue was resolved
elsewhere closes that clarification without a `✅`. Do not re-ask an unanswered
clarification under four days old. At four days, record **Abandoned - no answer
in 4 days** once without a new question, then carry any still-relevant defect
as internal work. Count each answer once, recap the count, and do not send
routine follow-up pings.

## Classification rules

Phase 0 applies these from parent-level evidence to decide what to claim.
Phase 2 reapplies these rules after full-thread review.

Use `## Slack channels` unless the invocation narrows scope.

**Automated diagnostics are feedback.** For Slack, gate before reading.
Before claiming, use only alert/link metadata. Follow
[`automated-diagnostics.md`](references/automated-diagnostics.md) for ownership,
claim, and stop/continue; inspect logs, tests, and artifacts only afterward.

**Defects and design feedback.** A clear bug has observable broken behavior: a
click or submit does nothing, an action errors, data is lost or reverted, the
result is wrong, or a working flow regressed. A credible "nothing happens" is
valid evidence — inspect the owning path before doubting the reporter.

Do not change code for an unrelated product idea, praise, status update, merge
or review request, irrelevant bot forward, duplicate, or work outside the
invocation's ownership.

**Subjective UX proposals need human review.** Adding buttons/chrome or changing
visibility, placement, emphasis, or discoverability (including “hard to find”)
is a product proposal, not a defect. Check overflow, keyboard, Cmd+K, and
contextual surfaces first. Recap the ask, findings, options, recommendation,
and tradeoff; mark **Skipped**. A report or `:upvote:` never authorizes automatic
implementation; only a user-directed task may implement an approved approach.
If claimed, keep 👀, post **Skipped** once, and don't ask the reporter to choose.

Auto-fix objective defects only: broken behavior/results, misalignment,
overlap/clipping, illegibility, unusable focus/targets, jank, jitter,
measurable slowness, regressions. Separate defects from preferences; measure
failures with `text-heavy-ui`. Content remains Alice's unless claimed.

### `:upvote:` authorizes feature requests

An `:upvote:` from **the invoking identity** - not from anyone else - promotes
an otherwise out-of-scope item into scope and authorizes the work. Subjective
UX proposals are the exception: an upvote routes them for human review, not
implementation by this sweep.

Find them alongside the newest-message scan:

```
slack_search: hasmy::upvote: in:<#CHANNEL>
```

`hasmy:` is already scoped to the connected identity you verified, so every
hit is an endorsement by definition. Hits are not self-evidently in scope —
the query also returns ordinary replies and old polls that happen to carry the
reaction. Take the ones that name a concrete improvement; skip the rest
without comment.

An upvote endorses an otherwise out-of-scope **feature request** and skips only
the clear-bug bar; it does not change ownership, reaction, verification, or
question-budget rules. Subjective UX proposals remain review-only as above.
Build the smallest eligible endorsed version, name Sid or Alice, and state
requested versus actual behavior in the recap. Add `👀` before investigation or
delegation and read it back. Keep it evidence-limited until Phase 2's four bars
hold; then use **Shipped** and add `✅` once the accepted improvement is
delivered and verified.

Don't search `has::eyes:`; use the owner or handoff path above.

For GitHub, Sentry, and first-party Agent-Native Analytics, use native state as
the cursor: recent open or unresolved items with no maintainer disposition,
deduplicated against Slack. If a source cannot be read, record it as
**unavailable**. Never report "nothing matched" for a source you could not
query.

### GitHub issues, Sentry, and Agent-Native Analytics are first-class feedback

Follow [`external-feedback-sources.md`](references/external-feedback-sources.md). Close a GitHub issue only when this invocation authorizes it. Never investigate, edit, reply to, or close an issue another person has offered to handle (**Owned elsewhere**), unless the invocation directly asks.

### Chat run health

Run outcomes never reach Sentry; follow
[`chat-run-health.md`](references/chat-run-health.md).

### Deployment, release, and publish failures

Scan app/template, desktop, and package lanes every sweep, even without linked
feedback. Carry active run IDs, queued/running runs, failures, and missing/stale
artifacts across cursors. Fix repo causes; record external/manual causes with
the next owner/action. CI-red deploy rows from [CI triage](references/ci-red-report.md)
reuse this operational fingerprint. Follow
[`deployment-recovery.md`](references/deployment-recovery.md) for recovery and
target proof; keep delivery active until proof passes. A source issue may be
**Fixed** separately; delivery gaps are never **Quarantined**. Green CI or
merged source does not prove delivery.

## Phase 2: fix

Before changing code, read `fix-at-the-boundary`, `verifying-changes`, and
`concurrent-agents`. Read `ship` when a verified fix is ready to publish.

**Read the evidence the reporter already attached before forming a hypothesis.**
Open every screenshot, clip, and linked artifact. The error text in a
screenshot is usually the whole diagnosis. Track an artifact that is
permission-gated or expired separately from one that was never provided —
inaccessible is not absent.

### Attempt local reproduction before evidence-limiting

For each concrete objective defect, try the reported flow before deciding it
cannot be reproduced or fixed. Trace the screenshot, URL, visible action, and
error through the app to its route, action, provider, or form contract; use
those clues to choose the closest runnable local seam. Exercise the flow with
a local build and synthetic fixtures. If its external dependency is unavailable,
mock that boundary or submit the same shape to a local validator. Do not use a
reporter's real email or create a real external record merely to prove a
failure.

Record the route or action, build, fixture, steps, expected and actual result,
and error. Code inspection alone is not a reproduction attempt, and
**Not reproducible - attempted** requires an actual flow attempt. Ask the
reporter only when a specific missing detail would change the attempt or fix;
otherwise make the best local attempt with the evidence already available.
If the attempt stops at a concrete access or environment limit, name what was
tried and what exact behavior remains untested. Measure misses with
`feedback-no-local-repro`.

**Sweep siblings before you claim anything is fixed.** Derive the fingerprint
from the symptom, not the file — the exact crashing token, call shape, or
literal — then search the repo for it and enumerate every hit in your recap
before editing. `fix-at-the-boundary` owns the method. A fix that repairs the
reported route and leaves the identical crash in its sibling is not a fix, and
the reporter was told otherwise.

### Repeats get more time, not the same fix again

Before fixing anything, search the channel for prior reports of the same
symptom:

```
slack_search: <2-4 distinctive symptom words> in:<#CHANNEL>
  sort=timestamp sort_dir=desc
```

Search in the reporter's words — `zoom invalid_client`, `logout twice` — not
your diagnosis. Read hits; one bug may have different descriptions.

**A repeat report after a Fixed claim is evidence that fix failed.** It is the
only falsification signal this workflow gets, and it outranks your belief that
the code is correct. Treat it as a stop, not a fresh report:

1. **Find what we said last time** — the prior thread, its **Fixed** reply,
   and the commit behind it. You want the claim that turned out wrong.
2. **Name why it did not take**: never deployed; fixed a sibling path; root
   cause misdiagnosed; or one symptom of several. Each needs a different
   repair, and re-applying the same class of change is how one bug ships
   three times.
3. **Reproduce end to end before editing, verify end to end after.** A passing
   unit test is not sufficient for a repeat — exercise the surface the reporter
   used. `verifying-changes` owns the proof.
4. **Cluster identical causes** into one investigation and fix, but keep a
   recap row per source thread; Phase 3's reply rules still apply.

Record `Repeat of: <link>` and the prior failed fix in each row; never call a
repeat fixed on the evidence that supported the earlier claim.

Measure this gate with friction keys `false-done` and
`repeat-report-refix`. Run `node scripts/agent-friction-report.mjs --weeks 2
--pattern <key>` for each before changing it and again later. A climbing count
requires a mechanical proof or release gate, not more prose.

### Reproduction and verification detail

Use [`reproduction-and-verification.md`](references/reproduction-and-verification.md)
for the bug-bash contract, reproduction ledger, and regression proof.

### Npx and package reports have a release follow-up

Use [`deployment-recovery.md`](references/deployment-recovery.md) for npx
version, registry, publication, and existing-app upgrade proof. A verified merge
may be **Fixed** while its delivery row stays open; a local scaffold or beta
promise is not delivery.

### Documentation has a runnable proof obligation

For each docs row, use [`documentation-proof.md`](references/documentation-proof.md).
A docs diff/build alone isn't proof.

Choose the narrowest seam the evidence supports:

- One isolated symptom → fix the owning local seam, add a regression check.
- Repeated or cross-surface symptoms → fix the shared primitive or contract.
- Missing capability or wrong tool → fix discovery, registry, or action wiring.
- Source-versus-live mismatch → diagnose build, deployment, or release state
  before changing source.

Never hard-code a rule for the wording of one report. One data point justifies
a local regression test or a contained fix; it never justifies a global agent
instruction or prompt exception.

## Phase 3: reply

Thank issue reporters for opening issues and Slack reporters for sharing.
Before posting, inspect the full thread and follow the one-reply gate in
`address-feedback-with-replies` and the [Slack reply reference](references/slack-reaction-replies.md):
send one concise disposition covering done, remaining, and next action/owner.
Do not reply again to announce merge, publication, or live beta; answer direct
reporter follow-ups. End Slack replies with `this was sent from a bot.`.

Reporter-facing replies are one or two sentences: the change or question, its limit, and the next step. Do not explain workflow mechanics, ledgers, or external tracker tickets. Never send **Open**/**pending** or a symptom recap. Ask for reporter input only when it changes the next step; never request supplied evidence or internal access. Keep hashes, branches, CI, publisher, and run details in the recap.

Every root this actor marks with `👀`, `✅`, or `🎫` also needs the current
same-actor status reply required by the Slack reaction reference. One concise
reply may serve both purposes when it answers the reporter and records the
current disposition, verified/open scopes, owner/action, and any reason a mark
is absent. This status requirement takes precedence over the reporter-facing
brevity rule only for those facts; do not explain ledger mechanics or external
tracker tickets. A Slack `🎫` reaction tracks a distinct human action, not an
external ticket, and remains as history after the action closes. Never imply
that an external ticket was created or assigned.

Keep publisher and beta checks in the internal recap after the disposition;
they do not trigger a second reporter reply.

### After a PR merges

Track publisher state and beta verification in the internal recap. Do not send
a routine post-merge reporter reply; answer only a direct reporter follow-up.

For a fixed behavior with a Slack `🎫` handoff, state the done behavior and
remaining action/owner separately; don't imply the fixed scope is open. The
Slack reaction tracks a distinct unfinished human/team action, including an
unassigned action; it does not mean an external tracker ticket exists. Link an
existing tracker ticket when there is one, and do not claim a tracker ticket
was created or assigned unless that is true. Ask one targeted question if
needed.

- **Fixed** / **Shipped** / **Live verified** meet Phase 2 bars. Recorded live
  observations may be silent. **Shipped** is for upvoted improvements.
- **In progress** — name continuing work and its owner; ask nothing.
- **A question** — follow the rules below.

Unclaimed scope/noise gets an internal recap row. Cluster duplicates. Before
replying, apply the Slack ownership gate; stay out of marked messages and active
human work.

### Ask only answerable questions

Ask one direct question per blocked defect when the answer changes reproduction
or unblocks the fix; there is no per-run cap. Keep one pending question per
thread and try the fix before any follow-up. Never request supplied logs/IDs,
internal access/config/tooling, subjective choices, or irrelevant details. If a
missing user-visible link or ID blocks reproduction, ask for it and say where
to find it. For an inaccessible artifact, request a fresh link.

## Verification and identity

Follow the `## Slack identity` contract in `address-feedback-with-replies`:
confirm the connected profile is the invoking user before the first write, and
keep that identity for every read, reaction, reply, and read-back.

Resolve the Slack, GitHub, Sentry, and first-party Analytics error action
schemas once and reuse them.

For every Slack write: use the exact parent `thread_ts` from a full-thread
read, never a search-result or adjacent timestamp, and re-read after posting.
Do not close, label, or assign GitHub/Sentry items, or post unrelated comments,
unless the invocation authorizes it. For PR review feedback, first verify the
live PR author and follow `babysit-pr`: concise replies that disposition
feedback on the active user's own PR, including a recap for feedback found only
in a review body, need no extra authorization. On another person's PR, comment
only when the invocation explicitly authorizes comments on that exact PR;
otherwise draft the reply, leave the feedback unresolved, and link it in the
recap. This exception is only for PR review feedback, not proactive PR comments
or issue comments.

## Publishing

Use this worktree's branch. Batch fixes with one
`corepack pnpm ship:push -m "<specific fix>"`; each head reruns CI. Sync
`origin/main` only for GitHub conflicts; prefer normal merges on shared
branches. Behind/pending never justify syncing.

Use `/ship` for PR ownership, push, and merge checks. Never push to another
person's PR without explicit authorization for that exact PR in this request.
Push-only authorization means `ship_mode=ready-only`; merging requires separate
authorization for that PR. Without push authorization, hand off as pending.
Carry feedback evidence and dispositions into PRs; reference only issues the
PR fixes.
Keep source-tested, built, deployed, and observed-live claims separate.

Carry exact tracker row ids and the reproduction ledger into the PR or release
recap; tracker status is not shipping evidence. Mark each row independently: a
reaction, checkmark, or "reviewed" cannot cover multiple rows, including
expected, docs-owned, cross-team, or duplicate items. Link each source/docs
change to its exact PR or commit, and each non-coding disposition to its
evidence or owner.

If no fix is verified, recap why shipping did not start. Unavailable connectors
and external failures are not shipping blockers.
While waiting, **Clarification needed** stays open with `👀` and no `✅`; it
must not block independent fixes unless it could affect a PR change. Later runs
skip the eye under the ownership gate.

## Recap

Every eligible item gets a row. Report gated skips by count only, without
message details.

```md
## Feedback sweep
Start cursors: product [Slack message](...) · QA [Slack message](...) · dev [Slack message](...)
Reply cursors (reuse next run): product <timestamp> · QA <timestamp> · dev <timestamp>
Messages: product N · QA N · dev N (total N)
Deployment cursor: <timestamp> · carried active run IDs/rows: <ids/count>
Release lanes: N inspected · failed/stale N · target verified N
Gated skips (reactions, person-assigned threads, Steve's `:mag:`): N · claimed N · answered N
Questions asked: N · Dropped at 4 days: N
Repeats of a prior Fixed claim: N (each with its earlier thread and failed fix)
Upvoted items in scope: N (built: N)

| Tracker/source or workflow run | Reporter/owner | Status | Repro or failed step | Pre/post/recovery | Run/SHA/target/version/artifact/runtime proof | Locales | Handoff (action/owner/ticket) | Reply proof | Reactions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 18 / [thread](...) or [workflow run](...) | ... | <disposition> | steps; expected/actual or failed job/step | before/after/recovery run | source/tests/build/run/SHA/target/version/URL | updated/N/A/pending | none or action/owner/[ticket](...) | [reply](...) or blocker | 👀 claimed; ✅ completed and verified; 🎫 follow-up action/owner needed |

Sibling sweep: <fingerprint> - N hits, M fixed, K triaged
Tracker: <sheet/export and bounded range> - N rows enumerated, N ledgers complete
Unavailable or unverified: ...
```

**Open - no question** is ledger-only when reporter input cannot change the
internal next step; name the step and owner. Keep `👀`, no `✅`. If an answer
changes it, ask. "Nothing matched" requires successful queries and a cursor.

## Related skills

`address-feedback`, `address-feedback-with-replies`, `fix-at-the-boundary`,
`concurrent-agents`, `verifying-changes`, `ship`, `ship-and-monitor`
