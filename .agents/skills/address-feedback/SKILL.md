---
name: address-feedback
description: >-
  Triage feedback from docs, issues, Slack threads, or pasted notes into
  verified bugs, UX proposals, unclear questions, and skipped noise. Use when a
  user asks you to address product feedback or investigate a reported workflow.
scope: dev
metadata:
  internal: true
---

# Address Feedback

Use this skill when the user shares a feedback document, issue, thread, or pasted notes and asks you to address the feedback.

The default posture is judgment plus action: fix clear, verified bugs you agree with; propose UX changes with rationale; skip or flag low-signal, unclear, or out-of-scope items.

## Choose the fix altitude

Before coding, name the smallest invariant that explains the report and the
boundary that owns it. Use the evidence to choose the altitude:

- One isolated report -> fix the local seam and add a focused regression check.
- Repeated or cross-surface reports -> consider the shared primitive or
  contract, but only after confirming the reports share the same failure mode.
- Missing capability or wrong tool -> fix discovery, the registry, or the
  action contract rather than coaching the agent around the gap.
- Source behavior differs from the reported live behavior -> check the build,
  deploy, and version state before changing code.

Do not turn one data point into a global agent rule. For subjective feedback,
state the underlying invariant and wait for repeated evidence before broadening
it. Keep a concrete local fix when it solves the reported boundary; the goal is
the right abstraction, not the most general one.

## Prerequisites

- If no link or feedback text is provided, ask for it.
- Read the repo `AGENTS.md` before touching code.
- Use the relevant connector/plugin/skill for the source when available, instead of scraping authenticated pages.
- Before starting work, search available task history and local Git/PR metadata for the exact feedback link or issue identifiers. Reuse existing work instead of creating a duplicate fix.

## Steps

1. Read the feedback source.

   | Source | Reader |
   | --- | --- |
   | Notion link | Notion connector or Notion skill |
   | Google Docs/Drive link | Google Drive connector or Google Docs skill |
   | Linear link | Linear connector if installed; otherwise ask for pasted content |
   | GitHub issue or PR | GitHub connector or `gh issue view` / `gh pr view` |
   | Slack thread | Slack connector |
   | Public URL | Web browsing |
   | Pasted text | Read directly |

   Use web browsing only for public URLs. Auth-gated docs usually need their matching connector. For threads, read the parent and all replies; note when there are no replies, and inspect linked files or newer follow-ups when the source refers to them. Check every linked artifact that is accessible, but track permission-gated, expired, or otherwise unreadable artifacts separately from evidence that is absent. Before asking for clarification, write down the evidence already present across the parent, replies, attachments, and linked artifacts. Ask only for a detail that remains absent, or for access/a fresh replacement when an inaccessible artifact is the actual blocker, using casual, collaborative wording rather than a terse demand.

2. Check whether this defect has already been reported.

   A feedback channel holds months of reports and nobody remembers all of them,
   so the same defect gets filed by different people weeks apart and every
   filing reads as new. One recorded case: the same Clips recording bug was
   filed almost word-for-word 29 days apart by the same reporter, and neither
   message mentions the other. Another defect was reported fifteen times by
   nine people across three months, was announced as fixed once in the middle,
   and was reported again two weeks later.

   Search before fixing, going back at least three months: the source channel
   in the reporter's words and in your own, Sentry, and merged PR titles. Search
   the feature name, the error text, and the surface separately — repeat reports
   rarely share vocabulary.

   - **No prior report** — proceed normally.
   - **Prior report, no fix landed** — say how long it has been open. The person
     forwarding it to you is likely seeing it for the second time too.
   - **Prior report, fix landed** — this is a regression, and the bar is now
     different. Patching it again and reporting done is exactly how it returns a
     third time. Find why the first fix stopped holding, and leave behind
     something that fails when it breaks again: a test that reproduces the
     user's path, or an assertion in the flow the report names.

   Report the repeat explicitly, with dates and reporters. A defect on its third
   report is not a bug ticket, it is a missing check — and the missing check is
   the deliverable, not the patch.

