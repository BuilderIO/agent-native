---
name: review-prs
description: >-
  Review recent BuilderIO/agent-native human pull requests, approve eligible
  internal PRs, and identify PRs ready for Steve's final maintainer decision.
  Merge only when Steve explicitly requests it for that PR. Use for scheduled
  or manual PR sweeps; flag external work needing a major product call or new
  framework API, and unresolved major product or UX decisions, to Steve.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# Review Pull Requests

Review the newest relevant human pull requests in `BuilderIO/agent-native`.
Under the default internal-author policy below, approve eligible fixes from
verified BuilderIO organization members. Never approve an external or
unverified author. When Steve explicitly gives the blanket instruction defined
below, follow that instruction over ordinary approval gates; the non-waivable
safeguards in this skill still apply.

Approval and merge readiness are separate. **Ready for Steve's final maintainer
approval/merge** means implementation is complete, required checks have passed,
and any required product, UX, or owner input is complete. It identifies a
candidate for Steve's final decision; readiness alone does not authorize a
merge. Merge only when Steve explicitly requests the merge for that PR, using
the guarded merge procedure below. For a confirmed external author, a clear bug
fix or a bounded improvement that follows existing patterns enters evidence
review and the possible merge flow; external authors are never eligible for an
approval review. Surface external work that needs a major product call or a new
framework API for Steve's explicit approval before a full review or merge; a
scheduled or manual sweep is not that approval.

## Selection and evidence

List open PRs newest by creation or update time, then inspect the latest
Agent-Native work first. Include recent PRs from internal team members even if
their branch name does not contain a product name. Re-review a PR when it has a
new commit, review, comment, or check result; otherwise do not create duplicate
review noise.

Before selecting a PR for review, read only enough metadata to determine its
author and draft state:

 - Ignore every bot-authored PR, including Dependabot and
   `builder-io-integration[bot]`, and ignore every PR authored by the exact
   login `steve8708`. Do not inspect their diff, checks, reviews, membership,
   or source links; do not take any review or merge action; and do not add
   them to the end-of-run recap.

 - Ignore draft PRs completely. Do not inspect their diff, checks, reviews,
   membership, or source links; do not take any review action; and do not add
   them to the end-of-run recap.

 - Verify each remaining human author's current BuilderIO membership using the
   organization membership API below. For a confirmed nonmember, apply the
   external-contribution scope gate before reading review summaries or entering
   the evidence sweep. For all PRs that pass that gate, read the current review
   summary to determine whether the PR already has a current, non-dismissed
   `APPROVED` review.

 - Before the scope gate, check a confirmed nonmember's PR from a fork for
   assignees. If any assignee is a verified current BuilderIO member, ignore
   the PR completely, like a draft: that person owns it under `community-prs`.
   Take no review, reply, or merge action, and leave it out of the recap.

 - Reuse that review as the code assessment only after verifying the reviewer
   is a different, current BuilderIO member and is eligible under the PR's
   author- and scope-specific rules, including any independent-review
   requirement. An unknown or ineligible reviewer never suppresses a full diff
   review. A valid approval suppresses duplicate code review only while no
   newer commit, comment, review, or check result exists; the PR still enters
   the merge-readiness pass and recap.

All non-draft human PRs that pass the author and external-scope gates enter the
evidence sweep below. For PRs with a verified eligible current-head approval and
no newer event, skip duplicate code review but check merge readiness and merge
only when Steve explicitly requested that merge. Eligible Liam PRs with only
older-head approvals enter the sweep so the current head can be reviewed. The
blanket approval instruction may waive ordinary approval gates, but it does not
bypass the complete diff and safety review. It need not produce a readiness
disposition or a full-sweep recap.

