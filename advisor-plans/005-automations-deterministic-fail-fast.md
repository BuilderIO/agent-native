# Plan 005: Make automations' unimplemented "deterministic" mode fail fast at define time

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md` — unless a reviewer dispatched you and told you
> they maintain the index.
>
> **Drift check (run first)**: `git diff --stat f1c6e017bc..HEAD -- packages/core/src/triggers .agents/skills/automations/SKILL.md packages/core/docs/content/automations.mdx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW — validation tightening on an already-non-functional path
- **Depends on**: none
- **Category**: direction (no-op option cleanup; fail-fast fix)
- **Planned at**: commit `f1c6e017bc`, 2026-07-10

## Why this matters

The `manage-automations` agent tool advertises a `mode` choice of
`"agentic" | "deterministic"`, the agent-facing skill documents both as real,
and `define` happily persists `deterministic` and confirms to the user
"Automation … created … in deterministic mode." But the dispatcher has never
implemented deterministic execution: every matching event is silently skipped
with only a server-side `console.warn`. The public doc already admits this
("reserved but not yet implemented — automations that set it are skipped") —
the tool schema and skill do not. Net effect: a user can ask for a
deterministic automation in natural language, get a success confirmation, and
have it never fire, with no user-visible error. This is the incumbent-automation
failure mode ("silent failures") the product strategy explicitly positions
against. The fix is to make creation fail fast with an actionable error until
the mode is actually built.

## Current state

Verified at commit `f1c6e017bc`:

- `packages/core/src/triggers/actions.ts` (the `manage-automations` tool):
  - `:117` — define persists the mode:
    `mode: args.mode === "deterministic" ? "deterministic" : "agentic",`
  - `:134` — success message:
    `` return `Automation "${name}" created. Fires ${summary} in ${meta.mode} mode.`; ``
  - `:268-273` — tool schema advertises the option with no caveat:
    `enum: ["agentic", "deterministic"]`, description `'"agentic" (full agent
    loop, can use tools) or "deterministic" (fixed actions only). Used by
    define.'`
- `packages/core/src/triggers/dispatcher.ts:283-295` — `handleEvent` only
  dispatches when `meta.mode === "agentic"`; the else branch is:

  ```ts
  } else {
    console.warn(
      `[triggers] Deterministic mode not yet implemented for "${resource.path}" — skipping`,
    );
  }
  ```

- `packages/core/src/triggers/types.ts:18-19` — type contract:
  `/** "agentic" = full runAgentLoop. "deterministic" = fixed action set. */`
  `mode: "agentic" | "deterministic";`
- `.agents/skills/automations/SKILL.md:64` — skill table row presents the
  mode as real: `| \`mode\` | \`"agentic" \| "deterministic"\` | Full agent
  loop vs. fixed action set |`
- `packages/core/docs/content/automations.mdx:122` — the public doc already
  discloses honestly: `"deterministic" is reserved but not yet implemented —
  automations that set it are skipped. Use "agentic" for all current
  automations.` The 10 locale copies
  (`packages/core/docs/content/locales/*/automations.mdx`) contain matching
  text (all 10 mention "deterministic").
- Repo conventions: publishable-package source changes (`packages/core`)
  require a `.changeset/*.md`; `.agents/skills/*` may be synced — after
  editing a skill run `pnpm guard:workspace-skills` and, if it fails,
  `pnpm sync:workspace-skills`.

**Design decision baked into this plan** (do not relitigate): keep
`"deterministic"` in the schema enum and the persisted type — removing it
would hard-break any existing stored automations and any callers passing it —
but **reject it at define/update time** with an actionable error. Implementing
real deterministic execution is a separate, future design task.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Typecheck core | `pnpm --filter @agent-native/core typecheck` | exit 0 |
| Triggers tests | `pnpm --filter @agent-native/core exec vitest --run src/triggers --passWithNoTests` | all pass |
| Skill sync check | `pnpm guard:workspace-skills` | exit 0 |
| Format | `pnpm fmt` | exit 0 |

## Scope

**In scope** (the only files you should modify/create):
- `packages/core/src/triggers/actions.ts`
- The triggers test file(s) — extend the existing spec beside the code
  (`ls packages/core/src/triggers/*.spec.ts`; if none exists, create
  `packages/core/src/triggers/actions.spec.ts` modeled on a neighboring
  core spec)
- `.agents/skills/automations/SKILL.md` (one-line caveat on the `mode` row)
- `.changeset/<new-file>.md` (create)
- `advisor-plans/README.md` (status row update only)

**Out of scope** (do NOT touch, even though they look related):
- `packages/core/src/triggers/dispatcher.ts` — keep the warn-and-skip branch
  as defense in depth for automations persisted before this change.
