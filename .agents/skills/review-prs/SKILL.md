---
name: review-prs
description: >-
  Review recent BuilderIO/agent-native human pull requests, apply internal
  auto-approval exceptions, and assess other PRs for merge readiness, requested
  updates, external reply drafts, and UI screenshot evidence. Use for scheduled
  or manual PR sweeps.
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

 - Ignore human PRs only when their current, non-dismissed `APPROVED` review
   targets the current PR head and no newer commit, comment, review, or check
   result exists. A current-head approval does not suppress re-review after a
   later event; do not add the PR to the recap unless that re-review changes
   its disposition.

Only the remaining non-draft, unapproved human PRs enter the ordinary
evidence sweep below. Eligible Liam PRs with only older-head approvals also
enter the sweep so the current head can be approved.

For every PR you inspect, read:

 - the title, body, linked issue, and source links;
 - the complete changed-file list and diff, including generated or migration
   files;
 - all current human and bot review summaries, inline comments, and replies;
 - required checks, their actual conclusions, and whether any lane is pending,
   skipped, unknown, or failing;
 - the repository ownership and the affected app or framework boundary.

Use the GitHub organization membership API to verify that the author is a
member of `BuilderIO`. Do not infer internal status from a display name, email,
company claim, branch name, `authorAssociation`, or a familiar-looking bot.
If membership cannot be verified, do not approve. External authors are never
auto-approved, even when the patch looks safe or the issue is obviously valid.

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
4. The scope and ownership are unambiguous. UX implications still require the
   verified owner of every affected named app unless a verified owner exception
   applies. Cross-app, framework-wide, or ambiguous UX changes remain flagged.

Do not approve external authors, unverified authors, or internal PRs whose
remaining concern is ultra-scary. A clean-looking diff is not enough when the
owner, runtime behavior, or release state is uncertain.

## UX exception and app owners

Detect UX implications from the actual diff, not only filenames. UX includes
visible copy, layout, density, navigation, controls, settings, interaction,
loading states, accessibility behavior, and user-facing defaults.

The current app-owner map is:

 - Alice (`3mdistal`) - Content
 - Shomix (`shomix`) - Clips
 - Nick (`NKoech123`) - Slides
 - Nicholas - Analytics
 - Enzo (`enzoames`) - Factory
 - Sid (`sidmohanty11`) - Design

Verify the author's GitHub identity and the affected app. A cross-app,
framework-wide, or ambiguous UX change has no standard app-owner exception and
must be flagged unless a verified owner exception applies. An app owner's
status does not waive the ultra-scary safety gate.

## Review actions

For a PR that passes the applicable gate, submit one GitHub approval review and
record the approval URL in the recap. Do not add a tag, assignment, mention,
or explanatory comment unless the invocation explicitly asks for it.

Bot-authored PRs, including Dependabot, are outside this skill's review and
merge scope and must remain completely untouched.

For a PR that fails any applicable gate, do not submit an approval. Flag the
exact concern and the evidence needed to resolve it. External PRs may be
inspected and recapped, but never approved or auto-merged. If GitHub or
organization membership is unavailable, preserve the no-approval outcome and
name the missing check.

## Non-auto-approved PR handoff

For every human PR that does not receive an approval under the policies above,
including external PRs, provide a maintainer handoff in addition to the approval
disposition. A merge-readiness recommendation is separate from a GitHub
approval or merge action: this skill never merges a PR, and external authors
remain ineligible for approval. Use the BuilderIO membership API; a confirmed
nonmember is external, while lookup or visibility failures leave membership
unknown. Only prepare author-facing reply drafts for authors verified as
external. Never draft a reply for a verified BuilderIO member, including a
thank-you; report requested updates or missing UX evidence in the recap
instead. If membership is unknown, do not treat the author as external or
draft a reply.