For every PR you inspect, read:

 - the title, body, linked issue, and source links;
 - for PRs requiring a new or repeat code review, the complete changed-file
   list and diff, including generated or migration files; a current-head
   approval from a verified eligible reviewer with no newer event is the
   existing code assessment, so check its merge evidence without repeating that
   review;
 - all current human and bot review summaries, inline comments, and replies;
 - every current check/status context and actual conclusion, marking pending,
   skipped, unknown, or failing separately;
 - the repository ownership and the affected app or framework boundary.

Inspect repository rulesets as well as branch protection. List every page with
`gh api --paginate 'repos/BuilderIO/agent-native/rulesets?includes_parents=true'`
so organization and enterprise rulesets are included, then inspect each
matching `/rulesets/<id>` definition's `conditions.ref_name` and
all applicable rules for the PR base branch, including required status checks,
deployments, and other non-status conditions. Only rulesets with
`enforcement: active` impose requirements; disabled and evaluate-only rulesets
do not. `gh pr checks --required` can omit ruleset requirements; never infer
that no merge requirements exist from that command alone.

Use the GitHub organization membership API to verify that the author and any
reviewer whose approval you rely on are current members of `BuilderIO`. Do not
infer membership from a display name, email, company claim, branch name,
`authorAssociation`, or a familiar-looking bot. If author membership cannot be
verified, do not approve. External authors are never auto-approved, even when
the patch looks safe or the issue is obviously valid.

## Explicit blanket approval instruction

Only a direct user instruction explicitly requesting approval of every
currently open, non-draft PR by verified current BuilderIO human members in
`BuilderIO/agent-native` triggers this override. “Approve all BuilderIO member
PRs” is one such instruction. Requests to review, inspect, list, or identify
ready PRs do not trigger it. If the requested repository, approval action, or
author/status scope differs or is ambiguous, apply the normal gates rather than
expanding the instruction. Exclude all bot-authored PRs and the exact login
`steve8708`. This direct instruction overrides ordinary approval gates,
including check, review-feedback, UX-owner, and narrower author-specific gates.
It does not waive membership verification, the external-author prohibition,
the ultra-scary safety gate, or the independent-review requirement for PRs
changing review or approval policy, agent-safety instructions, membership
verification, or CI/deployment security controls. Active credible safety
findings remain approval-blocking. If a non-waivable gate applies, do not
approve that PR; report the exact gate.

Before approving, inspect the complete changed-file list and diff, current
review findings, and current check results needed to identify non-waivable
safety concerns. The approval can serve as code-review evidence in a later
readiness pass only because this path requires that full diff review; it remains
reusable only under the reviewer eligibility, current-head, and no-newer-event
rules above. Do not infer a code assessment from the blanket instruction alone.

For each eligible PR, record the head whose complete diff was reviewed. Re-read
the live head immediately before acting. If it changed during or after review,
restart the complete diff and safety review against the new head; do not approve
until that review is complete. Submit at most one approval for the reviewed
head, and do not duplicate an existing current-head approval. If membership or
the exact reviewed head cannot be verified, do not approve that PR and report
the specific verification failure. This instruction authorizes approvals
only: do not merge, comment, or reply unless Steve separately asks. Keep the
recap concise with approval outcomes and any verification or non-waivable
safety exceptions; do not add an ordinary-gate or risk inventory unless Steve
asks for more detail.

## External-contribution scope gate

Builder devs decide bounded outside contributions; Steve keeps major product
calls and new framework APIs.

For an author the membership API confirms is not a current BuilderIO member,
continue into the normal evidence sweep for a clear bug fix or a bounded
improvement. A clear bug fix corrects a specific reported or reproducible
defect by restoring intended behavior. A bounded improvement stays within one
established workflow, app, or framework area and follows the patterns already
there.

External work needs Steve when it makes a major product call (as defined under
Product and UX decisions) or adds a new framework API: a new public export,
configuration option, action, plugin or hook contract, or CLI surface in a
published package under `packages/`. A fix or bounded improvement to an existing
API stays with devs when it keeps that API's contract. If the title, issue, and
initial diff do not establish a clear bug fix or a bounded improvement, treat it
as needing Steve.

