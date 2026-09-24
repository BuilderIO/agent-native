---
name: review-latest-feedback
description: >-
  Sweep recent Slack, GitHub issue, Sentry, first-party Agent-Native Analytics
  error issues, and explicitly linked tracker
  feedback: first answer reporters, then fix verified bugs and actionable
  objective UI defects at the owning boundary, require human signoff for
  subjective UI changes, build features the invoking user endorsed with an
  :upvote:, and recap every disposition. Use for scheduled or manual sweeps.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# Review Latest Feedback

Four phases, in order. Phase 0 confirms scope before claiming a fix.

0. **Confirm and claim** actionable work.
1. **Answer the people who answered you.** Older open questions first.
2. **Fix** what the evidence actually proves, at the owning boundary.
3. **Reply**, under a hard question budget, then recap.

Output is fixes; reply only when informative. Two fixes and three messages
beats thirty replies.

## Phase 0: confirm the bug, then claim the fix

Read the parent and replies to confirm an objective repo-owned defect. Add
and verify `👀` before code investigation: it marks active ownership, not
root-cause certainty. Remove it if no safe repo fix exists or reporter input
blocks progress.

The proposed remedy may be wrong while the bug is real. Trace the failure to
its owning boundary; do not reject it because the suggestion is unsuitable.

For a parent with multiple symptoms, record a disposition for each symptom
before reacting. A subjective or out-of-scope suggestion does not close a
separate defect: keep `👀` while any objective symptom is being fixed, and do
not use `:done:` or `✅` until every actionable defect in the parent is
terminal.

Do not claim unclear ownership or defects, reporter-blocked reports,
unendorsed preferences, or work owned elsewhere. If investigation needs
reporter input, remove `👀` while waiting and re-add it when work resumes.

### Checkmark gate

For a defect, `✅` means verified closure and is only for **Fixed**, **Shipped**,
or **Live verified** after Phase 2's four bars. Never use it for a read, claim,
review, assignment, source change, test, or beta/PR queue; a suspected fix is
not a fix. The workspace `:done:` means triage complete only; it never means
the reported bug is fixed or the proposal accepted.

If confidence is missing, use an evidence-limited disposition and ask one
targeted question only if its answer could unblock a fix. Age never upgrades an
unverified defect; **Abandoned - no answer in 4 days** is non-fixed.

Skip only non-defects. **Open - no reply** requires working the defect, finding
no fix or useful question, and documenting why.

### Authoritative disposition vocabulary

Use one exact disposition per ledger row; do not invent recap or reply
synonyms:

- **Terminal, release the workflow's eye:** **Fixed**, **Shipped**, **Live
  verified**, **Open - no reply**, **Resolved elsewhere**, **Skipped**,
  **Clustered**, or **Abandoned - no answer in 4 days**.
- **Active fix, retain the eye:** **Verified locally**, **Built - live
  unverified**, **Deployed - live unverified**, **Not reproducible - attempted**,
  or **In progress**, only while fix or verification work is active.
- **Waiting or unresolved, no eye:** **Asked**, **Clarification needed**, or
  **Blocked on reporter**. Find outstanding questions in Phase 1's disclosure
  search, not through stale reactions.
- **Foreign ownership, preserve the other workflow's eye:** **Owned elsewhere**.

After the verified source fix merges, **Fixed** is terminal; publication, beta,
and live reruns are separate follow-ups. Link durable follow-ups with the
original issue, target, owner, and verification command or URL. Do not reopen
closed fixes during issue scans. **Clustered** closes a duplicate row without
erasing it.

Use `✅` only for **Fixed**, **Shipped**, or **Live verified**; use `:done:`
for other terminal states. Leave foreign eyes untouched; record **Owned
elsewhere** and preserve their blocker when needed.

Enumerate `slack_read_channel` newest backward through `next_cursor` until the
parent is older than 5 days. Use the oldest timestamp as the recap cursor.
Classify from parent text, attachments, and reactions; do not open threads yet.

**`slack_search` is not a scan.** It ranks and truncates. Use channel reads for
enumeration and put their count in the recap; use search for known things such
as prior replies, eyes, and repeat symptoms.