3. Decompose and categorize every actionable item.

   Build a compact checklist before changing code. For each item, record the
   symptom, expected behavior, evidence, and owning surface: UI, action/tool,
   data model, provider/runtime, or product policy.

   - **Bug**: Broken behavior, crash, wrong data, dead link, package/API mismatch, or captured exception. Verify and fix when you agree.
   - **UX suggestion**: Design, discoverability, workflow, or feature feedback. Propose the cleanest version first unless the user explicitly asked you to implement UX changes.
   - **Question or unclear**: Missing detail, contradictory feedback, or behavior you cannot inspect. Ask or flag it.
   - **Out of scope**: Outside this repo, already shipped, intentionally unsupported, or too low-signal. Note briefly and skip.

   A clarification request is valid only after a fresh full-thread read. Check
   the parent, every reply, attachments, and linked runs for the URL, surface,
   repro, exact error, screenshot, and IDs before asking. Keep inaccessible
   linked evidence separate from evidence that is absent; if the inaccessible
   artifact is needed, ask for access or a fresh/replacement link rather than
   asking for information already contained there. If a later reply supplies
   one of those fields, re-read the thread and use the new evidence; never
   repeat a question that the thread already answered. Thank the reporter by
   name when it is available, and phrase the ask as help needed to investigate
   - for example, a deck URL and/or request ID. When useful, point out that at
   the end of chat they can hit the three dots and share the request ID if that
   option is available, without making it sound mandatory.

4. For data, permissions, or resource-lifecycle feedback, verify the whole capability boundary before calling it UX.

   - Check the supported create/read/update/delete lifecycle, including whether the backend/action exists when a UI control is missing.
   - Inspect both the UI and the shared action/tool surface so agent and UI behavior stay in parity.
   - Verify scope semantics such as owner/private, organization, shared, and public access. Test owner and non-owner paths with safe fixtures or read-only checks; never use another user's production data to test access.
   - Treat possible cross-user or cross-organization exposure as a security/correctness bug and verify it before proposing polish.
   - Keep undefined product policy separate from implementation bugs. If supported source types or scope semantics are not defined, flag the contract question instead of inventing behavior.

5. Check Sentry when the feedback smells like an error.

   - Use the Sentry skill/plugin if available, or the repo's Sentry scripts if documented.
   - Search by route, stack symbol, error text, and symptom keywords.
   - Default org is `builder-io` unless the user specifies another.
   - Cite issue IDs or links when you find a match.
   - If nothing matches, say that plainly.

## Fix-altitude gate

Before editing a verified bug, choose the narrowest seam supported by the
evidence:

- One isolated report -> fix the owning local seam and add a regression check.
- Repeated or cross-surface evidence -> inspect the shared primitive or
  contract before patching a leaf.
- Missing capability or wrong tool -> fix discovery, registry, or action-contract
  wiring.
- Source-vs-live mismatch -> diagnose build/deploy state before changing source.
- Do not turn one data point into a global agent instruction. For subjective
  feedback, name the invariant and require repeated evidence before broadening
  it.

6. Fix only the clear bugs you agree with.

   - Verify before fixing: reproduce locally, read the relevant code, inspect logs, or confirm with a stack trace.
   - Keep each fix narrow and mapped to a feedback item.
   - Follow existing project conventions and nearby patterns.
   - Do not switch branches, stash, reset, force-push, or open a PR unless the user asks.
   - Add or update focused tests when the bug risk warrants it.