For external work that needs Steve, stop before the full code review, approval
or review action, merge-readiness disposition, author-facing draft, or merge.
Report it to Steve as **Needs Steve's approval for scope**, with the PR link,
author, stated scope, and which call it needs. Wait for Steve's explicit go-ahead on
that PR before continuing. Invoking or scheduling `review-prs`, approving a
different PR, or prior approval of another external contribution does not
authorize it. If membership is unknown, use the existing unknown-membership
policy; do not classify the author as external. The scope gate does not apply
solely because membership could not be verified. Keep the no-approval outcome,
report the missing membership check, and assess merge readiness under the
existing unknown-membership policy.

Builder devs own outside PRs end to end with `community-prs`.

## Liamdebeasi approval policy

For a PR authored by the exact GitHub login `liamdebeasi` and immutable user
ID `2721089`, always submit an approval when it is a current, non-draft PR in
`BuilderIO/agent-native`, the membership API verifies current BuilderIO
membership, and it does not already have a current-head, non-dismissed
approval; never duplicate an existing approval. This exception overrides the
ordinary check, ordinary review-feedback, scope, and UX-owner gates. It does
not override membership verification, the ultra-scary safety gate, or the
independent-review requirement for PRs changing review or approval policy,
agent-safety instructions, membership verification, or CI/deployment security
controls. Active credible safety findings remain approval-blocking. It does
not authorize a merge.

## Internal-author approval policy

The user has explicitly authorized a practical internal-author exception for
this skill:

 - For a verified current BuilderIO member, failed, pending, skipped, or
   unknown CI/check evidence does not by itself block approval. Record the
   exact state in the recap and assume the author will resolve it before merge.
 - For a verified current BuilderIO member, ordinary unresolved review
   feedback, including bot findings, does not by itself block approval. Record
   the unresolved feedback and assume it will be handled before merge.
 - These exceptions do not waive the ultra-scary safety gate below. Do not
   approve when the current diff or review evidence indicates a credible auth
   bypass, permission or tenant-isolation failure, secret or credential leak,
   destructive data loss or migration, remote code execution, SSRF, payment
   compromise, deployment compromise, or similarly severe production risk.
 - Do not claim that ignored checks are green or that ignored feedback is
   resolved. The recap must distinguish approval under the internal exception
   from a clean merge state.

When an exception requires independent review, it means a separate,
attributable, non-dismissed `APPROVED` PR review from a different verified
current BuilderIO member, submitted against the current PR head and remaining
that reviewer’s latest non-dismissed review, with no active, non-dismissed
`CHANGES_REQUESTED` review from any reviewer.
Self-review, author-stated validation, bot-only review, a
`COMMENTED`/`CHANGES_REQUESTED` review, an unverified reviewer, or
unverifiable review state does not satisfy it; without that evidence, do not
use the exception.

## Owner exceptions

The verified owner exceptions are:

 - Alice (`3mdistal`) - Content
 - Nick (`NKoech123`) - Slides
 - Shomix (`shomix`, GitHub user ID `100691266`) - any app or framework area
 - Enzo (`enzoames`) - Factory, only when the PR is specific to the Factory
   app
 - Sid (`sidmohanty11`) - Design
 - Manu (`manucorporat`) - any app or framework area

For a verified PR authored by Alice and limited to Content app or template
behavior, including supporting shared framework or Desktop plumbing required
by that Content feature, or authored by Nick and limited to Slides app
behavior, including supporting shared framework plumbing, auto-approve by
default. This includes that owner's UX changes, refactors, failed or pending
checks, and ordinary unresolved human or bot feedback. These owner exceptions
override the normal UX-owner, narrow-refactor, check, and review-resolution
gates. They do not waive the ultra-scary safety gate or the external-author
prohibition.

Treat a PR as Factory-specific only when the changed behavior is limited to
Factory app paths and Factory-owned actions, instructions, locales, or tests.
Shared framework changes that materially affect other apps, Slack ingestion,
core runtime, or deployment remain on the standard gate.

