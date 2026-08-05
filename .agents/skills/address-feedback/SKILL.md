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

   Use web browsing only for public URLs. Auth-gated docs usually need their matching connector. For threads, read the parent and all replies; note when there are no replies, and inspect linked files or newer follow-ups when the source refers to them.

2. Decompose and categorize every actionable item.

   Build a compact checklist before changing code. For each item, record the
   symptom, expected behavior, evidence, and owning surface: UI, action/tool,
   data model, provider/runtime, or product policy.

   - **Bug**: Broken behavior, crash, wrong data, dead link, package/API mismatch, or captured exception. Verify and fix when you agree.
   - **UX suggestion**: Design, discoverability, workflow, or feature feedback. Propose the cleanest version first unless the user explicitly asked you to implement UX changes.
   - **Question or unclear**: Missing detail, contradictory feedback, or behavior you cannot inspect. Ask or flag it.
   - **Out of scope**: Outside this repo, already shipped, intentionally unsupported, or too low-signal. Note briefly and skip.

3. For data, permissions, or resource-lifecycle feedback, verify the whole capability boundary before calling it UX.

   - Check the supported create/read/update/delete lifecycle, including whether the backend/action exists when a UI control is missing.
   - Inspect both the UI and the shared action/tool surface so agent and UI behavior stay in parity.
   - Verify scope semantics such as owner/private, organization, shared, and public access. Test owner and non-owner paths with safe fixtures or read-only checks; never use another user's production data to test access.
   - Treat possible cross-user or cross-organization exposure as a security/correctness bug and verify it before proposing polish.
   - Keep undefined product policy separate from implementation bugs. If supported source types or scope semantics are not defined, flag the contract question instead of inventing behavior.

4. Check Sentry when the feedback smells like an error.

   - Use the Sentry skill/plugin if available, or the repo's Sentry scripts if documented.
   - Search by route, stack symbol, error text, and symptom keywords.
   - Default org is `builder-io` unless the user specifies another.
   - Cite issue IDs or links when you find a match.
   - If nothing matches, say that plainly.

5. Fix only the clear bugs you agree with.

   - Verify before fixing: reproduce locally, read the relevant code, inspect logs, or confirm with a stack trace.
   - Keep each fix narrow and mapped to a feedback item.
   - Follow existing project conventions and nearby patterns.
   - Do not switch branches, stash, reset, force-push, or open a PR unless the user asks.
   - Add or update focused tests when the bug risk warrants it.

6. Treat UX feedback with restraint.

   Do not solve UX problems by adding more visible controls, helper text, banners, top-level nav, or always-open panels by default. Prefer cleaner interaction models:

   - Make the existing primary action more discoverable.
   - Remove competing elements so the right action stands out.
   - Move secondary actions into `DropdownMenu`, `Popover`, `Sheet`, `Collapsible`, or tabs.
   - Improve empty states around one clear action.
   - Use progressive disclosure for optional or advanced controls.

   When proposing a UX change, write it as: what to change, why it helps, and the tradeoff. Keep each proposal short.

7. Verify changed behavior.

   - Run the smallest relevant test or typecheck command.
   - For UI fixes, inspect the actual screen with a browser tool you already
     have. Do not write a browser-automation script to check a small fix.
   - For resource visibility or lifecycle changes, verify both the screen and
     shared action/tool behavior, including owner versus non-owner access when
     relevant.
   - If you cannot run a useful verification, say why.

## Report Format

Keep the final report short:

```md
## Bugs Fixed
- [feedback item] - [what changed, file:line]

## Bugs Flagged But Not Fixed
- [feedback item] - [why]

## UX Suggestions
- [feedback item] -> [proposed change]

## Skipped
- [feedback item] - [reason]
```

Only include sections that have content. The user can read the diff; do not write a second feedback document.

## Avoid

- Do not agree with every suggestion by default.
- Do not bundle unrelated cleanups.
- Do not implement UX changes that make an important screen busier without explicit user approval.
- Do not claim a UI change is done without browser verification when a local app can be run.
- Do not invent Sentry matches, affected users, or reproduction steps.

## Related Skills

- `github:gh-address-comments` for GitHub PR review threads.
- `github:gh-fix-ci` for failing GitHub checks.
- `sentry:sentry` for production error investigation.
- `frontend-design` for approved UI implementation work.
- `qa` for broader browser verification.