A channel read returns parents, so use its timestamps directly; *search* hits
are usually replies, so resolve those through the permalink `thread_ts` first.

On reopen or disposition change, remove our eye before re-adding it. If a
reaction cannot be verified, do not claim the item. Preserve foreign eyes;
release out-of-scope work with `:done:` only when terminal. Every item gets a
recap row, but only informative outcomes get a reply. A fresh symptom after an
answer is a repeat; confirm ownership, then eye and cluster it with the fix.

### External trackers are evidence, not status

For a supplied spreadsheet, export, test matrix, or tracker, read metadata then
the bounded range with its named connector. Enumerate every row, including
`handled`, `completed`, `✅`, and `:done:`; retain its id, reporter,
symptom, status, retest, and source link.

Status, reactions, a merged PR, a source diff, or a unit test is not behavior
proof. Each row needs a post-change ledger result. If it cannot be read, say
**tracker unavailable**, never "no matches."

## Phase 1: answer the people who answered you

Every question you ask creates an obligation to come back for the answer.
Discharge it before reading anything new.

Slack is the ledger. Do not keep a local one — a per-run state file cannot
see the previous run, which is why the follow-up never happened. Run this
first, every time:

```
slack_search: "this was sent from a bot." in:<#CHANNEL>
  sort=timestamp sort_dir=asc include_context=true max_context_length=300
```

Keep `include_context=true` on every page. Its `Context after` block identifies
human replies; do not filter to replies ending in `?`, because a clarification
may not use a question mark. Open only threads with a human reply.

**The parent is the permalink's `thread_ts`.** `Message_ts` is your own
reply's timestamp; acting on it targets the wrong message.

Also search for the invoking identity's eye-marked parents before applying the
disclosure filter:

```
slack_search: hasmy::eyes: -hasmy::white_check_mark: -hasmy::done: in:<#CHANNEL>
```

The emoji-delimited modifiers are required. They scope the search to messages
with the connected identity's eye and without either release marker. Do not
replace them with emoji text searches.

An item is answered only when a person speaks after the question without this
workflow's disclosure marker. Open the thread: a partial, unrelated, or
"will check later" reply is not sufficient. Count a reply once; only a newer
message re-enters the set. Enumerate answered threads before new work and put
the count in the recap. Keep unanswered **Clarification needed** threads
pending until answered, resolved, or aged out at four days; **Fixed**,
**Shipped**, **In progress**, and **Open - no reply** are not substitutes.
Reapply the Phase 0 release contract to terminal states.

Only an unanswered **Clarification needed** thread enters the age branches
below. If an older thread was marked **Open - no reply** despite one, restore it
to pending.

- **Someone answered** → highest priority in the run, ahead of every newer
  report: the evidence you said blocked you now exists. Rebuild it and attempt
  the fix. Reply **Fixed** only after all four bars pass; otherwise keep the
  clarification open. Never ask a follow-up before trying the fix.
  An answer that the issue is already resolved, fixed elsewhere, or not ours —
  a linked PR, "not a Clips issue" — is still an answer. Close it as
  **Resolved elsewhere** (terminal, and distinct from **Skipped**, which means
  out of scope): release the `👀` with `:done:`, name who resolved it
  and where, post nothing. Adding the release marker is what makes the closure
  durable, or the next run's open-claim cursor resurfaces it as unfinished
  forever.
- **No answer, posted under 4 days ago** → leave it. Post nothing. A second
  message is a nag, not a follow-up.
- **No answer, posted over 4 days ago** → the question failed. Drop it
  silently: no reminder, no re-ask, no new reaction. Release the `👀` with
  `:done:` and record **Abandoned - no answer in 4 days**, which is a
  terminal non-fixed ledger disposition - an expired thread keeps no eye and
  owes no reply, in this workflow or a standalone companion run. If the bug
  still matters, carry it forward as an internal investigation with no
  reporter dependency - dropping the question is not dropping the bug.

Expire unanswered questions after four days. Search unbounded to discover them,
then apply age; do not use an `after` filter that can hide an older question.
The disclosure search is the primary cross-identity cursor. For legacy replies
without disclosure or eyes, run this once per valid workflow identity:

