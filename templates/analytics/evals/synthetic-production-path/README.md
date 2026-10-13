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
`d0caebd20464a2a00ad417c78943d81438d9333a`. The candidate source revision is
`910d2c585496ef2f8540870ad9d05bf9be2c5288`, pinned in the comparison
validator. Both phases used the same `synthetic-analytics-retrieval-v9` fixture
and thirteen cases, twice each. The candidate SHA identifies the exact commit
whose production source files and harness were measured; the later artifact
commit adds the CSV, refreshes the comparison assertions and this README, and
pins the validator to that exact candidate SHA. It does not change evaluated
production source or harness files.
Before-phase checks verify all evaluated production source bytes against the
pinned baseline commit and require the copied harness to match the bytes at the
candidate commit named by `ANALYTICS_EVAL_HARNESS_REVISION`. The CSV records the
harness hash separately, and the validator requires it to be identical in both
phases. After-phase checks require a clean candidate source tree and every
evaluated file to match the supplied candidate commit. The evaluated code hashes
are `sha256:88d2c189cab2af16505fb56a6f307ee24ea2fcff8660959955268e71c3831024`
before and
`sha256:5246fb1d67576bb1f73be139ce2dd38fed5f11814789a752f154df066609dec2`
after. The shared harness hash is
`sha256:ada2b65af8ce5a9a09e70d7ccd61b046948bfc98363e2debdc63159a490f6f3f`.

The baseline is the exact `origin/main` snapshot at
`d0caebd20464a2a00ad417c78943d81438d9333a`, which is newer than the PR's base.
This comparison measures current main against the candidate source commit, not a
same-base replay.

Re-run the baseline from the repository root:

```sh
git worktree add --detach /tmp/analytics-eval-before-d0caebd d0caebd20464a2a00ad417c78943d81438d9333a
mkdir -p /tmp/analytics-eval-before-d0caebd/templates/analytics/evals/synthetic-production-path
git -C /tmp/analytics-eval-before-d0caebd show 910d2c585496ef2f8540870ad9d05bf9be2c5288:templates/analytics/evals/synthetic-production-path/production-path.spec.ts > /tmp/analytics-eval-before-d0caebd/templates/analytics/evals/synthetic-production-path/production-path.spec.ts
cd /tmp/analytics-eval-before-d0caebd
pnpm install --frozen-lockfile
ANALYTICS_EVAL_PHASE=before ANALYTICS_EVAL_GIT_REVISION=d0caebd20464a2a00ad417c78943d81438d9333a ANALYTICS_EVAL_HARNESS_REVISION=910d2c585496ef2f8540870ad9d05bf9be2c5288 ANALYTICS_EVAL_EMIT_CSV=1 pnpm --filter analytics exec vitest run evals/synthetic-production-path/production-path.spec.ts
```

Re-run the candidate on its pinned source commit in a separate clean worktree:

```sh
git worktree add --detach /tmp/analytics-eval-after-910d2c5 910d2c585496ef2f8540870ad9d05bf9be2c5288
cd /tmp/analytics-eval-after-910d2c5
pnpm install --frozen-lockfile
ANALYTICS_EVAL_PHASE=after ANALYTICS_EVAL_GIT_REVISION=910d2c585496ef2f8540870ad9d05bf9be2c5288 ANALYTICS_EVAL_EMIT_CSV=1 pnpm --filter analytics exec vitest run evals/synthetic-production-path/production-path.spec.ts
```

The combined artifact is
`SYNTHETIC-analytics-production-path-v9-before-after.csv`. Its validator checks
the exact privacy-safe schema, all thirteen case IDs, exactly two runs per phase,
matching before/after `(case_id, run)` pairs, fixture, code, and shared harness
revisions, completion state, and the one-action allowlist. To verify the CSV and
the validator's mismatch tests, run:

```sh
pnpm --filter analytics exec vitest run evals/synthetic-production-path/comparison-validation.spec.ts
```

## Results

Top-1 retrieval rose from 6/26 to 26/26 runs (23.1% to 100%). Hit@5 rose from
16/26 to 26/26 (61.5% to 100%). All 52 runs completed without aborts; each made
one `find-data` call and no other or failed action. Each phase recorded 6,240
input and 1,248 output tokens. Per-run latency is included as local harness
telemetry, not as a hosted-model or production latency claim.

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
