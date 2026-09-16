---
name: review-latest-feedback
description: >-
  Sweep recent Slack, GitHub issue, Sentry, and explicitly linked tracker
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

Four phases, in order. Phase 0 comes before any investigation, not after.

0. **Claim** every item you intend to tackle with `👀`, before investigating
   any of it.
1. **Answer the people who answered you.** Older open questions first.
2. **Fix** what the evidence actually proves, at the owning boundary.
3. **Reply**, under a hard question budget, then recap.

Output is fixes; reply only when informative. Two fixes and three messages
beats thirty replies.

## Phase 0: claim what you are taking

Other agents work concurrently. The eye is a temporary work lock: keep it only
while investigating, fixing, or waiting on one targeted detail.

**Defects are in scope: fix them or ask for the one detail needed to fix them.**
Failure to reproduce means ask, not close; state what you tried and request one
unblocker - request id, time, screenshot, account, or URL.

### Checkmark gate

For a defect, `✅` means verified closure and is only for **Fixed**, **Shipped**,
or **Live verified** after Phase 2's four bars. Never use it for a read, claim,
review, assignment, source change, test, or beta/PR queue; a suspected fix is
not a fix, and other terminal states use `:no_entry_sign:`.

If confidence is missing, retain `👀`, use an evidence-limited disposition, and
ask one targeted question or fork if it would unblock reproduction. Age never
upgrades an unverified defect; **Abandoned - no answer in 4 days** is non-fixed.

Use **Skipped** only for non-defects. Breakage is never skipped. **Open - no
reply** requires working the defect and finding neither a fix nor a useful
question; document why.

### Authoritative disposition vocabulary

Use exactly one of these dispositions in every ledger row. Do not invent a
synonym in the recap or Slack reply:

- **Terminal, release the workflow's eye:** **Fixed**, **Shipped**, **Live
  verified**, **Open - no reply**, **Resolved elsewhere**, **Skipped**,
  **Clustered**, or **Abandoned - no answer in 4 days**.
- **Evidence-limited or still active, retain the workflow's eye:** **Verified
  locally**, **Built - live unverified**, **Deployed - live unverified**,
  **Not reproducible - attempted**, **In progress**, **Asked**, **Clarification
  needed**, **Blocked on reporter**, or **Merged - release pending**.
- **Foreign ownership, preserve the other workflow's eye:** **Owned elsewhere**.

**Merged - release pending** is non-terminal: the source merged, but release
delivery and the published rerun remain. **Clustered** closes a duplicate row
without erasing its row.

Use `✅` only for **Fixed**, **Shipped**, or **Live verified**; use
`:no_entry_sign:` for other terminal states. Never delete `👀` as a substitute
or touch a foreign eye; record **Owned elsewhere** and preserve it as a
blocker when needed.

Enumerate `slack_read_channel` newest backward through `next_cursor` until a
parent has your open `👀` without either release marker, or is older than 5
days. Use its oldest timestamp as the recap cursor. Classify from parent text,
attachments, and reactions; do not open threads yet.

**`slack_search` is not a scan.** It ranks and truncates. Use channel reads for
enumeration and put their count in the recap; use search for known things such
as prior replies, eyes, and repeat symptoms.

A channel read returns parents, so use its timestamps directly; *search* hits
are usually replies, so resolve those through the permalink `thread_ts` first.

Add `👀` to every intended item and read reactions back before investigation.
Claim all actionable reports, including carried-over parents, without adding a
second reaction.

When reopening, re-claiming, or changing a terminal disposition, remove this
workflow's marker before adding `👀`; they are mutually exclusive. Remove only
our reaction. If removal is unavailable, enumerate full reaction metadata,
record manual cleanup/unverified, and claim only after removal; do not trust
the optimized negative-marker cursor.

Claiming only marks work; it does not investigate or reply. Search-discovered
work gets the same eye-first read-back. Release out-of-scope work with
`:no_entry_sign:`; preserve foreign eyes and stop on unverified reactions.

Never end with an unworked claim: give each eye a disposition; release markers
apply only to terminal states. Every item gets a recap row, but only informative outcomes get a reply. A fresh
symptom after an answer is a repeat; claim and cluster it for Phase 2.

### External trackers are evidence, not status

For a supplied spreadsheet, export, test matrix, or tracker, read metadata then
the bounded range with its named connector. Enumerate every row, including
`handled`, `completed`, `✅`, and `:no_entry_sign:`; retain its id, reporter,
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
slack_search: hasmy::eyes: -hasmy::white_check_mark: -hasmy::no_entry_sign: in:<#CHANNEL>
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
  out of scope): release the `👀` with `:no_entry_sign:`, name who resolved it
  and where, post nothing. Adding the release marker is what makes the closure
  durable, or the next run's open-claim cursor resurfaces it as unfinished
  forever.
- **No answer, posted under 4 days ago** → leave it. Post nothing. A second
  message is a nag, not a follow-up.
