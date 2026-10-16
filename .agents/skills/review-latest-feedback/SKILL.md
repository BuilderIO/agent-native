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

Four phases. Phase 0 comes before investigation. Claim only what you
can reconcile this run: each `👀` needs a current disposition, same-thread
status reply, and reaction decision before you claim another batch.

0. **Gate, then claim** only eligible items you can reconcile this run; finish
   their replies before claiming another batch.
1. **Answer the people who answered you.** Older open questions first.
2. **Fix** what the evidence actually proves, at the owning boundary.
3. **Reply** with useful questions, then recap.

Output is fixes. At sweep end, reconcile every workflow-owned `👀` in scope,
including inherited eyes. Give each a current disposition and matching status
reply; continuing work gets a concrete update, terminal work a final reply
after verification. Never remove `👀`: verified fixed scope also gets `✅`, and
distinct unfinished human handoffs get `🎫`. Follow
[`slack-reaction-replies.md`](references/slack-reaction-replies.md).

## Slack channels

Default channels: `#product-agent-native-feedback` (`C0ATH3CCZT4`),
`#qa-agent-native` (`C0C4U4XRT6X`), and
`#dev-agent-native-feedback` (`C0AJ5QV0J03`). Apply the full workflow to each:
use its `in:<#CHANNEL>` filter for searches and read each channel. Track
pagination, reply cursors, and counts separately. Honor narrower invocation
scope. Each channel uses the same five-day scan boundary; `#dev-agent-native-feedback`
is a default input, not a special-case exclusion.

Channel history may surface a thread reply as its own message row. Resolve each
row's `thread_ts` or permalink before counting it as feedback: only a message
whose thread parent is itself is a report parent. Keep reply rows for reaction
and answer auditing, but do not count them as separate reports. Inventory the
eyed message timestamp separately from its root `thread_ts`. If an eye is on a
reply, post its status in the root thread after that eyed message.

## Slack ownership gate

Inspect reactions before opening a thread. Reconcile only eyes owned by the
connected actor; skip another actor's eye unless its owner hands off
investigation. A handoff permits investigation and a status reply, not reaction
rights. For inherited eyes, `✅` closes only its verified scope. Re-read the
thread, answer newer human replies, and leave unclear ownership unreconciled.

Use the same actor for replies, reactions, and read-back; never claim another
actor's eye or duplicate a reply under another identity.

## Phase 0: claim what you are taking

Resolve known duplicate clusters before claiming. For an eligible item, add
`👀` before investigation and never remove it. Do not resume items excluded by
the Slack ownership gate. Post **In progress** only when work continues beyond
this run.

**Fix defects or ask for the reporter-only fact/action that unblocks the next
step.** Explain why it gates progress; never substitute **Open**, a symptom
recap, a source-access note, or a vague details request. Otherwise investigate
or fix first, then report the concrete action when a reply is due. Inspect
supplied evidence; never ask for IDs or details already given.

A reporter's proposed remedy may be wrong while the bug is real. Trace the
failure to its owner.

Record each symptom's disposition; subjective or out-of-scope feedback
doesn't close a separate defect. Tie each reaction to the scope it marks.

### Reaction and owned-eye reconciliation

Reconcile every `👀` you own, including inherited eyes and reply-row eyes, even
when `✅` is present. Eyes mark ownership, not completion; an eye-only row is
pending and needs an explicit reason in the recap. Read the root and reactions.
At wrap-up, report the counts of owned eyes, verified `✅` scopes, human `🎫`
handoffs, and eye-only items with their pending reasons; `✅` and `🎫` may both
apply to one report when separate scopes qualify.
Your current status reply must follow both the eyed source message and latest
relevant human reply. A later human answer reopens the eye: refresh the
disposition and post a newer status. Record source `ts` separately from root
`threadParentTs`.

After the reply, add and read back reactions before advancing:

