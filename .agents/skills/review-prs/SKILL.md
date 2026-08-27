---
name: review-prs
description: >-
  Review recent BuilderIO/agent-native pull requests, approve safe internal
  fixes under the internal-author and owner exceptions, merge safe Dependabot
  updates, skip drafts, and recap every disposition. Use for scheduled or
  manual PR review sweeps.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# Review Pull Requests

Review the newest relevant pull requests in `BuilderIO/agent-native`. Approve
safe fixes from verified BuilderIO organization members under the internal
author policy below. Treat approval as a trust decision, and merge only the
narrow Dependabot exception below. Never approve an external or unverified
author.

## Selection and evidence

List open PRs newest by creation or update time, then inspect the latest
Agent-Native work first. Include recent PRs from internal team members even if
their branch name does not contain a product name. Re-review a PR when it has a
new commit, review, comment, or check result; otherwise do not create duplicate
review noise.

Before selecting a PR for review, read only enough metadata to determine its
draft state and current review summary:

 - Ignore draft PRs completely. Do not inspect their diff, checks, reviews,
   membership, or source links; do not take any review action; and do not add
   them to the end-of-run recap.
 - Ignore ordinary PRs that already have a current, non-dismissed `APPROVED`
   review, including bot approvals. This exclusion applies even when the PR
   has newer commits, comments, reviews, or check results; do not re-review it
   or add it to the recap. A non-draft PR authored by the exact Dependabot
   login remains eligible for the merge gate below even when it already has an
   approval; do not submit a duplicate approval.

Only the remaining non-draft, unapproved PRs enter the ordinary evidence
sweep below; non-draft Dependabot candidates also enter the merge evidence
sweep even when they already have an approval.

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
 - Shomix (`shomix`) - Clips, only when the PR is specific to the Clips
   app
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

For a verified PR authored by Shomix (`shomix`) and limited to Clips app or
template behavior, including supporting shared framework or Desktop plumbing
required by that Clips feature, auto-approve by default. This includes that
owner's UX changes, refactors, failed or pending checks, and ordinary unresolved
human or bot feedback. The owner exception overrides the normal UX-owner,
narrow-refactor, check, and review-resolution gates.

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

For a non-draft PR whose GitHub author login is exactly `dependabot[bot]` (or
the exact `dependabot` login returned by GitHub), use the merge exception below
instead of the membership gate. Branch-protection approvals still apply. Do
not infer Dependabot from a title, branch name, or author association.

## Dependabot merge exception

The user has authorized this review skill to merge safe Dependabot PRs. A
qualifying Dependabot PR may skip the ordinary babysit soak, but it must still
meet branch-protection requirements. Merge it only when every condition below
is true:

1. The PR is in `BuilderIO/agent-native`, is not a draft, is mergeable with no
   conflict, and its update is patch or minor rather than a major upgrade. A
   minor update qualifies only when both its current and proposed major
   versions are at least `1`; dependencies on major version `0` are patch-only
   for this exception.
2. The complete diff changes only dependency manifests and their lockfiles.
   The manifest changes are dependency-version changes only, with no scripts,
   resolutions, package-manager/runtime, workflow, generated source, or other
   configuration edits.
3. All required checks are successful. No required lane is pending, skipped,
   neutral, unknown, failing, or unavailable, and no active review is
   `CHANGES_REQUESTED` or leaves an unresolved review thread. Any required
   approving review must be from a verified BuilderIO human member who is not
   the PR author or a bot. If it is absent, verify the approver's GitHub user
   type is `User` and `gh api orgs/BuilderIO/members/<login>` succeeds, then
   have that reviewer submit one current-head approval; do not duplicate an
   existing approval. If the approver or membership cannot be verified, flag
   the PR.
4. The dependency change has no credible auth, permission, tenant-isolation,
   secret, data-loss, remote-code-execution, SSRF, payment, deployment, or
   other ultra-scary production risk. If the dependency or diff touches one of
   those boundaries, flag it for human review.

Use the expected head SHA with `gh pr merge <number> --squash --match-head-commit <sha>`, use the normal protected merge path rather than an
admin bypass, and re-read the PR after the merge to record the merged SHA and
result. A failed or unavailable safety check means flagged, never “probably
safe.”

For a PR that fails any applicable gate, do not submit an approval. Flag the
exact concern and the evidence needed to resolve it. External PRs may be
inspected and recapped, but never approved; non-Dependabot external PRs are
never auto-merged. If GitHub or organization membership is unavailable,
preserve the no-approval outcome and name the missing check.

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

Every run ends with a succinct row for every PR that entered the evidence
sweep, including approved, flagged, external, duplicate, already handled, and
unavailable cases. Include the PR link, author and membership result, decision,
the relevant issue or source link, checks or review links, and the reason. Do
not add rows for drafts or PRs excluded because they already had an approval;
those are ignored completely.

Use this shape:

```md
## PR review

| PR | Author / org status | Decision | Why and evidence |
| --- | --- | --- | --- |
| [#123](...) | `@name` - BuilderIO member / external / unverified | Approved / Flagged / Skipped | ... |

Unavailable or unverified: ...
```

Keep the recap short, link every claim, and distinguish “not approved because
external” from “not reviewed because GitHub was unavailable.”

## Related skills

`concurrent-agents`, `verifying-changes`, `ship`, `babysit-pr`