```
slack_search: from:<EACH_WORKFLOW_IDENTITY> in:<#CHANNEL>
  sort=timestamp sort_dir=asc
```

Classify those hits by clarification wording such as `if you can share`, not as
the discovery cursor. Inspect author and full thread so another identity finds
the same question; never re-ask either search's result. Search for the
disclosure string, not a display name, and never omit it from a reply.

## Classification rules

Phase 0 applies these from parent-level evidence to decide what to claim.
Phase 2 re-applies them once the full thread is read, and retracts an eye that
no longer holds.

Use the workspace's product feedback channel; here that is
`#product-agent-native-feedback` (`C0ATH3CCZT4`) unless the invocation names
another.

**Defects and design feedback.** A clear bug has observable broken behavior: a
click or submit does nothing, an action errors, data is lost or reverted, the
result is wrong, or a working flow regressed. A credible "nothing happens" is
valid evidence — inspect the owning path before doubting the reporter.

Do not change code for an unrelated idea, praise, status update, merge/review
request, bot forward, duplicate, or work outside the invocation's ownership.

**Keep subjective UI changes human-in-the-loop.** Automatically fix only
objective UI defects: broken interactions, misalignment, overlap or clipping,
unusable controls, or removing clear excess clutter. A reporter request is not
product signoff. Discoverability complaints and preferences do not authorize
adding, promoting, moving, or duplicating buttons or other persistent chrome.
Separate the symptom from its proposed remedy. Fix objective breakage at its
boundary even when the redesign is out of scope; skip only that redesign. For
a pure preference or feature request, check overflow, keyboard, Cmd+K, and
contextual surfaces. Adding or promoting chrome requires current-task
authorization or `:upvote:`. Use **Skipped** only when no breakage remains;
release it with `:done:` and ask nothing. Measure failures with `text-heavy-ui`.

Requests for a new capability still follow the invoking identity's `:upvote:`
gate. Content remains Alice's area unless the invocation claims it.

### `:upvote:` authorizes feature requests

An `:upvote:` from **the invoking identity** - not from anyone else - promotes
an otherwise out-of-scope item into scope and authorizes the work. It is the
endorsement that settles the product question: the person who would otherwise
route this away has read it and decided it should happen. Build it.

Find them alongside the newest-message scan:

```
slack_search: hasmy::upvote: in:<#CHANNEL>
```

`hasmy:` is already scoped to the connected identity you verified, so every
hit is an endorsement by definition. Hits are not self-evidently in scope —
the query also returns ordinary replies and old polls that happen to carry the
reaction. Take the ones that name a concrete improvement; skip the rest
without comment.

An upvoted item is a **feature or UX change**: it skips only the clear-bug bar,
not ownership, fix-altitude, verification, or question-budget requirements. The
upvote overrides the bug gate, not ownership; build the smallest endorsed
version and name Sid or Alice in the recap. Add `👀` before investigating its
concrete fix, then verify it. Use an evidence-limited disposition until Phase
2's four bars hold; only then use **Shipped** with `✅`.

If this workflow eyed work that is out of scope or no longer active, remove our
eye and use `:done:` when terminal; do not post a compensating message.

Run an unbounded reaction search across identities as well:

```
slack_search: has:reaction in:<#CHANNEL>
```

Read each matching parent and its reaction metadata. Use other valid workflow
identities' eyes only to detect **Owned elsewhere**; leave those items out of
your worklist. The `hasmy::eyes: -hasmy::white_check_mark: -hasmy::done:`
cursor optimizes the current identity's scan but is
never the only cursor. Keep active fixes in the worklist until fixed or
terminal; track unanswered questions through Phase 1 without an eye.

Group repeat symptoms into one cluster with one owning investigation; the
repeat gate in Phase 2 owns how they are worked.

For GitHub, Sentry, and first-party Agent-Native Analytics, use native state as
the cursor: recent open or unresolved items with no maintainer disposition,
deduplicated against Slack. If a source cannot be read, record it as
**unavailable**. Never report "nothing matched" for a source you could not
query.

### GitHub issues, Sentry, and Agent-Native Analytics are first-class feedback