- Start with the exact canonical disposition and include recorded evidence,
  including each fixed-scope verification, verbatim. The checker rejects vague
  or negated labels such as `Not fixed`.
- `Partially fixed` requires a verified fixed scope plus a distinct unfinished
  scope; otherwise use an active or waiting disposition. `Fixed` means no
  report scope remains unfinished.

- `✅` marks a verified **Fixed** source scope, even in an open PR. For UI or
  other user-visible behavior, meet the `verifying-changes` page-level bar:
  drive the running app or preview through the reported flow and confirm the
  symptom is gone; a focused source test alone is not enough. Use the
  area-specific proof for non-UI scopes. State the proof and whether it is
  merged or live. Keep `👀` while another scope is active, waiting, or
  unverified.
- `🎫` marks a distinct unfinished action owned by another human; name owner
  and action. A reporter answer, URL, or access request alone stays at `👀`.
- A claim, merge, or shipment alone never earns `✅`.

Do not remove another actor's reaction or any eye. If an own `✅` or `🎫` is
stale, remove only that mark if supported; otherwise record the exact stale
reaction and leave the item unreconciled. Read back every write and verify the
actor ID. For framework sweeps, complete
`.tmp/feedback-inventory.json` and run
`pnpm feedback:inventory-check -- .tmp/feedback-inventory.json`; a failure
means the inventory is not reconciled. See
[`channel-inventory.md`](references/channel-inventory.md).

Before citing an evidence limit or asking, try to reproduce from supplied
artifacts, URLs, errors, run IDs, or logs; investigate our access, config,
observability, and deployment gaps. Continue internal work unless one
reporter-only fact changes the next action; then ask one direct question naming
the fact and why it gates progress. Never request supplied evidence, generic
details, or unrelated answers. Otherwise state the internal action and owner.
After four days unanswered, record **Abandoned - no answer in 4 days**.

For supplied run IDs, query Thread Debug for exact events and tool results. If
unavailable, query the app's first-party Analytics by exact ID for tool calls,
model requests, and errors. Dispatch status or an empty failed-run list is not
an exact trace. Try both sources before recording the lookup error. Never ask
for supplied IDs, logs, or tool details, and do not infer the run is absent.

Use **Skipped** only for non-defects. **Open - no question** is ledger-only:
name the internal next action and owner; never send it as a Slack reply.

### Authoritative disposition vocabulary

Record one disposition and evidence per eligible source row. For a cluster,
reply once in the owner thread with duplicate permalinks and **Clustered**;
handle a distinct question as its own row.