- **No answer, posted over 4 days ago** → the question failed. Drop it
  silently: no reminder, no re-ask, no new reaction. Release the `👀` with
  `:no_entry_sign:` and record **Abandoned - no answer in 4 days**, which is a
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

Do not change code for an unrelated product idea, praise, status update, merge
or review request, bot forward, duplicate, or work outside the invocation's
ownership.

**Keep subjective UI changes human-in-the-loop.** Automatically fix only
objective UI defects: broken interactions, misalignment, overlap or clipping,
unusable controls, or removing clear excess clutter. A reporter request is not
product signoff. Discoverability complaints and preferences do not authorize
adding, promoting, moving, or duplicating buttons or other persistent chrome.
Check overflow, keyboard, Cmd+K, and contextual surfaces first. Adding or
promoting chrome requires the invoking user's explicit current-task request or
`:upvote:` below. Otherwise mark **Skipped**, release the eye with `✅`, and do
not ask the reporter to decide. Measure failures with `text-heavy-ui`.

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
not `👀`, fix-altitude, verification, or question-budget requirements. The
upvote overrides the bug gate, not ownership; build the smallest endorsed
version and name Sid or Alice in the recap. Add `👀` before investigation or
delegation and read it back. Keep an evidence-limited disposition until Phase
2's four bars hold; only then use **Shipped** with `✅`.

Phase 0 already claimed these with `👀`. If this workflow earlier eyed
something out of scope, release it with `:no_entry_sign:`; do not post a
compensating message.

Run an unbounded reaction search across identities as well:

```
slack_search: has:reaction in:<#CHANNEL>
```

Read each matching parent and its reaction metadata. Use other valid workflow
identities' eyes only to detect **Owned elsewhere**; leave those items out of
your worklist. The `hasmy::eyes: -hasmy::white_check_mark: -hasmy::no_entry_sign:`
cursor optimizes the current identity's scan but is
never the only cursor. Keep your active claims in the worklist until a verified
fix, targeted clarification, or Phase 0 release.

Group repeat symptoms into one cluster with one owning investigation; the
repeat gate in Phase 2 owns how they are worked.

For GitHub and Sentry, use native state as the cursor: recent open or
unresolved items with no maintainer disposition, deduplicated against Slack.
If a source cannot be read, record it as **unavailable**. Never report
"nothing matched" for a source you could not query.

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

### Reproduction ledger - required for every row

Before **Fixed** or **Shipped**, record each row's exact symptom/surface,
reproduction command/click/URL/account state, expected and pre/post actuals,
tested commit/build, sibling fingerprint results, and runtime layer (`local`,
`source-only`, `built`, `deployed`, `observed-live`).

If the full bar was not exercised, use **Verified locally**, **Built - live
unverified**, **Deployed - live unverified**, **Not reproducible - attempted**,
**Asked**, **Blocked on reporter**, **Merged - release pending**, or
**Clustered**. **Live verified** is valid only after all four bars hold. Never
promote `handled`/`completed`, reactions, source tests, or unchanged live state
to **Fixed**. Repeats require a new failing pre-change reproduction and the
earlier false claim.

Regression claims require Red/Green proof: reverse-apply hunk with
`git apply -R`, record failure, reapply, record pass. Repeat timing checks 10x.
If output missing, build it and rerun on `origin/main` before calling them
pre-existing.

### Npx and package reports have a release gate

An npx scaffold is versioned. Record its pinned core version, the version
current when filed, and run the exact command with a fresh npm cache and no
local override; run the same flow on the candidate separately. Record the
release containing the change and the existing-app path (`pnpm add
@agent-native/core@<version>` or a hand edit).

Local source/tests, beta promises, and local scaffolds are not **Fixed**. A
published pass is required; a fresh scaffold covers only new scaffolds. Reply
with the version and bump/re-scaffold or hand-edit steps. If old-versus-fresh or
the endpoint environment is unknown, ask one fork question and keep the row
open.

Before npm has the fix, use **Merged - release pending**, not **Fixed**. Record
the merge commit, next core release, and verification command. After publish,
rerun the clean scaffold and state whether existing apps must bump
`@agent-native/core` or re-scaffold. Merge or beta status is not npx delivery.

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

You may tell a reporter something is fixed only when all four hold:

1. You can name the reporter's **observed symptom** — the error text, the
   ignored click, the wrong value — not just a code smell near it.
2. A reproduction **fails before your change and passes after**, and it
   exercises the reporter's exact symptom. A test asserting that a prop got
   threaded through is not a regression test for "double-click schedules two
   emails." For docs, the clean-scaffold copy-paste path is the reproduction.
3. The sibling sweep is clean, or the remaining hits are listed and triaged.
4. The change is in the snapshot that ships, and the runtime layer of the
   claim is named. **Shipped** requires build/deploy provenance; **Live
   verified** requires the target URL or runtime to be exercised. If only
   source or local evidence exists, use a narrower disposition and do not
   imply beta or production health.