7. Treat UX feedback with product judgment.

   Do not add visible UI as the default response. Address the underlying user
   problem first, then choose the smallest change that makes the current state,
   decision, action, or recovery path clearer.

   - Make the current intent, state, and meaningful next step easier to find.
   - Remove competing or redundant elements before adding controls, helper
     text, banners, top-level navigation, or always-open panels.
   - Put secondary or advanced actions in a `DropdownMenu`, `Popover`, `Sheet`,
     `Collapsible`, tabs, or another contextual surface. Keep essential meaning,
     labels, focus, hit targets, and recovery in the default path.
   - Improve empty, loading, and error states around the user's actual need.

   When the user has corrected the same visual preference more than once, treat
   it as an acceptance criterion for the surface, not as a one-off copy edit.
   State the underlying invariant before coding, such as “the default state
   makes one next decision obvious and defers secondary detail,” then check the
   rendered result against it. A screenshot showing unrelated forms, repeated
   explanatory copy, documentation links, or competing controls in the default
   state fails the review. Subtract that competition instead of explaining the
   UI with more copy.

   When proposing a UX change, write it as: what to change, why it helps, and the tradeoff. Keep each proposal short.

8. Verify changed behavior.

   - Run the smallest relevant test or typecheck command.
   - For UI fixes, inspect the actual screen with a browser tool you already
     have. Do not write a browser-automation script to check a small fix.
   - For resource visibility or lifecycle changes, verify both the screen and
     shared action/tool behavior, including owner versus non-owner access when
     relevant.
   - If you cannot run a useful verification, record the reason internally. In
     the user-facing reply, use only "[plain-language item] - Verification
     pending. Timing not confirmed yet." unless the user explicitly asks why.

## User-Facing Reply

Keep the outward reply to a status update, not an implementation report. The
technical investigation, reproduction details, test results, file names, and
internal reasoning stay internal unless the user explicitly asks for them.

For every actionable item, use a plain-language label and one short status:

- For a requested change: **Fixed** or **Not fixed yet**.
- For an unclear request: **Needs clarification**.
- For a declined, skipped, or out-of-scope request: **Not planned** or **Not in
  scope**.
- For any item that still needs verification: **Verification pending**.

Add one timing phrase to every status. If the current ship is expected to
finish that day and the completed fix is confirmed to be included in that
ship, use "Expected live by EOD." Otherwise use "Timing not confirmed yet."
For items that are not planned or out of scope, use "No live date." Do not
invent a release date.

If a requested change is implemented but not yet verified, use
"[plain-language item] - Verification pending. Timing not confirmed yet."
instead of **Fixed** until verification is complete.

When this skill is used by `address-feedback-with-replies`, that skill's Slack
reply states take precedence: a completed Slack thread must end as **Fixed** or
**Clarification needed**. Do not post **Not fixed yet**, **Needs clarification**,
or a bare **Verification pending** status in Slack. Ask one concrete,
plain-language clarification question only when reporter or product input is
missing. **Clarification needed** is the one timing exception: do not give a
live estimate until the question is answered and the fix is complete. If only
internal test, deployment, or tooling verification is unavailable, keep that
blocker internal, do not post an external Slack status yet, and resume the
thread after verification is available. Do not turn it into a reporter
question. Keep the no-technical-details rule in all cases.

Use this format:

```md
## Feedback Status
- [plain-language item] - Fixed. Expected live by EOD.
- [plain-language item] - Not fixed yet. Timing not confirmed yet.
- [plain-language item] - Needs clarification. Timing not confirmed yet.
- [plain-language item] - Not planned. No live date.
```

Do not include implementation details, technical explanations, file paths,
line numbers, test counts, PR numbers, worktree names, stack traces, or
internal labels in the user-facing reply. Do not add separate sections for
bugs, UX suggestions, skipped items, or technical evidence. Keep each item to
one short sentence.

## Avoid

- Do not agree with every suggestion by default.
- Do not bundle unrelated cleanups.
- Do not implement UX changes that make an important screen busier without explicit user approval.
- Do not claim a UI change is done without browser verification when a local app can be run.
- Do not invent Sentry matches, affected users, or reproduction steps.
- Do not expose the technical details used to verify or implement the work unless the user asks for them.

## Related Skills

- `github:gh-address-comments` for GitHub PR review threads.
- `github:gh-fix-ci` for failing GitHub checks.
- `sentry:sentry` for production error investigation.
- `frontend-design` for approved UI implementation work.
- `qa` for broader browser verification.
