# Synthetic production-path retrieval harness

This harness runs the shared Analytics production agent loop with the Analytics
production prompt, read-only action registry, final-response guard, explicit
synthetic caller identity, and usage capture. A deterministic in-memory engine
emits one `find-data` call and a safe metadata-only closeout; it does not call a
hosted model.

The fixtures use invented group and member entities, synthetic table and
column names, and an artificial test-member exclusion rule. They contain no
production model names, source definitions, production membership policy, or
identities. Catalog reads use fixture-backed Analytics dictionary, source-index,
and dashboard storage seams. Embedding discovery is disabled so the test cannot
read credentials or call an embedding provider. The action allowlist contains
only `find-data`; warehouse and connected-data actions are unavailable to the
loop.

## Reproduce the evaluation

The before phase is pinned to `origin/main` revision
`75e39e8547b408aa09605e54872d9a8ef6522df9`. The candidate source revision is
`08d5983fb124b8ba28305d9906975674c818485d`. Both phases used the same
`synthetic-analytics-retrieval-v8` fixture and eleven cases, twice each.
Before-phase checks verify all evaluated production source bytes against the
pinned baseline commit and require the copied harness to match the bytes at the
candidate commit named by `ANALYTICS_EVAL_HARNESS_REVISION`. The CSV records the
harness hash separately, and the validator requires it to be identical in both
phases. After-phase checks require a clean candidate source tree and every
evaluated file to match the supplied candidate commit. The evaluated code hashes
are `sha256:bd37891206f57c7e53afbebae9bd8d5cb2c56163bc032e4fbd486a3307c38b86`
before and
`sha256:44b1422d2ebf0c5e83a9d7d77dbc6731774f32270ce386f6ed23c077c730efc4`
after. The shared harness hash is
`sha256:b293d76e7899bbb276afcd4ab58ff7639ab868d3708b9062c480873f32f4bc59`.

The baseline was `origin/main` at evaluation time, pinned to
`75e39e8547b408aa09605e54872d9a8ef6522df9`. The PR is based on
`8ff15a5577e6530316d59c4e4b2aa751a8f56a63`, and `origin/main` has since advanced
to `d0caebd20464a2a00ad417c78943d81438d9333a`. This artifact preserves its
point-in-time baseline; it is not a comparison against the current main tip.
Between the pinned baseline and candidate, `packages/core/src/agent/production-agent.ts`
adds a retry for transient provider rate-limit errors on the baseline. The
synthetic engine does not generate provider errors, so that branch is not
exercised in this comparison. This is a pinned main snapshot versus candidate,
not a same-base replay.

Re-run the baseline from the repository root:

```sh
git worktree add --detach /tmp/analytics-eval-before 75e39e8547b408aa09605e54872d9a8ef6522df9
mkdir -p /tmp/analytics-eval-before/templates/analytics/evals/synthetic-production-path
cp templates/analytics/evals/synthetic-production-path/production-path.spec.ts /tmp/analytics-eval-before/templates/analytics/evals/synthetic-production-path/
cd /tmp/analytics-eval-before
pnpm install --frozen-lockfile
ANALYTICS_EVAL_PHASE=before ANALYTICS_EVAL_GIT_REVISION=75e39e8547b408aa09605e54872d9a8ef6522df9 ANALYTICS_EVAL_HARNESS_REVISION=08d5983fb124b8ba28305d9906975674c818485d ANALYTICS_EVAL_EMIT_CSV=1 pnpm --filter analytics exec vitest run evals/synthetic-production-path/production-path.spec.ts
```

Re-run the candidate on its pinned source commit in a separate clean worktree:

```sh
git worktree add --detach /tmp/analytics-eval-after 08d5983fb124b8ba28305d9906975674c818485d
cd /tmp/analytics-eval-after
pnpm install --frozen-lockfile
ANALYTICS_EVAL_PHASE=after ANALYTICS_EVAL_GIT_REVISION=08d5983fb124b8ba28305d9906975674c818485d ANALYTICS_EVAL_EMIT_CSV=1 pnpm --filter analytics exec vitest run evals/synthetic-production-path/production-path.spec.ts
```

The combined artifact is
`SYNTHETIC-analytics-production-path-v8-before-after.csv`. Its validator checks
the exact privacy-safe schema, all eleven case IDs, exactly two runs per phase,
matching before/after `(case_id, run)` pairs, fixture, code, and shared harness
revisions, completion state, and the one-action allowlist. To verify the CSV and
the validator's mismatch tests, run:

```sh
pnpm --filter analytics exec vitest run evals/synthetic-production-path/comparison-validation.spec.ts
```

## Results

Top-1 retrieval rose from 6/22 to 22/22 runs (27.3% to 100%). Hit@5 rose from
14/22 to 22/22 (63.6% to 100%). All 44 runs completed without aborts; each made
one `find-data` call and no other or failed action. Both phases recorded the
same aggregate token counts: 5,280 input and 1,056 output tokens. Per-run latency
is included as local harness telemetry, not as a hosted-model or production
latency claim.

The CSV serializer permits only synthetic case IDs and execution metadata:
phase, Git, code, and harness revisions, fixture revision, run number, coded
score and reason, expected rank and hit@5, action counts, completion and abort
state, aggregate token counts, and elapsed time. Prompts, model output, tool
inputs and results, SQL, identities, and fixture values are never serialized. Scores
measure retrieval and production-path integrity with a deterministic test
engine; they do not measure hosted-model answer quality or reproduce historical
user chats.

The synthetic retrieval-only benchmark is recorded separately in
`../synthetic-retrieval/SYNTHETIC-analytics-retrieval-v6.csv`. Its twelve cases
improved top-1 from 5/12 to 12/12, hit@5 from 10/12 to 12/12, and mean reciprocal
rank from 0.625 to 1.00. Earlier production-path artifacts remain unchanged for
historical reference.