For a verified PR authored by Shomix (`shomix`, GitHub user ID `100691266`),
auto-approve by default regardless of app scope, UX implications, refactors,
failed or pending checks, or ordinary unresolved human or bot feedback. Verify
both the login and immutable GitHub user ID; do not rely on the mutable login
alone. This exception does not waive the ultra-scary safety gate, the
external-author prohibition, or the independent review requirement for PRs
changing review or approval policy, agent-safety instructions, membership
verification, or CI/deployment security controls.

For a verified PR authored by Sid, or by Enzo (`enzoames`) when the PR is
Factory-specific, auto-approve by default, including that owner's UX changes,
refactors, failed or pending checks, and ordinary unresolved human or bot
feedback. The owner exception overrides the normal UX-owner, narrow-refactor,
check, and review-resolution gates.

For a verified PR authored by Manu (`manucorporat`), auto-approve by default
regardless of app scope, UX implications, refactors, failed or pending checks,
or ordinary unresolved human or bot feedback. This exception does not waive the
ultra-scary safety gate or the external-author prohibition. Changes to review or
approval policy, agent safety instructions, membership verification, or
CI/deployment security controls require independent review and are not eligible
for this exception.

For a verified PR authored by `shawnmcclelland`, auto-approve by default
regardless of app scope, UX implications, refactors, failed or pending checks,
or ordinary unresolved human or bot feedback. This exception does not waive the
ultra-scary safety gate, the external-author prohibition, or the independent
review requirement for changes to review or approval policy, agent safety
instructions, membership verification, or CI/deployment security controls.

For a verified PR authored by `kapunahelewong` or Wes (`bwreid`), auto-approve
by default when the PR is docs-only. Docs-only means documentation content,
localizations, docs navigation or redirects, and docs-specific tests, with no
runtime app behavior, actions, database, credentials, workflows, deployment,
or other production-code change. This docs exception also overrides the
normal UX-owner, narrow-refactor, check, and review-resolution gates.

All owner and docs exceptions still require current BuilderIO membership and
do not waive the ultra-scary safety gate or the external-author prohibition.
A PR involving preview execution, credential routing, tenant isolation,
destructive data behavior, or another potentially severe security boundary
needs an explicit ultra-scary assessment before approval.

## Standard approval gate

This is the default gate; the explicit blanket approval instruction above takes
precedence when invoked.

For verified internal authors who do not qualify for a verified owner or docs
exception, approve only when all of the following are true after applying the
internal-author policy:

1. The PR is in `BuilderIO/agent-native` and the author is a verified current
   BuilderIO organization member.
2. It fixes a clear, repo-owned issue with a narrow root-cause change. The
   evidence supports the changed boundary, and the PR does not encode one
   chat report as a brittle global prompt or situation-specific rule.
3. There is no ultra-scary concern involving security, auth, permissions,
   secrets, data loss, destructive migrations, remote code execution, SSRF,
   payments, deployment safety, or an unexplained dependency/infrastructure
   change.
4. The scope and affected behavior are understood. Escalate unresolved major
   product or UX decisions as described below. Owner exceptions govern whether
   to submit an approval review; they do not block a ready merge.

Do not approve external authors, unverified authors, or internal PRs whose
remaining concern is ultra-scary. A clean-looking diff is not enough when the
owner, runtime behavior, or release state is uncertain.

## Product and UX decisions

Assess product and UX impact from the actual diff, not just filenames. This
includes visible copy, layout, navigation, controls, settings, interaction,
loading states, accessibility behavior, and user-facing defaults. A major
decision changes a core workflow, navigation or information architecture,
product defaults or permissions, or behavior across apps. If that decision is
not already settled by Steve's written direction, flag it to Steve and do not
merge until he decides. A routine bug fix or bounded improvement within an
established workflow is not a major decision.