If any of the four is missing, it is not **Fixed**. Say what is true instead,
or say nothing and keep working. A confident wrong "fixed" costs more than
silence: the reporter stops watching, and the bug comes back as a new thread.

An upvoted improvement has no symptom to reproduce, so bar 1 becomes: you can
state the behavior the reporter asked for and the behavior that now exists.
Bars 2–4 hold unchanged — a new capability still needs a check that fails
without it. Call it **Shipped**, not Fixed; nothing was broken.

## Phase 3: reply

`address-feedback-with-replies` owns reply voice, wording, and the thank-first
rule. Follow it; do not restate or re-derive it here. Every reply from this
workflow ends with `this was sent from a bot.` after the plain-language status.

Reply only where the reply carries information the thread does not already
have. Three kinds qualify:

- **Fixed** / **Shipped** / **Live verified** — all four bars above are met. A
  live-verified row may be silent when its live observation is already recorded;
  do not manufacture a reply. For package reports,
  include the published version and the upgrade or re-scaffold command. Name
  the beta URL/runtime only when it was actually exercised; never use “on beta
  later today” as a substitute for release or live proof. Use **Shipped** for
  an upvoted improvement.
- **In progress** — the thread already has real, concrete ownership (a named
  PR, a person actively working it). Acknowledge it; ask nothing.
- **A question** — subject to the budget below.

Everything else gets an internal recap row and **no message**. Follow the Phase
0 contract for the eye. An unverified defect earns a targeted question, not a
release marker or silence, whenever one answer would unblock it; record **Open -
no reply** only when no question would unblock it, and release that non-fixed
closure with `:no_entry_sign:`. Do not message merely to hand off.
Never post the same sentence into multiple threads: if three reports share one
cause, reply in one and record the rest as clustered.

Before replying, re-read the full thread to the end. If a human is actively
working it, stay out — do not narrate over someone mid-conversation.

### The question budget

**At most three questions per run, across all sources.** Most runs ask zero or
one.

So rank before you ask. For each candidate, state: *if I get this answer, I
can ship the fix.* Ask the three with the strongest answer. If fewer than
three clear that bar, ask fewer. Everything below the cut is an internal open
item, not a message.

Never ask for:

- Anything already in the thread — a screenshot that is attached, an app the
  message is tagged with, a slide number that is in the linked URL, a file
  type the report already enumerated.
- A run, request, or session ID as the primary ask. Reporters often cannot get
  one — the `...` menu exposing it is not always present — and an unfulfillable
  request reads as a brush-off. Prefer the surface URL, which they always have
  and which usually contains the same id.
- A build number, unless two builds plausibly differ and you will act on it.
- Anything you could determine yourself from source, logs, the linked
  artifact, or the deployed surface. Exhaust those first.
- A subjective product choice — including on an upvoted item, where the
  upvote already made the call. Build the smallest version instead of asking
  which variant they want.
- An internal blocker. Missing test tooling or a broken local install is your
  problem, never a reporter question.

At most one clarification question may be pending per thread at a time. Once it
is answered or resolved, attempt the fix; if that exposes a different required
detail, ask at most one new, non-repeating question. Never stack questions or
repeat a pending one. If a needed artifact is inaccessible to you, ask for a
fresh link - not for its contents again.

### Ask a fork, not for evidence

Name two seams you already narrowed, then ask the reporter to choose one, such
as “browser or Desktop?” or “localhost or LAN/Docker host?” Do not outsource
the investigation with a build or run-id request. If you cannot name the two
causes, read the owning path first. Ask for a one-line answer from memory,
without requiring devtools.

## Verification and identity

Follow the `## Slack identity` contract in `address-feedback-with-replies`:
confirm the connected profile is the invoking user before the first write, and
keep that identity for every read, reaction, reply, and read-back.

Resolve the Slack, GitHub, and Sentry schemas once and reuse them.

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
An unresolved **Clarification needed** item remains eye-held and blocks an
authorized merge until answered or expired.

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
| 18 / [Slack thread](...) | ... | <one disposition from the authoritative list above> | command or click sequence; expected / actual | before: ...; after: ... | source / tests / build / deploy / URL | updated / not applicable / pending | yes / no | held by me / held by other / released with `✅` (verified fix) or `:no_entry_sign:` (non-fixed closure) |

Sibling sweep: <fingerprint> - N hits, M fixed, K triaged
Tracker: <sheet/export and bounded range> - N rows enumerated, N ledgers complete
Unavailable or unverified: ...
```

`Open - no reply` is a last resort, not a success state. It requires that you
worked the defect, could not fix it, and could not form a question that would
unblock it; a run whose ledger is mostly `Open - no reply` has under-asked, not
finished. It always means the eye was released with `:no_entry_sign:`. "Nothing
matched" is valid only after each source was queried successfully, with the
cursor stated.

## Related skills

`address-feedback`, `address-feedback-with-replies`, `fix-at-the-boundary`,
`concurrent-agents`, `verifying-changes`, `ship`
