---
name: review-prs
description: >-
  Review recent BuilderIO/agent-native pull requests, approve safe internal
  fixes under the internal-author and owner exceptions, skip drafts and
  already-approved PRs, and recap every disposition. Use for scheduled or
  manual PR review sweeps.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# Review Pull Requests

Review the newest relevant pull requests in `BuilderIO/agent-native`. Approve
safe fixes from verified BuilderIO organization members under the internal
author policy below. Treat approval as a trust decision, never auto-merge, and
never approve an external or unverified author.

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
 - Ignore PRs that already have a current, non-dismissed `APPROVED` review,
   including bot approvals. This exclusion applies even when the PR has newer
   commits, comments, reviews, or check results; do not re-review it or add it
   to the recap.

Only the remaining non-draft, unapproved PRs enter the evidence sweep below.

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

## Owner exceptions

The verified owner exceptions are:

 - Sid (`sidmohanty11`) - Design
 - Enzo (`enzoames`) - Factory, only when the PR is specific to the Factory
   app

Treat a PR as Factory-specific only when the changed behavior is limited to
Factory app paths and Factory-owned actions, instructions, locales, or tests.
Shared framework changes that materially affect other apps, Slack ingestion,
core runtime, or deployment remain on the standard gate.

For a verified PR authored by Sid, or by Enzo when the PR is Factory-specific,
auto-approve by default, including that owner's UX changes, refactors, failed
or pending checks, and ordinary unresolved human or bot feedback. The owner
exception overrides the normal UX-owner, narrow-refactor, check, and
review-resolution gates.

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

For verified internal authors other than the Sid owner exception, approve only
when all of the following are true after applying the internal-author policy:

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
   verified owner of every affected named app unless the Sid owner exception
   applies. Cross-app, framework-wide, or ambiguous UX changes remain flagged.

Do not approve external authors, unverified authors, or internal PRs whose
remaining concern is ultra-scary. A clean-looking diff is not enough when the
owner, runtime behavior, or release state is uncertain.

## UX exception and app owners

Detect UX implications from the actual diff, not only filenames. UX includes
visible copy, layout, density, navigation, controls, settings, interaction,
loading states, accessibility behavior, and user-facing defaults.

The current app-owner map is:

 - Alice - Content
 - Milos - Clips
 - Nicholas - Slides and Analytics
 - Enzo (`enzoames`) - Factory
 - Sid (`sidmohanty11`) - Design

Verify the author's GitHub identity and the affected app. A cross-app,
framework-wide, or ambiguous UX change has no standard app-owner exception and
must be flagged unless the verified Sid owner exception applies. An app
owner's status does not waive the ultra-scary safety gate.

## Review actions

For a PR that passes the applicable gate, submit one GitHub approval review and
record the approval URL in the recap. Do not add a tag, assignment, mention,
or explanatory comment unless the invocation explicitly asks for it.

For a PR that fails any applicable gate, do not submit an approval. Flag the
exact concern and the evidence needed to resolve it. External PRs may be
inspected and recapped, but never approved. If GitHub or organization
membership is unavailable, preserve the no-approval outcome and name the
missing check.

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
