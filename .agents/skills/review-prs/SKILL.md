---
name: review-prs
description: >-
  Review recent BuilderIO/agent-native human pull requests, approve eligible
  internal PRs, and merge changes that are ready by Steve's bar. Use for
  scheduled or manual PR sweeps; flag unresolved major product or UX decisions
  to Steve.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# Review Pull Requests

Review the newest relevant human pull requests in `BuilderIO/agent-native`.
Approve safe fixes from verified BuilderIO organization members under the
internal author policy below. Treat approval as a trust decision. Never
approve an external or unverified author.

Approval and merge readiness are separate. A **Ready to merge by Steve's bar**
result means merge the PR under the guarded merge procedure below. Do not hand
it off because `REVIEW_REQUIRED` is set, the author is external, or another
human approval is absent. Escalate only unresolved major product or UX
decisions to Steve.

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

 - For remaining human PRs, read the current review summary to determine
   whether the PR already has a current, non-dismissed `APPROVED` review.

 - Reuse that review as the code assessment only after verifying the reviewer
   is a different, current BuilderIO member and is eligible under the PR's
   author- and scope-specific rules, including any independent-review
   requirement. An unknown or ineligible reviewer never suppresses a full diff
   review. A valid approval suppresses duplicate code review only while no
   newer commit, comment, review, or check result exists; the PR still enters
   the merge-readiness pass and recap.

All remaining non-draft human PRs enter the evidence sweep below. For
PRs with a verified eligible current-head approval and no newer event, skip
duplicate code review but check merge readiness and merge when ready. Eligible
Liam PRs with only older-head approvals enter the sweep so the current head can
be reviewed.

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

Inspect repository rulesets as well as branch protection. List them with
`gh api repos/BuilderIO/agent-native/rulesets`, then inspect each matching
`/rulesets/<id>` definition's `conditions.ref_name` and
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
submit one GitHub approval review and record the approval URL in the recap.
Do not duplicate an existing current-head approval. Do not add a tag,
assignment, mention, or explanatory comment unless the invocation explicitly
asks for it.

Bot-authored PRs, including Dependabot, are outside this skill's review and
merge scope and must remain completely untouched.

For a PR that fails an approval gate, do not submit an approval. Flag the exact
concern and the evidence needed to resolve it. External or unverified authors
never receive an approval review, but their PRs can still be merged when they
meet the readiness gate below. If GitHub or organization membership is
unavailable, preserve the no-approval outcome and name the missing check.

## Merge-ready disposition and handoff

For every human PR in the evidence sweep, assess readiness regardless of whether
this skill can submit an approval. Use the BuilderIO membership API; a confirmed
nonmember is external, while lookup or visibility failures leave membership
unknown. Only prepare author-facing reply drafts for authors verified as
external. Never draft a reply for a verified BuilderIO member, including a
thank-you; report requested updates in the recap instead. If membership is
unknown, do not treat the author as external or draft a reply.

Classify the PR as **Ready to merge by Steve's bar**, **Needs updates**,
**Needs Steve's product/UX decision**, or **Cannot assess**. Ready means the
current head is sound, every required check and status context has passed, and
actionable human or automated findings have a verified fix or evidence-backed
terminal disposition.
An active human `CHANGES_REQUESTED` review or unresolved actionable request
blocks readiness; resolved, superseded, or non-actionable threads do not.
Missing approval or `reviewDecision: REVIEW_REQUIRED` alone never blocks
readiness or merge. Conflicts, pending or failed required checks, active
actionable bot findings, credible safety concerns, or a material code issue
mean **Needs updates** or **Cannot assess**. Report skipped, unknown, and
non-required checks accurately; never describe them as passing.

A ready disposition is an instruction to merge, not a recommendation to hand
off. Keep this review sweep in the foreground for a 10-minute merge gate. Once
all the conditions hold, record the live `headRefOid`; they must remain true
for 10 consecutive minutes on that same head:

 - every status context required by branch protection or an applicable
   repository ruleset reports success on the recorded head, including contexts
   published by GitHub Actions and other integrations, and every other
   applicable merge requirement (such as a required deployment) is satisfied;
 - every actionable review finding has a verified fix or terminal disposition;
 - the PR is `MERGEABLE` with no conflicts;
 - the same recorded `headRefOid` remains unchanged for the entire 10-minute
   interval, and all checks and review dispositions apply to that head.

Reset the 10-minute gate after a push, failed check, new actionable feedback,
new commit, or merge conflict. This skill itself authorizes the guarded merge;
do not hand off to standalone `babysit-pr` or wait for another approval. The
admin merge may bypass only a missing human PR approval or
`REVIEW_REQUIRED`; do not use it to bypass any other applicable protection
requirement. When the gate holds, revalidate the exact live head and use the
guarded admin merge:

```bash
gh pr merge <number> --repo BuilderIO/agent-native --squash --admin \
  --match-head-commit <verified-head-oid>
```

`REVIEW_REQUIRED` alone is not a reason to wait for another reviewer or ask
Steve to click Merge. This skill's standing authorization covers that merge.
After the command, re-query the PR for its merged state and merge commit, fetch
`origin/main`, and verify that commit is an ancestor of `origin/main`. Report a
merge only after that verification; otherwise report the actual pending or
not-merged state. If the head or another gate changes, restart the gate. If no
code or author action is needed and the PR is otherwise ready, merge it.

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

If no prior Steve request is awaiting an update and this would be Steve's first
comment on that PR, begin the draft by thanking the contributor. Do not repeat
a thank-you on a follow-up. Do not draft a duplicate request when an existing
Steve comment already covers it; link or summarize that request instead.
Drafts are for the user to review and are never posted by this skill unless
the current invocation explicitly authorizes posting.

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

This handoff is measured by `pr-review-handoff`; first-contact thanks also
contribute to the existing `feedback-reply-tone` measure.

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

Rebase or merge `origin/main` only when GitHub reports an actual conflict; for
a shared branch, prefer a normal merge. Never sync just to clear a behind
count or restart checks.

## End-of-run recap

Every run ends with a succinct row for every human PR that entered the evidence
sweep, including approved, flagged, external, duplicate, already handled, and
unavailable cases. Include the PR link, author and membership result, review
disposition, merge result, UX/screenshot status, relevant issue or source link,
checks or review links, and the reason. For each
non-auto-approved external PR that needs an update or screenshot, include its
draft reply in a separate section, or mark it waiting on the contributor with
a link to Steve's outstanding request. For internal PRs, report the needed
update or screenshot without drafting an author-facing reply. Do not add rows
for bots, `steve8708`, or drafts; those are ignored completely.

Use this shape:

```md
## PR review

| PR | Author / org status | Review disposition | Merge readiness | Merge result | UX / screenshot | Author-facing reply | Why and evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [#123](...) | `@name` - BuilderIO member / external / unverified | Approved / Not approved / Skipped | Ready by Steve's bar / Needs updates / Needs Steve's decision / Cannot assess | Merged (SHA) / Waiting on 10-minute gate / Held (reason) / Not merged | Unknown / unable to inspect; No UI; UI - screenshot present or needed | Draft / Waiting on contributor / Internal - no draft / Not needed | ... |

Unavailable or unverified: ...
```

Keep the recap short, link every claim, and distinguish “not approved because
external” from “not reviewed because GitHub was unavailable.” Record the actual
merge result. Do not report a repository rule requiring human approval as a
blocker when the PR is ready and the guarded admin merge is available.

## Related skills

`concurrent-agents`, `verifying-changes`, `ship`, `babysit-pr`