Read each issue's body, comments, author, labels, linked PRs. Treat
prior `fixed`, `shipped`, or `merged` comments as leads; recheck the surface.
When a fix merges, thank the reporter, link it, and close. Track release/runtime
gaps separately; keep open only while scope is unfixed, unmerged, or needs input.

Before claiming an issue, check comments for handoffs. If someone offers a PR,
or Steve asks them to, mark **Owned elsewhere**; do not investigate, edit, test,
ship, reply, or close it. A direct request overrides this.

Fix every defect at its root or ask an unblock question; do not
skip old, bot-filed, or maintainer-commented issues. Feature requests and
subjective feedback need user/`:upvote:` authorization. Ask three questions max;
re-read before posting/closing.

Query both production Sentry projects - frontend/browser and backend/CLI -
paginate unresolved issues, and record representative events, releases, and
fingerprints. Classify each as repo-owned, external/provider,
deployment/configuration, or unclear; fix repo-owned failures at the boundary
and verify the source/build. Check the published runtime when available, but
record any release or live gap separately rather than holding a merged fix open.
Record external actions for the rest; silence or an old release is not proof the
current error is gone.

Query authenticated Agent-Native Analytics error issues in parallel. Use
`list-error-issues` for unresolved groups, then `get-error-issue` for stacks,
occurrences, breadcrumbs, tags, and replay links. It captures client exceptions
and server `captureError()` failures when the server Analytics key/provider is
configured. Use it as the Sentry fallback when rate-limited. Do not query
`error_issues` or `error_events` through
`query-agent-native-analytics`; use that action only for bounded event/LLM
correlation. Apply the same ownership gate: fix worthwhile repo-owned issues
at their boundary, verify runtime, and record external, deployment, or unclear
issues without inventing a fix.

## Phase 2: fix

Before changing code, read `fix-at-the-boundary`, `verifying-changes`, and
`concurrent-agents`. Read `ship` when a verified fix is ready to publish.

**Read the evidence the reporter already attached before forming a hypothesis.**
Open every screenshot, clip, and linked artifact. The error text in a
screenshot is usually the whole diagnosis. Track an artifact that is
permission-gated or expired separately from one that was never provided —
inaccessible is not absent.

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
your diagnosis. People describe one bug differently, so read the hits rather
than trusting the count.

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
4. **Cluster the reports**: one investigation and one fix, not one per report.
   Clustering changes the work, not the bookkeeping — every source thread
   keeps its own recap row, and Phase 3's reply rules apply unchanged.

Record `Repeat of: <link>` and the prior failed fix in each row so the next
run inherits the history instead of rediscovering it. Never tell a reporter a
repeat is fixed on the same evidence that supported the last claim.

Measure this gate with friction keys `false-done` and
`repeat-report-refix`. Run `node scripts/agent-friction-report.mjs --weeks 2
--pattern <key>` for each before changing it and again later. A climbing count
requires a mechanical proof or release gate, not more prose.

### Bug-bash reproduction contract

For Design, Slides, Core/framework, and template bashes, the reachable reported
surface is the contract:

1. **Reproduce before editing.** Use the exact URL/route, app/template,
   account/workspace/role, build/package, browser/device, fixture, and inputs;
   record expected/actual, errors, and attached artifacts.
2. **Sweep siblings and boundaries.** Test a negative control plus empty, wrong,
   whitespace, case, and permission variants; enumerate every shared fingerprint.
3. **Repeat on the changed running artifact.** Rerun the flow, refresh/navigate,
   read UI and persisted state, and cover failure/retry/cancel/async paths.
   Destructive flows require wrong/partial/exact confirmation and recovery;
   do not delete unless needed.
4. **Test release and race layers.** Use deterministic concurrency or 10 runs,
   a clean scaffold/cache and exact published/candidate package, and the exact
   beta/production URL when those layers are in scope. These strengthen
   **Shipped** and **Live verified**; they do not keep a verified, merged source
   fix open.
5. Record untested layers/variants. Before a verified merge, use the narrowest
   evidence-limited disposition. Once the source fix is verified in the merged
   shipping snapshot, use **Fixed** even when publication, beta, or live layers
   remain; create or link the durable follow-up required above. Use **Shipped**
   or **Live verified** only after their additional bars hold. Never release
   `✅` or call **Fixed** without merged source proof. A post-checkmark repeat
   reopens the item and needs a fresh failing pre-change reproduction.