Classify the PR as **Ready to merge by Steve's bar**, **Needs updates**,
**Ready on code and CI; screenshot requested**, or **Cannot assess**. Recommend
ready only when the current head looks sound, every required check has passed,
and actionable human or automated review findings have a verified fix or an
evidence-backed terminal disposition. An active human `CHANGES_REQUESTED`
review or unresolved actionable human request blocks readiness; resolved,
superseded, or non-actionable threads do not. Do not treat missing human
approval or `reviewDecision: REVIEW_REQUIRED` alone as a blocker to Steve's readiness
recommendation. Report separately if GitHub's branch protection still blocks
the actual merge. Conflicts, pending or failed required checks, active
actionable bot findings, credible safety concerns, or an otherwise material
code issue mean **Needs updates** or **Cannot assess**. Report skipped,
unknown, and non-required checks accurately; never describe them as passing.

For every verified external PR needing a code update or screenshot evidence,
draft a concise reply that names the concrete change or evidence requested and
links the relevant review thread or check when useful. Before drafting, inspect
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

For UX evidence, inspect the actual diff for new or changed user-facing UI,
including visible copy, layout, navigation, controls, settings, interaction,
loading states, accessibility behavior, and user-facing defaults. Check the PR
body and conversation for screenshots of the changed product UI. Report which
surface changed and whether screenshots are present. If UI changed and no
product screenshot is available, mark the screenshot as requested so Steve can
review the change. Include the screenshot request in an external-author draft
only when the reply gate above allows a new comment. For internal PRs, report
the missing screenshot without drafting a comment. A generated recap graphic
or demo clip does not count as a screenshot of the changed UI. If the PR has no
user-facing UI change, say so rather than requesting screenshots.

If GitHub is unavailable before the diff, body, and conversation can be
inspected, report UX evidence as **Unknown / unable to inspect**; do not infer
that the PR has no UI change.

Do not apply these extra author-reply and screenshot asks to PRs that were
auto-approved under an explicit exception; keep their existing recap and
approval behavior unchanged.

This handoff is measured by `pr-review-handoff`; first-contact thanks also
contribute to the existing `feedback-reply-tone` measure.

## Worktrees and PR provenance

A worktree-created branch is a normal, valid PR source. Do not ask an agent to
copy its changes into the shared checkout before reviewing or approving. Read
the remote PR diff as the source of truth. If this skill needs to update a PR
from a worktree, keep all GitHub and Git commands in that worktree's cwd and
current branch, publish the complete nonignored snapshot with
`corepack pnpm ship:push`, and update the existing PR instead of creating a
second one. Never reset, rebase, stash, or overwrite local work without
explicit authorization.

## End-of-run recap

Every run ends with a succinct row for every human PR that entered the evidence
sweep, including approved, flagged, external, duplicate, already handled, and
unavailable cases. Include the PR link, author and membership result, review
disposition, merge-readiness recommendation, UX/screenshot status, relevant
issue or source link, checks or review links, and the reason. For each
non-auto-approved external PR that needs an update or screenshot, include its
draft reply in a separate section, or mark it waiting on the contributor with
a link to Steve's outstanding request. For internal PRs, report the needed
update or screenshot without drafting an author-facing reply. Do not add rows
for bots, `steve8708`, drafts, or human PRs excluded because they already had
an approval; those are ignored completely.

Use this shape:

```md
## PR review

| PR | Author / org status | Review disposition | Merge readiness | UX / screenshot | Author-facing reply | Why and evidence |
| --- | --- | --- | --- | --- | --- | --- |
| [#123](...) | `@name` - BuilderIO member / external / unverified | Approved / Not approved / Skipped | Ready by Steve's bar / Ready on code and CI; screenshot requested / Needs updates / Cannot assess | Unknown / unable to inspect; No UI; UI - screenshot present or needed | Draft / Waiting on contributor / Internal - no draft / Not needed | ... |

Unavailable or unverified: ...
```

Keep the recap short, link every claim, and distinguish “not approved because
external” from “not reviewed because GitHub was unavailable.” Also distinguish
the review disposition from merge readiness, and distinguish product-code or
CI blockers from a repository rule requiring human approval. A PR can be
**Ready to merge by Steve's bar** while GitHub still reports a human-review
requirement; state that restriction without treating it as a required review
for Steve's recommendation.

## Related skills

`concurrent-agents`, `verifying-changes`, `ship`, `babysit-pr`