Keep the PR thread silent while a product, UX, or app-owner decision is
unresolved. Do not comment or reply to request, announce, or explain that the
decision is needed; record the gate only in the recap. This remains true after
an author update, so do not send a thanks-only or status-only reply while the
decision is pending.

The app-owner map is for approval exceptions only; an owner approval is not a
merge requirement:

 - Alice (`3mdistal`) - Content
 - Shomix (`shomix`) - Clips
 - Nick (`NKoech123`) - Slides
 - Nicholas - Analytics
 - Enzo (`enzoames`) - Factory
 - Sid (`sidmohanty11`) - Design

Verify the author's GitHub identity and affected app before applying an owner
exception. An app owner's status does not waive the ultra-scary safety gate or
the major product/UX decision above.

## Review actions

For a PR that passes the applicable gate and lacks a current-head approval,
submit one GitHub approval review pinned to the exact SHA whose complete diff
you reviewed, and record the approval URL in the recap. Create it with the
`commit_id` field on GitHub's create-review endpoint; do not omit that field or
use an approval flow that defaults to the latest head:

```bash
gh api "repos/BuilderIO/agent-native/pulls/$PR_NUMBER/reviews" \
  -f event=APPROVE \
  -f commit_id="$reviewed_head_sha"
```

Read the response and require its `commit_id` to equal
`$reviewed_head_sha`. If the request fails, the returned SHA differs, or the
live head moved after review, do not count that review as current-head evidence;
review the new head completely before retrying with its SHA. Do not duplicate
an existing current-head approval. This skill reviews other people's PRs: do
not add a tag, assignment, mention, or explanatory comment unless the current
invocation explicitly authorizes that communication on the exact PR. This does
not add a separate authorization step for replies required on the active
user's own PR under `/ship`, `/ship-now`, or `/babysit-pr`.

Bot-authored PRs, including Dependabot, are outside this skill's review and
merge scope and must remain completely untouched.

For a PR that fails an applicable approval gate, do not submit an approval
unless the explicit blanket instruction above applies. Flag the exact concern
and the evidence needed to resolve it. External or unverified authors never
receive an approval review, but their PRs can still be merged when they
meet the readiness gate below. Confirmed external PRs must also pass the
external-contribution scope gate; external work that needs a major product call
or a new framework API remains stopped at Steve's approval gate. For unknown
membership, do not apply the
external scope gate solely because verification failed; preserve the
no-approval outcome, assess readiness under the existing unknown-membership
policy, and name the missing check.

## Merge-ready disposition and handoff

For every human PR in the evidence sweep, assess readiness regardless of whether
this skill can submit an approval. Use the BuilderIO membership API; a confirmed
nonmember is external, while lookup or visibility failures leave membership
unknown. Only prepare author-facing reply drafts for authors verified as
external. Never draft a reply for a verified BuilderIO member, including a
thank-you; report requested updates in the recap instead. If membership is
unknown, do not treat the author as external or draft a reply.

Classify the PR as **Ready for Steve's final maintainer approval/merge**,
**Needs updates**, **Needs Steve's product/UX decision**, or **Cannot assess**.
Ready means the current head is sound, implementation is complete, every
required check and status context has passed, any required product, UX, or owner
input is complete, and actionable human or automated findings have a verified
fix or evidence-backed terminal disposition. Steve retains the final decision.
PRs still waiting on a required check or owner/product/UX input are not ready.
An active human `CHANGES_REQUESTED` review or unresolved actionable request
blocks readiness; resolved, superseded, or non-actionable threads do not.
Missing approval or `reviewDecision: REVIEW_REQUIRED` alone never blocks
readiness or merge. Conflicts, pending or failed required checks, active
actionable bot findings, credible safety concerns, or a material code issue
mean **Needs updates** or **Cannot assess**. Report skipped, unknown, and
non-required checks accurately; never describe them as passing.