### Reproduction ledger - required for every row

Before **Fixed** or **Shipped**, record each row's exact symptom/surface,
reproduction command/click/URL/account state, expected and pre/post actuals,
tested commit/build, sibling fingerprint results, untested layers, and runtime
layer (`local`, `source-only`, `built`, `deployed`, `observed-live`).

If no merged source proof exists, use **Verified locally**, **Built - live
unverified**, **Deployed - live unverified**, **Not reproducible - attempted**,
**Asked**, **Blocked on reporter**, or **Clustered**. Once it exists, **Fixed**
is valid while remaining release/runtime layers are tracked in the durable
follow-up. **Live verified** is valid only after all four bars hold. Never
promote `handled`/`completed`, reactions, or source tests without a verified
regression to **Fixed**. Repeats require a new failing pre-change reproduction
and the earlier false claim.

Regression claims require Red/Green proof: reverse-apply hunk with
`git apply -R`, record failure, reapply, record pass. Repeat timing checks 10x.
If output missing, build it and rerun on `origin/main` before calling them
pre-existing.

### Npx and package reports have a release follow-up

Npx scaffolds are versioned. Record pinned/filed versions, fresh npm cache/no
local override, candidate result, release, and existing-app path (`pnpm add
@agent-native/core@<version>` or hand edit).

