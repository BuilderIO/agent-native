---
name: delegating-work
description: >-
  Which tier — main thread vs. a cheaper subagent — owns a piece of work,
  decided at the moment you're about to start it. Use before writing an
  implementation yourself, driving a browser, babysitting a PR, running a
  test/fix loop, or doing a mechanical multi-file sweep on the main thread.
scope: dev
metadata:
  internal: true
---

# Delegating Work

## Activation guard

Use this at the moment you're about to start a multi-step task yourself —
before the first line of code, the first browser action, the first CI poll,
or the first test run. It applies whenever the main thread is about to *do*
work, not just when the user says "parallelize this."

Skip it for a genuinely single small edit with nothing independent to split
off — spawning overhead would exceed the work itself.

## Do NOT do this on the main thread

Each of these is a real temptation, not a hypothetical — they're the
single most-repeated correction the user gives, most recently today
(2026-07-31):

- **Writing the implementation yourself** because the change "looks quick." Spawn
  a coding subagent even for a small fix; the main thread reviews the diff, it
  doesn't produce it. *"Hmm why are you coding on the main thread? You're
  supposed to spawn cheaper models like sonnet to write the code."*
- **Driving the browser yourself** for a UI check or E2E pass. Spawn a subagent
  to run Playwright / Chrome DevTools MCP and report back. *"use cheaper sub
  agents for testing ... don't use fable (you) for browser automation bro"*
- **Babysitting a PR yourself** (polling CI, pushing fixups). Spawn a subagent to
  watch and fix. *"please use a cheaper model to do the babysitting - like
  sonnet. not you"*
- **Running the test/fix retry loop yourself.** Spawn a subagent to run tests,
  read failures, patch, and re-run until green. *"i prefer to use terra sub
  agents for testing/fixing and not use you, the main thread, for these
  things like i see you doing rn"*
- **Doing a mechanical multi-file sweep yourself** (renames, lint fixes, the
  same small edit repeated across files). Split by file set, one subagent per
  slice.
- **Skipping delegation "just this once"** because the task feels urgent. Cost
  is the reason to delegate, not an excuse to skip it. *"this run is getting
  really expensive ... fable model is now per-token pricing so this is
  costing me thousands"*

## Decision table

| Kind of work | Tier |
| --- | --- |
| Planning, architecture, ambiguity calls | Main thread |
| Synthesis / final review of subagent output | Main thread |
| Talking to the user | Main thread |
| Writing an implementation slice | Cheap subagent |
| Browser automation / E2E verification | Cheap subagent |
| PR babysitting (CI polling + fixups) | Cheap subagent |
| Test-fix-retry loops | Cheap subagent |
| Mechanical sweeps (rename, lint, repeated edit) | Cheap subagent(s), one per disjoint file set |
| Research / repo scans / docs extraction | Cheap subagent |

Default to the cheapest tier that can do the work reliably — Haiku for
bulk/mechanical work, Sonnet for anything needing real coding judgment.
Reserve the expensive/frontier model for the main-thread row above. This is a
standing instruction: don't ask the user for permission to parallelize.

## What the main thread keeps

Planning, prioritization, ambiguity resolution, integrating what subagents
return, final review before the user sees it, and all direct conversation
with the user. Everything else in this table is a delegation candidate by
default, not an exception.

## Parallel edits are the intended pattern, not a risk

This repo has exactly one collision guard: `scripts/hooks/file-lease.mjs`. It
denies a write only when another live session leased the same file in the
last 15 minutes, or the file changed on disk since your session last wrote
it. Parallel subagents editing disjoint files is normal and expected here —
give each subagent its own file set up front so leases never collide, and let
the hook catch the rare real overlap instead of avoiding parallelism to be safe.

## Related skills

This skill is the decision point; it doesn't replace the workflows that
follow it:

- `efficient-frontier` — the orchestration workflow once you've decided to
  delegate: handoff packets, fan-out limits, the review loop.
- `efficient-fable` — the same workflow, plus Fable's per-token pricing as a
  reason it matters even more.
- `delegate-to-agent` — the briefing contract (objective / context / output /
  boundaries) and fan-out discipline (cap ~3, default to one) for spawning a
  sub-agent from the main thread.
