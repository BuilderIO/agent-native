# Plan 003: Spike `agent-native doctor` — ship the framework's code-safety guards to generated apps

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md` — unless a reviewer dispatched you and told you
> they maintain the index.
>
> **Drift check (run first)**: `git diff --stat f1c6e017bc..HEAD -- scripts/run-guards.ts scripts/guard-*.mjs scripts/guard-*.ts packages/core/src/cli/index.ts packages/core/src/cli/upgrade.ts packages/core/src/templates/default/package.json`
> If any of these changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M (this spike; the CLI implementation it specifies is M)
- **Risk**: LOW — read-only classification producing a design document
- **Depends on**: none
- **Category**: direction (design/spike)
- **Planned at**: commit `f1c6e017bc`, 2026-07-10

## Why this matters

The framework's core pitch is agent-authored and agent-modified app code. This
monorepo protects itself from the failure modes of that model with 20 CI
guard scripts — several written in response to real production incidents (the
`guard-no-unscoped-queries.mjs` header documents the 2026-04-28 slides
cross-tenant data leak that motivated it). But none of these guards ship to
apps *built with* the framework: a third-party team gets the security skills
as prose guidance for their coding agent and no automated check that the
agent followed them. An unscoped multi-tenant query or a hardcoded credential
in a customer app is exactly the bug class these guards catch — and exactly
the class an autonomous agent is most likely to introduce. Packaging the
generic subset as an `agent-native doctor` command turns a monorepo-internal
safety net into a product feature that differentiates the framework on its
riskiest surface.

## Current state

Verified at commit `f1c6e017bc`:

- `scripts/run-guards.ts:4-25` — the guard roster (20 entries):
  `no-drizzle-push`, `no-unscoped-queries`, `no-env-credentials`,
  `no-unscoped-credentials`, `no-env-mutation`, `no-localhost-fallback`,
  `google-auth-redirects`, `db-tool-scoping`, `template-list`,
  `netlify-private-env`, `workspace-skills`, `public-packages`,
  `no-generated-artifacts`, `extension-no-public`, `no-one-off-mcp-app-html`,
  `i18n-catalogs`, `plan-skills`, `plan-marketplace`,
  `no-error-string-returns`, `no-action-twin-routes`. Each maps to a
  `guard:<name>` script in the root `package.json`, implemented as
  `scripts/guard-*.mjs` or `scripts/guard-*.ts`.
- `scripts/guard-no-unscoped-queries.mjs:1-40` — representative of the
  high-value generic guards: a per-statement static scan that refuses queries
  against `ownableColumns()` tables lacking
  `accessFilter`/`resolveAccess`/`assertAccess`/explicit owner filters, with
  an opt-out marker comment (`// guard:allow-unscoped — short reason`). Its
  header documents both the originating incident and a subsequent
  false-negative fix — this is mature, battle-tested logic.
- `packages/core/src/templates/default/package.json` — the scaffolded app's
  scripts are `dev`, `build`, `start`, `typecheck`, `action`, `script`,
  `skills:update`, `upgrade:agent-native` — all thin wrappers over the
  `agent-native` CLI. No guard, lint, or doctor entry.
- `packages/core/src/cli/index.ts` — command dispatch is a `switch` with
  cases at lines ~533–1004 (`dev`, `build`, `start`, `action`, `agent`,
  `typecheck`, `create`, `upgrade`, `deploy`, `info`, …). A new `doctor` case
  slots in alongside these.
- `packages/core/src/cli/upgrade.ts:135` — `agent-native upgrade check|doctor`
  already exists as a subcommand producing an `UpgradeDoctorReport`
  (dependency-pin findings that can block an upgrade, `--json` output,
  non-zero exit on findings). So "doctor" as a concept already has CLI
  precedent here — the design must either extend it or cleanly coexist.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| List guard implementations | `ls scripts/guard-*` | ~20 files |
| Read a guard | `sed -n 1,60p scripts/guard-<name>.mjs` | header + config |
| See what paths a guard scans | `grep -n "templates/\|packages/\|process.cwd\|glob" scripts/guard-<name>.mjs \| head` | its path assumptions |
| Existing doctor precedent | `sed -n 120,160p packages/core/src/cli/upgrade.ts` | check/doctor arg parsing |
| Confirm no source changes | `git status --porcelain -- . ':!advisor-plans'` | empty output |

## Scope

**In scope** (the only files you may create or modify):
- `advisor-plans/reports/003-doctor-design.md` (create — the deliverable)
- `advisor-plans/README.md` (status row update only)

**Out of scope** (do NOT touch):
- Everything else. Do NOT implement the CLI command, do NOT move or edit
  guard scripts, do NOT modify the default template.

## Git workflow

- Stay on the current branch. This repo explicitly prohibits creating,
  switching, or otherwise moving branches unless the operator asks for that
  exact operation.
- Do NOT commit or push unless the operator instructed it. Never add
  `Co-Authored-By` or agent attribution to any commit.

## Steps

### Step 1: Classify all 20 guards