Local proof, beta promises, and scaffolds are not **Shipped**/**Live verified**
until published. A verified merged fix is **Fixed** and closes the issue. Record
merge commit, release, verification, and bump/re-scaffold follow-up. Unknown
package/endpoint context is a release follow-up. Ask only if source scope or
reporter input is unclear; missing evidence does not keep a merged fix open.
Merge/beta is not npx delivery.

### Documentation has a runnable proof obligation

For each docs row, copy commands into a clean temporary scaffold; verify every
referenced file, directory, script, env var, deploy target, link, and fence
order. A docs diff/build is not enough. Update configured locales and run
`guard:i18n-catalogs` plus `guard:i18n-changed-copy`.

Choose the narrowest seam the evidence supports:

- One isolated symptom → fix the owning local seam, add a regression check.
- Repeated or cross-surface symptoms → fix the shared primitive or contract.
- Missing capability or wrong tool → fix discovery, registry, or action wiring.
- Source-versus-live mismatch → diagnose build, deployment, or release state
  before changing source.

Never hard-code a rule for the wording of one report. One data point justifies
a local regression test or a contained fix; it never justifies a global agent
instruction or prompt exception.

### The bar for saying "Fixed"

Say **Fixed** only when all four hold: named symptom; exact pre/post
reproduction; clean or triaged sibling sweep; and verified change in the merged
shipping snapshot with source or built layer named. **Shipped** adds
build/deploy provenance; **Live verified** adds target-runtime proof. Otherwise
use a narrower disposition without implying beta or production health. Upvoted
improvements state requested versus actual behavior and use **Shipped**.

## Phase 3: reply

`address-feedback-with-replies` owns reply voice, wording, and the thank-first
rule. Follow it; do not restate or re-derive it here. Every reply from this
workflow ends with `this was sent from a bot.` after the plain-language status.

Reply only where the reply carries information the thread does not already
have. Three kinds qualify:

- **Fixed** / **Shipped** / **Live verified** - meet the applicable bars above.
  A live-verified row may be silent if its observation is recorded. For
  packages, name the published version when available; otherwise name the
  merged fix and list publication plus the upgrade/re-scaffold follow-up without
  claiming the published package is fixed. Name beta URL/runtime only when
  exercised; never substitute a future beta promise for release or live proof.
  Use **Shipped** for upvoted improvements.
- **In progress** — the thread already has real, concrete ownership (a named
  PR, a person actively working it). Acknowledge it; ask nothing.
- **A question** — subject to the budget below.

Everything else gets an internal recap row and **no message**. An unverified
defect earns a targeted question when one answer would unblock it; use **Open -
no reply** and `:done:` only when none can. Cluster duplicate causes.
Re-read the full thread before replying and stay out of active human work.

### The question budget

**At most three questions per run, across all sources.** Most runs ask zero or
one.

So rank before you ask. For each candidate, state: *if I get this answer, I
can ship the fix.* Ask the three with the strongest answer. If fewer than
three clear that bar, ask fewer. Everything below the cut is an internal open
item, not a message.

Never ask for information already supplied, a run/request/session ID as the
primary ask, a build number unless it changes the action, evidence you can
inspect yourself, a subjective product choice, or an internal blocker.

At most one clarification question may be pending per thread at a time. Once it
is answered or resolved, attempt the fix; if that exposes a different required
detail, ask at most one new, non-repeating question. Never stack questions or
repeat a pending one. If a needed artifact is inaccessible to you, ask for a
fresh link - not for its contents again.

## Verification and identity

Follow the `## Slack identity` contract in `address-feedback-with-replies`:
confirm the connected profile is the invoking user before the first write, and
keep that identity for every read, reaction, reply, and read-back.

Resolve the Slack, GitHub, Sentry, and first-party Analytics error action
schemas once and reuse them.

For every Slack write: use the exact parent `thread_ts` from a full-thread
read, never a search-result or adjacent timestamp, and re-read after posting.
Do not close, label, assign, or comment on GitHub or Sentry unless the
invocation authorizes it; link them in the recap instead.

## Publishing

A worktree is a valid PR source — commit, push, and open or update the PR from
this worktree's branch and cwd. Use `corepack pnpm ship:push` for the complete
snapshot and update the existing PR rather than opening a second one.

With shipping authority — an explicit request, or a caller that already
granted it — continue straight into `ship` in the same worktree without asking
again. Without it, prepare the ready-to-ship handoff and say shipping is
pending authorization. Carry the start cursor, grouped reports, evidence
links, owning seam, sibling-sweep results, and every disposition into the PR
body. Keep source-tested, built, deployed, and observed-live claims separate.

If a tracker was supplied, carry its exact row ids and the reproduction ledger
into the PR or release recap. Never turn a tracker status into a shipping claim.
Give every row its own disposition marker. A single reaction, checkmark, or
"reviewed" marker must not stand in for several rows, including expected,
docs-owned, cross-team, or duplicate items. Any source/docs change is linked
to its exact PR or commit; non-coding dispositions link the evidence or named
owner instead of borrowing a nearby PR link.

If the sweep found no verified fix, finish with the recap and say why no ship
started. Unavailable connectors and external failures are not shipping blockers.
An unresolved **Clarification needed** item has no eye and does not block an
unrelated authorized merge. Reopen the fix only if a reporter's answer makes
the defect actionable.

## Recap

Every item inspected gets a row, including ones you deliberately stayed silent
on - that is how silence stays auditable.

```md
## Feedback sweep
Start cursor: [Slack message](...)
Messages enumerated: N · Claimed: N · Answered since last run: N
Questions asked: N/3 · Dropped at 4 days: N
Repeats of a prior Fixed claim: N (each with its earlier thread and failed fix)
Upvoted items in scope: N (built: N)

| Tracker row / source item | Reporter | Disposition | Repro and expected vs actual | Pre / post result | Runtime / build / live evidence | Docs locales | Replied? | Eye |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 18 / [Slack thread](...) | ... | <one disposition from the authoritative list above> | command or click sequence; expected / actual | before: ...; after: ... | source / tests / build / deploy / URL | updated / not applicable / pending | yes / no | held by me / held by other / released with `✅` (verified fix) or `:done:` (non-fixed closure) |

Sibling sweep: <fingerprint> - N hits, M fixed, K triaged
Tracker: <sheet/export and bounded range> - N rows enumerated, N ledgers complete
Unavailable or unverified: ...
```

`Open - no reply` is a last resort, not a success state. It requires that you
worked the defect, could not fix it, and could not form a question that would
unblock it; a run whose ledger is mostly `Open - no reply` has under-asked, not
finished. It always means the eye was released with `:done:`. "Nothing
matched" is valid only after each source was queried successfully, with the
cursor stated.

## Related skills

`address-feedback`, `address-feedback-with-replies`, `fix-at-the-boundary`,
`concurrent-agents`, `verifying-changes`, `ship`