Independent-review requirements above govern approval actions and reuse of
existing approvals; they do not create a second human-approval gate for
merging. If no eligible current-head approval supplies the existing code
assessment, inspect the complete diff and decide readiness from that evidence.

A ready disposition is a private handoff for Steve's final decision, not an
instruction to merge. Do not merge based on readiness alone. Only run the
10-minute merge gate below when Steve explicitly requests a merge for that PR.
Once all the conditions hold, record the live `headRefOid`; they must remain
true for 10 consecutive minutes on that same head:

 - every status context required by branch protection or an applicable
   repository ruleset is satisfied on the recorded head according to GitHub's
   merge rules. Record the actual conclusion; count `neutral` or `skipped` only
   when GitHub treats that result as satisfied. Pending, failed, and unknown
   contexts are not satisfied. Every other applicable merge requirement (such
   as a required deployment) must also be satisfied;
 - every actionable review finding has a verified fix or terminal disposition;
 - the PR is `MERGEABLE` with no conflicts;
 - the same recorded `headRefOid` remains unchanged for the entire 10-minute
   interval, and all checks and review dispositions apply to that head.

Reset the 10-minute gate after a push, failed check, new actionable feedback,
new commit, or merge conflict. Do not treat this skill or a ready disposition
as standing merge authorization. GitHub's
`--admin` merge is a broad protection bypass, not one scoped to human approval.
Use it only after verifying that missing human approval or
`REVIEW_REQUIRED` is the sole unsatisfied requirement, all other applicable
protections are satisfied, and no merge queue is required. Revalidate the
exact live head and all requirements immediately before invoking it. If any
non-review requirement is pending, failed, unknown, or unsatisfied, do not use
`--admin`; wait for that requirement. When no queue is required and the gate
holds, use the guarded admin merge:

This revalidation is client-side, not atomic with GitHub's admin merge.
`--match-head-commit` protects the PR head SHA but does not pin status
conclusions or ruleset configuration. Re-read active protections and required
contexts for the exact head in one final pass, then invoke the merge immediately.
If that evidence changes or cannot be read, stop and restart the gate. This
leaves a narrow time-of-check/time-of-use window inherent in the admin merge
API; it never authorizes merging with a known failed, pending, or unknown
non-review requirement.

```bash
gh pr merge <number> --repo BuilderIO/agent-native --squash --admin \
  --match-head-commit <verified-head-oid>
```

If an applicable ruleset requires a merge queue, do not use `--admin`. After
the same readiness gate holds, enqueue the exact head through GitHub's queue:

```bash
gh pr merge <number> --repo BuilderIO/agent-native --auto --squash \
  --match-head-commit <verified-head-oid>
```

Verify the queue entry's PR head against the recorded head with
`pullRequest { id headRefOid mergeQueueEntry { state position pullRequest { headRefOid } headCommit { oid } } }`.
Keep `mergeQueueEntry.pullRequest.headRefOid` equal to the recorded PR head;
track `mergeQueueEntry.headCommit.oid` separately as the merge-group candidate
used for queue checks. `--match-head-commit` only gates the enqueue request; it
does not pin a later auto-merge or queue entry to that SHA.

Whenever a gate reset occurs after a queue entry or auto-merge request is
active, immediately dequeue any active queue entry and disable any active
auto-merge request, then verify both `mergeQueueEntry` and `autoMergeRequest`
are absent. This applies to every reset cause, including a head change, failed
check, new actionable feedback, new commit, or merge conflict. Re-review the
changed head or feedback and enqueue again only after the full 10-minute gate
passes. Never leave a stale readiness decision queued to merge.

```bash
gh api graphql -F id='<pull-request-node-id>' -f query='mutation($id: ID!) { dequeuePullRequest(input: { id: $id }) { mergeQueueEntry { state } } }'
gh pr merge <number> --repo BuilderIO/agent-native --disable-auto
```

