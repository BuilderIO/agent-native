---
name: review-prs
description: >-
  Review recent BuilderIO/agent-native pull requests, auto-approve only safe
  clear fixes from verified BuilderIO members, and recap every disposition.
  Use for scheduled or manual PR review sweeps.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# Review Pull Requests

Review the newest relevant pull requests in `BuilderIO/agent-native`. Approve
only a clear, safe fix from a verified BuilderIO organization member. Treat
approval as a narrow trust decision, not as a signal to approve everything
recent or everything authored by a collaborator. Never auto-merge.

## Selection and evidence

List open PRs newest by creation or update time, then inspect the latest
Agent-Native work first. Include recent PRs from internal team members even if
their branch name does not contain a product name. Re-review a PR when it has a
new commit, review, comment, or check result; otherwise do not create duplicate
review noise.

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

## Approval gate

Approve only when every condition below is true:

1. The PR is in `BuilderIO/agent-native` and the author is verified as a
   current BuilderIO organization member.
2. It fixes a clear, repo-owned issue with a narrow root-cause change. The
   evidence supports the changed boundary, and the PR does not encode one
   chat report as a brittle global prompt or situation-specific rule.
3. The relevant focused tests and required checks are conclusively green.
   Do not approve with pending, skipped, unknown, or failed required evidence.
4. All actionable review comments are addressed or a clear resolution is
   visible in the current diff. Do not approve a PR with unresolved concerns.
5. There is no unresolved concern involving security, auth, permissions,
   secrets, data loss, destructive migrations, payments, deployment safety,
   generated artifacts, or an unexplained dependency or infrastructure change.
6. The scope and ownership are unambiguous. A PR with a material concern is
   flagged for Steve, not approved.

Do not approve refactors, speculative features, ambiguous behavior changes,
unverified fixes, or a patch whose main evidence is a single subjective
request. A clean-looking diff is not enough when the owner, runtime behavior,
or release state is uncertain.

## UX exception and app owners

Detect UX implications from the actual diff, not only filenames. UX includes
visible copy, layout, density, navigation, controls, settings, interaction,
loading states, accessibility behavior, and user-facing defaults.

If a PR has UX implications, do not auto-approve it unless its author is the
verified owner of every affected named app and the change is otherwise fully
safe. The current app-owner map is:

 - Alice - Content
 - Milos - Clips
 - Nicholas - Slides and Analytics

Verify the author's GitHub identity and the affected app. A cross-app,
framework-wide, or ambiguous UX change has no app-owner exception and must be
flagged for Steve. If the author is not the owner of an affected app, flag it.
An app owner's status does not waive the safety, evidence, check, or review
gates above.

## Review actions

For a PR that passes the complete gate, submit one GitHub approval review and
record the approval URL in the recap. Do not add a tag, assignment, mention,
or explanatory comment unless the invocation explicitly asks for it.

For a PR that fails any gate, do not submit an approval. Flag the exact concern
and the evidence needed to resolve it. External PRs may be inspected and
recapped, but never approved. If GitHub or organization membership is
unavailable, preserve the no-approval outcome and name the missing check.

## Worktrees and PR provenance

A worktree-created branch is a normal, valid PR source. Do not ask an agent to
copy its changes into the shared checkout before reviewing or approving. Read
the remote PR diff as the source of truth. If this skill needs to update a PR
from a worktree, keep all GitHub and Git commands in that worktree's cwd and
current branch, stage owned paths explicitly, and update the existing PR
instead of creating a second one. Never reset, rebase, stash, or absorb peer
paths from a shared checkout.

## End-of-run recap

Every run ends with a succinct row for every PR inspected, including approved,
flagged, external, duplicate, already handled, and unavailable cases. Include
the PR link, author and membership result, decision, the relevant issue or
source link, checks or review links, and the reason. Do not omit a PR because
no action was taken.

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