Read every `scripts/guard-*.{mjs,ts}` file (at minimum its header comment and
its path/config assumptions). Classify each as:
- **Generic** — checks an invariant any agent-native app should hold (e.g.
  `no-unscoped-queries`, `no-env-credentials`, `no-drizzle-push`,
  `no-error-string-returns`, `no-action-twin-routes` are likely candidates);
- **Monorepo-only** — checks repo-release invariants (e.g. `template-list`,
  `public-packages`, `plan-skills`, `plan-marketplace`, `workspace-skills`,
  `netlify-private-env` are likely candidates);
- **Conditional** — generic in concept but with monorepo-specific path or
  config assumptions that need parameterizing (note exactly which lines).

Do not trust the "likely candidates" above — verify each by reading the
script.

**Verify**: report has a "Classification" table with all 20 guards, one
verdict + one evidence line each.

### Step 2: Specify the `doctor` command

Design `agent-native doctor` for a generated app:
- Invocation and flags (`--json` for CI, `--fix`? — recommend against
  auto-fix for v1), exit codes (0 clean / 1 findings / 2 execution error),
  matching the `upgrade doctor` conventions in
  `packages/core/src/cli/upgrade.ts`.
- Relationship to `upgrade doctor`: recommend one — fold upgrade checks into
  a unified `doctor` with sections, or keep them separate. State rationale.
- Where guard logic lives: today the scripts are repo files not shipped in
  the `@agent-native/core` npm package. Options: move generic guard logic
  into `packages/core/src/guards/` (imported by both the CLI and the
  monorepo's `run-guards.ts`), or duplicate (rejected — drift). Confirm what
  `packages/core/package.json` `files`/build config includes so the
  recommendation is grounded in how the package actually publishes.
- Path resolution for arbitrary app layouts (an app has `actions/`,
  `server/`, `app/` at root — confirm against
  `packages/core/src/templates/default/`).
- Opt-out conventions: keep the existing marker-comment style
  (`// guard:allow-unscoped — reason`) so agent-authored code can record
  justified exceptions the same way this repo does.
- Where it runs: scaffolded `package.json` script, `agent-native build`
  pre-step (recommend: warn-only in dev, fail in build/CI), and a line in the
  self-modifying-code guidance so app agents run doctor after editing source.

**Verify**: report has "CLI design", "Packaging", and "Integration points"
sections; the packaging recommendation cites `packages/core/package.json`
evidence.

### Step 3: Define the v1 guard set and migration

Pick the v1 set (recommend: the Generic column from Step 1, smallest useful
set — the security-critical ones first: unscoped queries, env credentials,
drizzle push, unscoped credentials, db tool scoping). For each Conditional
guard worth including, specify the exact parameterization needed. Describe how
the monorepo's `run-guards.ts` would consume the moved logic so there is one
implementation. List open questions with recommended defaults.

**Verify**: report has "V1 guard set" and "Open questions" sections; every
open question carries a recommended default.

### Step 4: Finalize the report

Write `advisor-plans/reports/003-doctor-design.md` with exactly these
top-level sections: `## Classification`, `## CLI design`, `## Packaging`,
`## Integration points`, `## V1 guard set`, `## Open questions`.

**Verify**: `grep -c '^## ' advisor-plans/reports/003-doctor-design.md` → `6`

## Test plan

No code tests — the deliverable is a design document. It must itself contain
a "Testing the doctor" subsection under `## CLI design`: how the future
implementation will be tested (fixture app trees with known violations; one
spec per guard asserting detection + opt-out marker behavior; an integration
test running `doctor --json` against `packages/core/src/templates/default`).

## Done criteria

- [ ] `advisor-plans/reports/003-doctor-design.md` exists with the six
      required sections (`grep -c '^## ' …` → 6)
- [ ] The Classification table covers all 20 guards from
      `scripts/run-guards.ts`
- [ ] The packaging recommendation is grounded in how `@agent-native/core`
      publishes (cites its package.json/build config)
- [ ] `git status --porcelain -- . ':!advisor-plans'` → empty
- [ ] `advisor-plans/README.md` status row for 003 updated

## STOP conditions

Stop and report back (do not improvise) if:

- A `doctor` case (beyond `upgrade doctor`) already exists in
  `packages/core/src/cli/index.ts` — the feature may have started since this
  plan was written.
- The guard roster in `scripts/run-guards.ts` differs from the 20 listed in
  "Current state" (drift — re-verify before classifying).
- You are tempted to implement the command or move guard files — out of scope.

## Maintenance notes

- Every future guard added to `scripts/` should be born with a
  generic/monorepo classification so the doctor set doesn't silently drift
  behind the monorepo's protections.
- Reviewers should scrutinize the false-positive story: a doctor that cries
  wolf in generated apps (whose layouts vary more than this repo's) will get
  disabled; the parameterization notes from Step 1's Conditional column are
  the key risk area.
- Deferred deliberately: auto-fix (`--fix`) and editor/LSP integration —
  worth noting in the report as future directions only.