- `packages/core/src/triggers/types.ts` — the type stays; stored rows may
  carry it.
- `packages/core/docs/content/automations.mdx` and its locale copies — the
  doc is already accurate; only touch if the error-message wording you ship
  contradicts it.
- Implementing deterministic execution itself.

## Git workflow

- Stay on the current branch. This repo explicitly prohibits creating,
  switching, or otherwise moving branches unless the operator asks for that
  exact operation.
- Do NOT commit or push unless the operator instructed it. Never add
  `Co-Authored-By` or agent attribution to any commit.

## Steps

### Step 1: Reject `deterministic` in define and update

In `packages/core/src/triggers/actions.ts`, locate the define path (the
`mode:` assignment at `:117`) and the update path (the `args.*` handling
around `:152-156` — read the enclosing function to find whether `mode` is
updatable; if update never touches `mode`, guard only define). Before
persisting, add:

```ts
if (args.mode === "deterministic") {
  return (
    'Deterministic mode is reserved but not yet implemented — automations ' +
    'that set it would never fire. Create the automation with mode ' +
    '"agentic" instead (the default), and describe the exact fixed steps ' +
    "in the automation body."
  );
}
```

Match how the surrounding code reports user-facing errors: read the
neighboring validation branches in the same function first — if they `throw`
or return a structured error object instead of a string, use that form. (Repo
guard `guard:no-error-string-returns` exists: if returning a plain string
error violates it, use the thrown/structured form the guard expects.)

Also update the tool schema description at `:271` to:
`'"agentic" (full agent loop, can use tools). "deterministic" is reserved and
not yet implemented — define/update will reject it.'` Keep the enum as is.

**Verify**: `pnpm --filter @agent-native/core typecheck` → exit 0

### Step 2: Tests

Add tests covering:
1. define with `mode: "deterministic"` → rejected with the actionable
   message; no trigger resource is persisted (assert via the same
   store/listing the existing triggers tests use).
2. define with `mode: "agentic"` (and with mode omitted) → still succeeds.
3. If update supports `mode`: update to `deterministic` → rejected.

**Verify**: `pnpm --filter @agent-native/core exec vitest --run src/triggers --passWithNoTests` → all pass, including the new tests

### Step 3: Align the skill

In `.agents/skills/automations/SKILL.md` line ~64, change the `mode` row
description to note the mode is reserved/not yet implemented and that define
rejects it. Then run the sync check.

**Verify**: `pnpm guard:workspace-skills` → exit 0 (run
`pnpm sync:workspace-skills` first if it fails, then re-check)

### Step 4: Changeset and format

Create `.changeset/<descriptive-name>.md` with a `patch` bump for
`@agent-native/core`: "manage-automations now rejects the unimplemented
deterministic mode at define time instead of silently never firing." Run
`pnpm fmt`.

**Verify**: the changeset file exists; `pnpm fmt:check` passes on modified
files

## Test plan

Step 2's three cases, in the existing triggers spec (or a new
`actions.spec.ts` beside it, modeled on the nearest core spec file's setup).
The regression being prevented: a persisted-but-never-firing automation with
a success confirmation. Final gate: `pnpm test:fast` passes.

## Done criteria

- [ ] Define (and update, if applicable) rejects `mode: "deterministic"` with
      an actionable message; agentic/default flows unchanged
- [ ] Tool schema description discloses the rejection; enum unchanged
- [ ] New tests pass; `pnpm test:fast` exits 0
- [ ] `pnpm guard:workspace-skills` exits 0
- [ ] A `.changeset/*.md` for `@agent-native/core` exists
- [ ] No files outside the in-scope list modified (`git status --porcelain`)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Deterministic execution has been implemented in
  `packages/core/src/triggers/dispatcher.ts` since this plan was written (the
  warn-and-skip branch is gone) — the right fix then is the opposite
  (advertise it), not a rejection.
- The define/update handler's error-reporting convention is unclear after
  reading its neighbors AND `guard:no-error-string-returns` fails on your
  change — report the conflict instead of suppressing the guard.
- You find other persisted-but-dead options in the same schema while working
  (don't fix them here; list them in your report).

## Maintenance notes

- When deterministic mode is actually built, remove the define-time rejection
  and the schema caveat in the same change that implements the dispatcher
  path, and update `automations.mdx:122` plus its 10 locale copies — that
  future change is where the doc edits belong.
- Reviewers should check the rejection message matches whatever error surface
  the chat UI renders for tool errors (actionable text, not a stack trace).
- Deferred deliberately: designing what "fixed action set" execution means —
  that is a real direction question (a deterministic runner is the natural
  substrate for the one-click template catalog's simplest recipes) and
  deserves its own design doc if pursued.
