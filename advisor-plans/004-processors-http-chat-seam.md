# Plan 004: Thread the in-loop processor seam through the HTTP chat handler

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md` — unless a reviewer dispatched you and told you
> they maintain the index.
>
> **Drift check (run first)**: `git diff --stat f1c6e017bc..HEAD -- packages/core/src/agent/production-agent.ts packages/core/src/agent/processors.ts packages/core/docs/content/processors.mdx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW — additive option; the no-processor path must stay untouched
- **Depends on**: none
- **Category**: direction (small build plan — closes a self-documented gap)
- **Planned at**: commit `f1c6e017bc`, 2026-07-10

## Why this matters

Core ships a complete, tested in-loop processor system
(`Processor`/`ProcessorChain`/`TripWire`) — the documented substrate for
real-time guardrails: stream redaction, tool-call gating, proof-of-done
checks, abort-on-policy-violation. But the one surface end users actually hit
— the HTTP chat handler that powers every app's agent sidebar — cannot
configure processors. The gap is self-documented twice: a `TODO(processor-seam)`
in `production-agent.ts` and a callout in `processors.mdx` telling hosts to
"configure processors at the `runAgentLoop` call site for now," which for the
web chat surface means forking core. Closing this makes every documented
guardrail usable by any app without touching core internals.

## Current state

Verified at commit `f1c6e017bc`. Key locations in
`packages/core/src/agent/production-agent.ts` (a very large file — read only
the cited regions):

- `production-agent.ts:904` — `export interface ProductionAgentOptions {` —
  the host-facing options for the HTTP agent (fields like `actions`,
  `systemPrompt`, `apiKey`, `engine`, …). **No `processors` field today.**