Use the dequeue mutation only when a queue entry exists and `--disable-auto`
only when auto-merge is enabled. Do not report the PR merged until its state is
`MERGED`, then verify the merge commit is an ancestor of `origin/main`. If the
queue cannot proceed solely because a human approval is required, report that
queue/approval policy conflict to Steve; do not send the PR to another reviewer
or bypass the queue.

When Steve explicitly asks to merge, `REVIEW_REQUIRED` alone is not a reason to
wait for another reviewer; use the guarded admin merge only if all conditions
above hold. After the command, re-query the PR for its merged state and merge commit, fetch
`origin/main`, and verify that commit is an ancestor of `origin/main`. Report a
merge only after that verification; otherwise report the actual pending or
not-merged state. If the head or another gate changes, restart the gate. Merge
only if Steve explicitly requested it for this PR and no code or author action
is needed; otherwise report its private readiness disposition.

For every verified external PR needing a code update or evidence necessary to
assess a material behavior change, draft a concise reply that names the concrete
change or evidence requested and links the relevant review thread or check when
useful. Before drafting, inspect
the PR timeline, commits, and review threads for all actionable requests from
the exact login `steve8708`. If any request remains unaddressed, do not draft or
post another author-facing comment. In particular, if the latest PR activity is
Steve asking for an update and no later contributor reply or relevant commit
addresses it, mark the PR as waiting and do not add another comment. A
contributor commit or substantive reply clears only the requests it actually
addresses; an unrelated commit or bare acknowledgment does not. Mark the PR as
waiting on the contributor and link each outstanding request. Once all prior
requests are addressed, reassess the current head and draft only the remaining
code or screenshot requests. This also applies when another comment or bot
event is newer than Steve's request; bot activity alone does not reopen the
handoff.

On a contributor-owned PR, do not draft a follow-up unless the author has made
a substantive update since Steve's last message. Begin a first reply by
thanking the author for the PR; if replying after an author update, begin by
thanking them for that update. Never write “I have no further feedback” or
another vague closing. State the disposition, the exact next action, and who
owns it. If a product, UX, or app-owner decision is still needed, do not post
an author-facing status comment or ask the author to get that review; keep the
thread silent and report the decision gate in the recap. Never comment that a
product owner needs to review the PR. For a contributor thread paused by an
unresolved gate, an internal decision does not count as an author update, and
an author update made while the decision is pending does not qualify for a
follow-up. Keep the thread silent until the decision is resolved and the author
makes a substantive update after resolution; then thank them for that update
and state the resolved disposition, exact next action, and owner. This
contributor-update gate does not govern review feedback on the active user's
own PR; follow the own-PR review-update rule in `ship`.

Readiness is an internal disposition for Steve's final decision. Never post a
public PR comment saying a change is “ready for maintainer approval and merge,”
“ready for maintainer review,” or equivalent; Steve is the maintainer. Keep
the thread silent while required product, UX, or owner input is pending, and
report that gate only in the private recap.

If no prior Steve request is awaiting an update and this would be Steve's first
comment on that PR, begin the draft with a warm thank-you that tags the author
using the exact GitHub `author.login` from the live PR metadata, for example:

```text
Thanks for the PR, @username!

Couple requests. Can you please [make the specific update] so [the intended
behavior or outcome] is preserved?
```

