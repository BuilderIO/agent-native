---
name: fix-at-the-boundary
description: >-
  How to find every sibling instance of a reported bug before fixing it. Use
  whenever a bug report names one file but the defect is a call pattern,
  hook, duplicated literal, or copy-pasted helper that plausibly exists in
  other files, apps, or templates.
scope: dev
metadata:
  internal: true
---

# Fix at the Boundary

## Activation guard

Use this skill when a reported bug's root cause is a **pattern** — a function
shape, a write sequence, a device/permission check, a duplicated literal, a
copy-pasted helper — rather than a fact unique to the one file named in the
report.

If the bug is genuinely local (a typo, a value that only makes sense for that
one app, a one-time data fix), say so explicitly — "this is local to
`<file>`, no sweep needed" — and skip the rest of this skill. Don't sweep as
theater.

### Do NOT skip the sweep in these situations

- "The report only names one file, I'll patch that and move on." A stale-diff
  write race, a mic-device resolution order, a missing scoped-access check —
  these are usually copy-pasted everywhere the same operation is implemented.
- "I found 3 callers and fixed those, that's probably all." Enumerate every
  hit from the search *before* editing anything — stopping at the first few
  you notice is how instances 4–9 survive.
- "Grepping the whole repo will take too long." A few `rg` calls take
  seconds; rediscovering the same fix across four more user reports doesn't.
- "This looks like the same bug in an area I don't own, but that's not what I
  was asked to fix." Still enumerate it — just don't edit it (see below).
- "I fixed the shared helper, callers will pick it up automatically." Only
  true if every sibling actually calls it — confirm with the same search.

## Workflow

1. **Derive the fingerprint from the symptom**, not the file: the exact
   function/hook name, the anti-pattern shape (read stale state → write
   without re-checking), a literal string, or an import path.
2. **Search before editing:**
   ```bash
   # exact call/hook, whole repo
   rg -n "computeDiffBase\(|stashLocalDiffBase\(" --type ts -g '!**/node_modules/**'
   # duplicated literal (device id, action name, config key)
   rg -n "'design-native-asset'" -g '*.ts' -g '*.tsx'
   # same shape copy-pasted across template apps
   rg -n "getUserMedia" templates/*/app templates/*/src 2>/dev/null
   ```
   Widen the pattern (drop args, add `-C 3`, try a sibling term like
   `diffBase` vs `diff_base`) until confident no caller phrases it slightly
   differently.
3. **Enumerate every hit before touching any file** — write the list in your
   response so step 5 is checkable.
4. **Decide where the fix lives.** A shared helper some callers bypass →
   fix the helper and point bypassers at it. No shared helper and N ≥ 3
   duplicate sites → consider extracting one instead of pasting a 4th time.
5. **Apply the fix to every in-scope hit.**

### Ownership boundaries

Enumerating isn't editing. A hit inside a path this task's `DO NOT TOUCH`
list assigns to another agent gets listed as found-but-out-of-scope and
flagged via `spawn_task` or a direct note — never silently edited or
silently dropped. See **concurrent-agents**.

## Reporting the sweep

Report the full blast radius, not just what you changed:

```
Fixed the stale-diff-base race in:
- insert-design-native-asset.ts (as reported)
- insert-asset.ts, apply-a11y-fix.ts, generate-design.ts (same pattern)
Found but out of scope (owned by another agent this task): apply-visual-edit.ts
in templates/design/** — flagged via spawn_task.
No other callers of computeDiffBase().
```

## Why this exists

- "apply-visual-edit.ts has the same stale-diff-base write-race bug that was
  just fixed in insert-design-native-asset.ts, insert-asset.ts,
  apply-a11y-fix.ts ... and generate-design.ts" — one defect, 9 files, fixed
  one report at a time instead of once.
- Mic-device resolution was independently fixed in four different Clips
  surfaces (`useMediaDevices.ts`, `media-capture-constraints.ts`,
  `offscreen.ts`, `recorder-engine.ts`).
- "i want to make sure universally cmd+click works ... can we do a quick
  sweep of other apps" — the user had to ask for a sweep across 4 templates
  that should have happened proactively.
- "remember - if any other apps like in our core repo templates/ does this
  wrong, fix that too" — exists only because the first fix didn't already
  answer it.

## Related Skills

- **concurrent-agents** — why an out-of-scope sibling gets flagged, not edited.
- **adding-a-feature** — the four-area checklist a proper fix should satisfy.