- `production-agent.ts:2872` — `export async function runAgentLoop(opts: {…})`
  — the loop already accepts processors:
  - `:2913-2920` — doc comment + `processors?: Processor[];` ("Each processor
    can observe … processors only observe/mutate-stream/abort; they never
    define app …").
  - `:2959-2962` — `// the common (no-processors) path is unchanged and
    carries zero overhead.` / `opts.processors && opts.processors.length > 0
    ? new ProcessorChain(opts.processors) : …`
- `production-agent.ts:7561-7568` — the gap, inside the HTTP request path
  where `agentLoopOpts` is built:

  ```ts
  // TODO(processor-seam): thread `processors` from ProductionAgentOptions
  // through to runAgentLoop here once the handler exposes a way to
  // configure them (e.g. a `processors` field on ProductionAgentOptions
  // or a per-request resolver). The loop-level seam (runAgentLoop's
  // `processors` opt + ProcessorChain/TripWire) is the deliverable and is
  // already callable directly by sub-agents, A2A, MCP, and tests; this is
  // only the HTTP-handler convenience plumbing.
  const agentLoopOpts = {
    engine,
    model: effectiveModel,
    systemPrompt: requestSystemPrompt,
    ...
  ```

- `packages/core/src/agent/processors.ts` — exports `TripWire` (:40),
  `ProcessorState` (:61), `ProcessorAbort` (:64), `ProcessOutputStreamArgs`
  (:70), `ProcessOutputStepArgs` (:82), `ProcessOutputResultArgs` (:106),
  `Processor` (:117), `ProcessorChain` (:137). Tested in
  `packages/core/src/agent/processors.spec.ts`.
- `packages/core/docs/content/processors.mdx` — near line 141, a
  `<Callout id="doc-block-proc1note" tone="info">` reads: "Threading
  `processors` through the HTTP chat handler (so a per-request resolver can
  configure them without calling `runAgentLoop` directly) is convenience
  plumbing that is not yet wired — configure processors at the `runAgentLoop`
  call site for now."
- Localized copies exist for all docs:
  `packages/core/docs/content/locales/{ar-SA,de-DE,es-ES,fr-FR,hi-IN,ja-JP,ko-KR,pt-BR,zh-CN,zh-TW}/processors.mdx`.
  Repo rule: when a source doc's meaning changes, update the matching locale
  docs, or explicitly call out the locales needing follow-up.
- Repo conventions: TypeScript only; publishable-package source changes
  (`packages/core`) require a `.changeset/*.md`; run `oxfmt` on modified
  files; follow the existing pattern for per-request-resolved options —
  `systemPrompt: string | ((event) => string | Promise<string>)` at
  `production-agent.ts:909-910` is the exemplar to match for a resolver
  variant.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Typecheck core | `pnpm --filter @agent-native/core typecheck` | exit 0 |
| Processor tests | `pnpm --filter @agent-native/core exec vitest --run src/agent/processors.spec.ts` | all pass |
| Full fast tests (before finishing) | `pnpm test:fast` | all pass |
| Format | `pnpm fmt` | exit 0 |

## Scope

**In scope** (the only files you should modify/create):
- `packages/core/src/agent/production-agent.ts` (the options interface + the
  one `agentLoopOpts` site)
- `packages/core/src/agent/processors.spec.ts` OR a new
  `packages/core/src/agent/processor-seam.spec.ts` (tests)
- `packages/core/docs/content/processors.mdx` (update the callout)
- `packages/core/docs/content/locales/*/processors.mdx` (matching callout
  update — see Step 5)
- `.changeset/<new-file>.md` (create)
- `advisor-plans/README.md` (status row update only)

**Out of scope** (do NOT touch, even though they look related):
- `runAgentLoop` itself and `ProcessorChain`/`TripWire` internals — the loop
  seam is done and tested; only the handler plumbing is missing.
- Sub-agent / A2A / MCP invocation paths — they already reach the seam
  directly.
- Any other option on `ProductionAgentOptions`.

## Git workflow

- Stay on the current branch. This repo explicitly prohibits creating,
  switching, or otherwise moving branches unless the operator asks for that
  exact operation.
- Do NOT commit or push unless the operator instructed it. Never add
  `Co-Authored-By` or agent attribution to any commit.

## Steps

### Step 1: Add the option to `ProductionAgentOptions`

In `packages/core/src/agent/production-agent.ts`, add to the
`ProductionAgentOptions` interface (at :904) a field:

```ts
/**
 * In-loop processors for the HTTP chat surface (see `processors.ts` and
 * the Processors doc). Static array, or a per-request resolver called with
 * the H3 event — mirror of how `systemPrompt` supports both forms.
 * Unset ⇒ zero overhead (the no-processor fast path is unchanged).
 */
processors?:
  | Processor[]
  | ((event: any) => Processor[] | Promise<Processor[]>);
```

Import `Processor` from `./processors.js` if not already imported at the top
(check the existing import block around `:120` — `processors.js` is already
imported there; extend that import if needed). Match the doc-comment style of
the neighboring fields and the `(event: any)` typing used by `systemPrompt`.

**Verify**: `pnpm --filter @agent-native/core typecheck` → exit 0

### Step 2: Thread it at the TODO site

At `production-agent.ts:7561-7568`, resolve the option and pass it into
`agentLoopOpts`:

- Before `const agentLoopOpts = {`, resolve:
  `const requestProcessors = typeof options.processors === "function" ?
  await options.processors(event) : options.processors;`
  (Confirm the surrounding code's actual variable name for the
  `ProductionAgentOptions` value and the H3 event — read the enclosing
  function first; do not guess.)
- Add `processors: requestProcessors,` to the `agentLoopOpts` object.
- Replace the `TODO(processor-seam)` comment block with one short comment
  noting the resolver mirrors `systemPrompt`'s per-request form.

The no-processor path must remain identical: when the option is unset,
`requestProcessors` is `undefined` and `runAgentLoop`'s existing
`opts.processors && opts.processors.length > 0` check keeps the fast path.

**Verify**: `pnpm --filter @agent-native/core typecheck` → exit 0, and
`grep -n "TODO(processor-seam)" packages/core/src/agent/production-agent.ts`
→ no matches

### Step 3: Tests

Add tests (in `processors.spec.ts` or a new `processor-seam.spec.ts` next to
it, following the structure of existing specs in that directory):

1. Handler-configured static `processors: [p]` — the processor's hooks fire
   during an HTTP-surface run.
2. Resolver form — resolver is awaited per request and its returned processor
   fires.
3. A processor that throws `TripWire` via the HTTP surface halts the run and
   the final event stream reflects the abort (mirror however the existing
   loop-level TripWire test asserts the halt).
4. Unset option — behavior identical to before (no ProcessorChain
   constructed; assert via existing observable behavior, not internals).

If constructing a full HTTP-surface test harness is disproportionate, follow
the pattern of the nearest existing test that exercises the production agent
request path (search `packages/core/src/agent/*.spec.ts` and
`*.integration.spec.ts` for one that builds `ProductionAgentOptions`); if none
exists that can be reused, STOP condition 3 applies.

**Verify**: `pnpm --filter @agent-native/core exec vitest --run src/agent/processors.spec.ts src/agent/processor-seam.spec.ts --passWithNoTests` → all pass, ≥ 3 new tests

### Step 4: Update the English doc

In `packages/core/docs/content/processors.mdx`, rewrite the
`doc-block-proc1note` callout: the HTTP chat handler now accepts
`processors` (array or per-request resolver) on `ProductionAgentOptions`;
show a 5-line usage snippet. Keep the callout id unchanged.

**Verify**: `grep -n "not yet wired" packages/core/docs/content/processors.mdx`
→ no matches

### Step 5: Update the locale docs

Apply the equivalent edit to the same callout in each of the 10 locale copies
(`packages/core/docs/content/locales/*/processors.mdx`), translating the new
callout text to match each file's language. If you cannot produce a faithful
translation for a locale, leave that file unchanged and list the specific
locales needing follow-up in your completion report — the repo rule requires
naming them explicitly.

**Verify**: `grep -rln "doc-block-proc1note" packages/core/docs/content/locales/*/processors.mdx | wc -l` → `10` (callout id preserved everywhere)

### Step 6: Changeset and format

Create `.changeset/<descriptive-name>.md` with a `minor` bump for
`@agent-native/core` (new public option) and one sentence describing the
feature. Run `pnpm fmt`.

**Verify**: `pnpm changeset:status` lists the new changeset (or the file
exists under `.changeset/` and `pnpm fmt:check` passes on modified files)

## Test plan

Covered in Step 3: three positive tests (static, resolver, TripWire-abort via
HTTP surface) and one no-regression test (unset option). Model structure after
the existing `packages/core/src/agent/processors.spec.ts`. Final gate:
`pnpm test:fast` passes.

## Done criteria

- [ ] `pnpm --filter @agent-native/core typecheck` exits 0
- [ ] `grep -rn "TODO(processor-seam)" packages/core/src` → no matches
- [ ] New tests exist and pass; `pnpm test:fast` exits 0
- [ ] English + locale docs updated (or unfinished locales explicitly named
      in the completion report)
- [ ] A `.changeset/*.md` for `@agent-native/core` exists
- [ ] No files outside the in-scope list modified (`git status --porcelain`)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `TODO(processor-seam)` comment is gone or the `agentLoopOpts`
  construction no longer matches the excerpt (someone did this work already
  or restructured the handler).
- There are OTHER `agentLoopOpts`/`runAgentLoop` call sites inside the HTTP
  request path that would also need the option (search
  `grep -n "runAgentLoop(" packages/core/src/agent/production-agent.ts`) and
  it's ambiguous which should receive processors — report the list instead of
  choosing.
- No existing test harness exercises the production-agent request path and
  building one from scratch would exceed ~150 lines — report what's missing
  instead of hand-rolling a fragile harness.
- Typecheck reveals `Processor` cannot be imported into the options interface
  without a circular import — report the cycle.

## Maintenance notes

- Future work that adds new agent entry points inside the HTTP handler must
  thread `processors` the same way — reviewers should watch for new
  `runAgentLoop` call sites that silently skip it.
- This seam is the intended substrate for a future proof-of-done gate and
  guardrail presets; keep the option shape (array | resolver) stable since
  hosts will start depending on it.
- Deferred deliberately: shipping any built-in processors (redaction,
  proof-of-done) — that's a separate feature with its own design questions.