Replace `username` with the PR author's actual login and the bracketed text with
the evidence-backed request; do not use a display name, guess the handle, or
leave placeholders in the draft. Put the thank-you on its own line, then state
the concrete request in a friendly, conversational way (for example, "Couple
requests. Can you please ...?"). Keep the technical request specific,
actionable, and supported by the diff or source evidence; ask for a regression
test when appropriate to the code change rather than as a blanket requirement.
For a follow-up after an author update, thank them for that update rather than
repeating the first-contact thanks. Do not draft a duplicate request when an
existing Steve comment already covers it; link or summarize that request
instead. Drafts are for the user to review and are never posted by this skill
unless the current invocation explicitly authorizes posting.

For a material UX change, inspect the PR body and conversation for screenshots
of the changed product UI and report which surface changed. A missing screenshot
alone does not block a routine fix or bounded improvement; request visual
evidence only when it is needed to assess a material behavior change. A recap
graphic or demo clip is not a screenshot of the changed UI. If the PR has no
user-facing UI change, say so.

If GitHub is unavailable before the diff, body, and conversation can be
inspected, report UX evidence as **Unknown / unable to inspect**; do not infer
that the PR has no UI change.

Do not apply author-reply or screenshot requests to PRs that were auto-approved
under an explicit exception; keep their existing recap and approval behavior
unchanged.

Measure this handoff with `pr-review-handoff`; first-contact thanks with
`feedback-reply-tone`, and reply-detail corrections with
`feedback-reply-detail`. Verify the latter with
`node scripts/agent-friction-report.mjs --weeks 2 --pattern feedback-reply-detail`.

## Worktrees and PR provenance

A worktree-created branch is a normal, valid PR source. Do not ask an agent to
copy its changes into the shared checkout before reviewing or approving. Read
the remote PR diff as the source of truth. If this skill needs to update a PR
from a worktree, keep all GitHub and Git commands in that worktree's cwd and
current branch, batch all currently known actionable fixes into one complete
snapshot, and publish it with `corepack pnpm ship:push -m` plus a subject
naming the actual fix (for example, `fix: deduplicate chat start checkpoints`).
The helper refuses an omitted or generic subject. Update the existing PR
instead of creating a second one. Never reset, rebase, stash, or overwrite
local work without explicit authorization.

During review-only work, do not sync `origin/main`. During an explicitly
authorized `/ship` for the same PR, follow that skill's safe-sync rule: merge
fresh `origin/main` for a confirmed conflict or a failing required check fixed
there, after verifying the exact live head and a clean task-owned worktree.
Use a normal merge for shared branches. Never sync just to clear a behind
count or restart checks.

## End-of-run recap

For a full review sweep, end with a succinct row for every human PR that entered
the evidence sweep, including approved, flagged, external, duplicate, already
handled, and unavailable cases. Include the PR link, author and membership
result, review disposition, merge result, UX/screenshot status, relevant issue
or source link, checks or review links, and the reason. In private recaps,
describe a ready PR as **Ready for your final approval** or equivalent. For each
non-auto-approved external PR that needs an update or screenshot, include its
draft reply in a separate section, or mark it waiting on the contributor with
a link to Steve's outstanding request. For internal PRs, report the needed
update or screenshot without drafting an author-facing reply. Do not add rows
for bots, `steve8708`, drafts, or external PRs assigned to a BuilderIO member;
those are ignored completely.

If Steve asks only which PRs are ready to merge, return only the candidate list
with short reasons. Do not include PRs waiting on required checks or product,
UX, or owner input, or a full status report for other PRs. If Steve asks for a
blanket internal-member approval, give a concise list of approvals and any
verification exceptions; do not add a risk inventory unless he asks for one.

Use this shape:

```md
## PR review

| PR | Author / org status | Review disposition | Merge readiness | Merge result | UX / screenshot | Author-facing reply | Why and evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [#123](...) | `@name` - BuilderIO member / external / unverified | Approved / Not approved / Skipped | Ready for Steve's final approval/merge / Needs updates / Needs Steve's decision / Cannot assess | Merged (SHA) / Waiting on 10-minute gate / Held (reason) / Not merged | Unknown / unable to inspect; No UI; UI - screenshot present or needed | Draft / Waiting on contributor / Internal - no draft / Not needed | ... |

Unavailable or unverified: ...
```

Keep the recap short, link every claim, and distinguish “not approved because
external” from “not reviewed because GitHub was unavailable.” Record the actual
merge result. Do not report a repository rule requiring human approval as a
blocker when the PR is ready and the guarded admin merge is available.

## Related skills

`concurrent-agents`, `verifying-changes`, `ship`, `babysit-pr`, `community-prs`
