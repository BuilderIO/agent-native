---
name: address-feedback
description: >-
  Go through a feedback list (Notion, Google Doc, Linear, GitHub issue, pasted
  notes) and fix the real bugs, propose small UX changes, and flag the rest.
  Use when someone shares a feedback link or paste and says "address this
  feedback", "fix the bugs in this doc", or runs /address-feedback. For Slack
  feedback channels use review-latest-feedback; for specific Slack threads use
  address-feedback-with-replies.
scope: dev
metadata:
  internal: true
---

# Address Feedback

Take a pile of feedback, fix what is objectively broken, verify it, and report
back briefly. Lean toward fixing, but don't agree with every suggestion or
bundle unrelated cleanups. If no link or text was given, ask for it. Use the
matching connector (Notion, Drive, Linear, `gh`, Slack) rather than scraping
authenticated pages. Slack reactions and replies follow `review-latest-feedback`.

## 1. Read it and check for repeats

Read the whole source, including comments, screenshots, and linked recordings.
The error text in a screenshot is often the diagnosis.

Then check whether it was reported before; the same defect gets filed weeks
apart by different people, and one came back fifteen times. Search three months
back: the source, Sentry, Analytics errors, and merged PR titles, using the
feature name, error text, and surface separately.

- No earlier report: carry on.
- Earlier report, no fix: say how long it has been open.
- Earlier report, fix landed: a regression. Find why the first fix stopped
  holding and leave a test of the user's path that fails if it breaks again.

## 2. Sort each item

Checklist each item: symptom, expected behavior, evidence, owning surface.

- **Bug:** broken behavior, crash, wrong or lost data, dead link, API mismatch,
  captured exception, and objective visual defects such as clipped or
  overlapping text, bad contrast, or a broken layout. Separate the observed
  failure from the reporter's proposed remedy; fix the failure even if the
  remedy is out of scope.
- **UX proposal:** adding, moving, hiding, or restyling controls, or anything
  "hard to find". These are product calls. Don't build them on your own; write
  the proposal (what changes, why, the tradeoff) and flag it for a person. A
  proposal Steve has explicitly approved (such as an `:upvote:`) is a request to
  build the smallest version.
- **Unclear:** you've read everything and one concrete detail still blocks a
  safe fix.
- **Out of scope:** praise, chatter, other repos, intentionally unsupported.
  Note it and move on.

For data, permissions, or lifecycle feedback, check the whole capability before
calling it UX: does the action exist when a control is missing, and do owner,
shared, and non-owner access behave? Use safe fixtures, never another user's
production data. Possible cross-user exposure is a security bug.

## 3. Ask only when you must

Before asking the reporter anything, read the full thread and every accessible
attachment, and list what is already known: surface, repro, exact error, run
IDs. Never ask for something already there. If someone in the thread already
named the cause, fixed it, or is fixing it, verify that and continue instead of
asking again. If a run ID is given, inspect that run first.

When one specific detail still blocks the fix, ask one plain question, and
only one pending question per thread. Don't ask a subjective question just to
choose between plausible designs.

## 4. Check error sources

When it smells like an error, search Sentry (org `builder-io`) and Analytics
`list-error-issues` / `get-error-issue` by route, stack symbol, and error text.
Cite the match and its source. An unreadable source is "unavailable", never
"no match"; don't invent matches or repro steps.

## 5. Choose the fix altitude

Name the smallest invariant that explains the report and the boundary that owns
it.

- One isolated report: fix the local seam and add a focused regression check.
- Repeated or cross-surface reports: look at the shared primitive or contract,
  once you've confirmed they fail the same way.
- Missing capability or wrong tool: fix discovery, the registry, or the action
  contract rather than coaching the agent around the gap.
- Source works but live differs: check build, deploy, and version state first.

Never turn one data point into a global agent rule.

## 6. Fix and verify

Reproduce first where you can, keep each fix narrow and mapped to an item, and
add a focused test when the risk warrants it. Verify as `verifying-changes` describes: a test that fails before and passes
after, or the flow working in the running app. For UI, look at the real screen
with a browser tool you already have; don't script browser automation for a
small fix. Reading the code is not verification.

For approved UX work, make the smallest change that clarifies the current state
or next step: remove competing elements before adding controls or text, and put
secondary actions in a menu or popover. Read `frontend-design`.

## 7. Report

Reply with a status, not an implementation report: one plain line per item, no
file paths, PR numbers, or test counts unless asked:

```md
## Feedback Status
- <item> - Fixed. It will be on beta shortly after it merges.
- <item> - Needs a person: <what's needed, from whom>.
- <item> - Needs your answer: <one question>.
- <item> - Not planned.
```

Don't say Fixed until it's verified.