- **Terminal (keep this workflow's eye):** **Fixed**, **Partially fixed**, **Shipped**, **Live
  verified**, **Open - no question**, **Resolved elsewhere**, **Skipped**,
  **Clustered**, or **Abandoned - no answer in 4 days**. Apply the reaction
  gate above.
- **Active (retain 👀):** **Verified locally**, **Built - live unverified**,
  **Deployed - live unverified**, **Not reproducible - attempted**, or
  **In progress**.
- **Waiting on reporter (retain 👀):** **Asked**, **Clarification needed**, or
  **Blocked on reporter**. Find these through Phase 1's question search.
- **Owned elsewhere:** use only for an unmarked item when accessible evidence
  confirms an active owner; marks owned by another task are skipped by the
  ownership gate.

Phase 2 proof makes a scope **Fixed**, even if its PR is open. Use
**Partially fixed** only for a verified fix plus a distinct unfinished scope.
Routine rollout does not reopen a fix or warrant `🎫`. **Clustered** closes a
duplicate row but retains it. Follow [the inventory procedure](references/channel-inventory.md)
for the scan and resolving reply rows to roots. Enumerate with channel reads;
reconcile fixed scopes' eyes and any new replies without restarting the fix.

Claiming does not investigate. Read back new claims; do not claim out-of-scope
items. If a new claim proves out of scope, keep `👀` and post **Skipped** once.
New evidence or upvotes do not override the ownership gate. Report gated skips
in aggregate and cluster fresh repeats for Phase 2.

### External trackers are evidence, not status

For a supplied spreadsheet, export, test matrix, or tracker, read metadata then
the bounded range with its named connector. Enumerate every row and its
completion status; retain its id, reporter, symptom, status, retest, and source
link.

Status, reactions, a merged PR, a source diff, or a unit test is not behavior
proof. Each row needs a post-change ledger result. If it cannot be read, say
**tracker unavailable**, never "no matches."

## Phase 1: answer the people who answered you

Answer new human replies under your owned eyes before newer reports, including
inherited eyes with `✅`. The checkmark never hides a new answer. Skip another
actor's eye or a scope explicitly handed to another task.

Use Slack as the ledger. Exhaust the disclosure search and the channel's reply
scan from its saved cursor; on the first run, scan available history. Because
Slack's `after:` is date-only, start a day before the cursor. Resolve each hit
to its root, check ownership, and read the full thread. Count an answer only
when a human posted after the question without this workflow's disclosure and
the reply addresses it. A newer human answer reopens the question. See
[`slack-reaction-replies.md`](references/slack-reaction-replies.md) for the
queries and cursor details.

- **Answered:** use the new evidence and try the fix before asking anything
  else. If the person says it is resolved elsewhere, record that source and
  close only that scope as **Resolved elsewhere**.
- **No answer, under four days:** wait without posting again.
- **No answer, four days or more:** keep `👀`, mark **Abandoned - no answer in 4
  days**, and carry any remaining defect as internal work; do not re-ask.

For legacy replies without a bot disclosure or eye, search once per connected
identity and inspect the author and full thread. End every new or edited Slack
reply with the exact sentence `this was sent from a bot.`; a connector footer
is not a substitute.

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
delegation and read it back. Keep new work evidence-limited until Phase 2's
four bars hold. Lack of an upvote prevents starting new feature work; it does
not prevent crediting an already-merged matching implementation: verify that
scope against Phase 2, record it **Fixed**, and add `✅` when its proof passes.

Don't search `has::eyes:`; use the owner or handoff path above.

For GitHub, Sentry, and first-party Agent-Native Analytics, use native state as
the cursor: recent open or unresolved items with no maintainer disposition,
deduplicated against Slack. If a source cannot be read, record it as
**unavailable**. Never report "nothing matched" for a source you could not
query.

<!-- framework-repo-only:start -->

### CI failures

Run `pnpm ci:red-report`; follow [CI triage](references/ci-red-report.md).
Automated CI, uptime, and monitoring findings use grouped `#qa-agent-native` rollups;
read artifacts and keep occurrences here, never issue-track them.
Query failures mean **CI unavailable**, not empty. Deploy/release/publish rows
follow [`deployment-recovery.md`](references/deployment-recovery.md) and stay
active through target proof; track source-fix disposition separately.

<!-- framework-repo-only:end -->

### GitHub issues, Sentry, and Agent-Native Analytics are first-class feedback

Read each issue's body, comments, author, labels, linked PRs. Treat
prior `fixed`, `shipped`, or `merged` comments as leads; recheck the surface.
When a fix merges, record **Fixed** and link proof in the recap. Close a GitHub
issue only when this invocation explicitly authorizes it; otherwise record the
pending close. Track release/runtime gaps separately.

Before claiming an issue, check comments for handoffs. If someone offers a PR,
or Steve asks them to, mark **Owned elsewhere**; do not investigate, edit, test,
ship, reply, or close it. A direct request overrides this.

Fix root causes or ask what's blocking; triage human issues, not automated
finding mirrors covered by QA rollups. Feature requests and
subjective feedback need user/`:upvote:` authorization. Ask three questions max;
re-read before posting/closing.

Query both production Sentry projects - frontend/browser and backend/CLI -
paginate unresolved issues, and record representative events, releases, and
fingerprints. Classify each as repo-owned, external/provider,
deployment/configuration, or unclear. Fix repo-owned failures at the boundary
and verify locally. Use hosted runtime only when the full symptom cannot be
reproduced locally and hosted behavior is needed. Track release gaps separately;
don't hold a merged fix open. Record other external actions; silence or a stale
release doesn't prove the error is gone.

Query authenticated Agent-Native Analytics error issues in parallel. Use
`list-error-issues` for unresolved groups, then `get-error-issue` for stacks,
occurrences, breadcrumbs, tags, and replay links. It captures client exceptions
and server `captureError()` failures when the server Analytics key/provider is
configured. Use it as the Sentry fallback when rate-limited. Do not query
`error_issues` or `error_events` through
`query-agent-native-analytics`; use that action only for bounded event/LLM
correlation. Apply the same local-first rule. Fix worthwhile repo-owned failures
at their boundary; record external, deployment, or unclear issues without
inventing a fix.

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

Thank issue reporters for opening it and Slack reporters for sharing. While
work continues, name the concrete action and owner. If reporter input blocks a
fix, ask the direct question and say why the answer matters. Never send
**Open**/**pending** with only a symptom or evidence description. For
inaccessible artifacts, ask for the required access grant or share setting;
don't request a new link when the current one works. Follow
`address-feedback-with-replies`. End Slack replies with
`this was sent from a bot.`.

Short replies: say the change, limits, and next step. Link merged PRs and say
they're merged. Keep hashes, branches, CI, publisher, and run details in recap.
Beta fixes follow reference for timing and live status; state other availability
plainly.

Share only new or useful information.

### After a PR merges

Follow [`slack-reaction-replies.md`](references/slack-reaction-replies.md) for
post-merge beta ETAs and package replies.

For a fixed behavior with a ticketed handoff, state the done behavior and
remaining action/owner/ticket separately; don't imply the fixed scope is open.
Don't promise a ticket until created and assigned. Ask one targeted question if
needed. Do not reopen Slack in later runs to reply.

- **Fixed** / **Shipped** / **Live verified** meet Phase 2 bars. Recorded live
  observations may be silent; merged Slack fixes still get the reply above.
  **Shipped** is for upvoted improvements.
- **In progress** — name continuing work and its owner; ask nothing.
- **A question** — follow the rules below.

Unclaimed scope/noise gets an internal recap row. Cluster duplicates. Before
replying, apply the Slack ownership gate: stay out of other actors' marks and
active human work; reconcile your own inherited eyes.

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
reconcile the owned eye and any new reporter answer, but do not restart a
verified fixed scope.

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
Reaction-gated skips: N · claimed N · answered N
Questions asked: N · Dropped at 4 days: N
Repeats of a prior Fixed claim: N (each with its earlier thread and failed fix)
Upvoted items in scope: N (built: N)

| Tracker/source or workflow run            | Reporter/owner | Status        | Repro or failed step                      | Pre/post/recovery         | Run/SHA/target/version/artifact/runtime proof | Locales             | Handoff (action/owner/ticket)      | Reply proof             | Reactions                                   |
| ----------------------------------------- | -------------- | ------------- | ----------------------------------------- | ------------------------- | --------------------------------------------- | ------------------- | ---------------------------------- | ----------------------- | ------------------------------------------- |
| 18 / [thread](...) or [workflow run](...) | ...            | <disposition> | steps; expected/actual or failed job/step | before/after/recovery run | source/tests/build/run/SHA/target/version/URL | updated/N/A/pending | none or action/owner/[ticket](...) | [reply](...) or blocker | 👀 claim; ✅ Fixed; 🎫 human handoff needed |

<!-- framework-repo-only:start -->

| CI fingerprint · N runs · [latest run](...) | N/A | class · disposition | failed job/step | pre/post | test fix/quarantine; deploy target proof | N/A | owner/task record or [QA rollup](...) | N/A | N/A |

<!-- framework-repo-only:end -->

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
