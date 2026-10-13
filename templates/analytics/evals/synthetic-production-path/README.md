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

The before phase is pinned to the exact `origin/main` snapshot
`d0caebd20464a2a00ad417c78943d81438d9333a`. The candidate source revision is
`595a07f9a507bba5ba43d6478969c6e19bea9ac2`, pinned in the comparison
validator. Both phases used the same `synthetic-analytics-retrieval-v10` fixture
and fifteen cases, twice each. The candidate SHA identifies the exact commit
whose production source files and harness were measured; the later artifact
commit adds the CSV, comparison assertions, and this README. It does not change
evaluated production source or harness files.

Before-phase checks verify all evaluated production source bytes against the
pinned baseline commit and require the copied harness to match the bytes at the
candidate commit named by `ANALYTICS_EVAL_HARNESS_REVISION`. The CSV records the
harness hash separately, and the validator requires it to be identical in both
phases. After-phase checks require a clean candidate source tree and every
evaluated file to match the supplied candidate commit. The evaluated code hashes
are `sha256:fb3f0bad8151998d81fcf994a55143ee58f64ed8c3483404237669514656a268`
before and
`sha256:9a1fc94f54d57e6656dc2793628bcccf917a416980fa1c861b7f44bd28f3d139`
after. The shared harness hash is
`sha256:5e746b9ffc64ce67cb7ee0b16a05b276ca6341bd26e90ba7bf12e26028df9ac9`.

The pinned baseline is newer than the PR's base, so this measures current main
against the candidate source commit rather than replaying the historical PR
base. The v9 artifact remains in the directory as historical evidence.

Re-run the already prepared baseline worktree at
`/tmp/analytics-eval-before-v10-d0caebd-595a07f9`:

```sh
ANALYTICS_EVAL_PHASE=before ANALYTICS_EVAL_GIT_REVISION=d0caebd20464a2a00ad417c78943d81438d9333a ANALYTICS_EVAL_HARNESS_REVISION=595a07f9a507bba5ba43d6478969c6e19bea9ac2 ANALYTICS_EVAL_EMIT_CSV=1 pnpm --filter analytics exec vitest run evals/synthetic-production-path/production-path.spec.ts
```

Re-run the candidate in its clean worktree at
`/tmp/analytics-eval-after-v10-595a07f9`:

```sh
ANALYTICS_EVAL_PHASE=after ANALYTICS_EVAL_GIT_REVISION=595a07f9a507bba5ba43d6478969c6e19bea9ac2 ANALYTICS_EVAL_EMIT_CSV=1 pnpm --filter analytics exec vitest run evals/synthetic-production-path/production-path.spec.ts
```

The combined artifact is
`SYNTHETIC-analytics-production-path-v10-before-after.csv`. Its validator checks
the privacy-safe schema, all fifteen case IDs, exactly two runs per phase,
matching before/after `(case_id, run)` pairs, fixture, code, and shared harness
revisions, completion state, and the one-action allowlist. To verify the CSV and
the validator's mismatch tests, run:

```sh
pnpm --filter analytics exec vitest run evals/synthetic-production-path/comparison-validation.spec.ts
```

## Results

Top-1 retrieval rose from 6/30 to 30/30 runs (20% to 100%). Hit@5 rose from
16/30 to 30/30 (53.3% to 100%). All 60 runs completed without aborts; each made
one `find-data` call and no other or failed action. Each phase recorded 7,200
input and 1,440 output tokens in the deterministic harness. Per-run latency is
local synthetic harness telemetry, not a hosted-model or production latency
claim.

The CSV serializer permits only synthetic case IDs and execution metadata:
phase, Git, code, and harness revisions, fixture revision, run number, coded
score and reason, expected rank and hit@5, action counts, completion and abort
state, aggregate token counts, and elapsed time. Prompts, model output, tool
inputs and results, SQL, identities, and fixture values are never serialized.
Scores measure retrieval and production-path integrity with a deterministic test
engine; they do not measure hosted-model answer quality or reproduce historical
user chats.

The synthetic retrieval-only benchmark is recorded separately in
`../synthetic-retrieval/SYNTHETIC-analytics-retrieval-v6.csv`. Its twelve cases
improved top-1 from 5/12 to 12/12, hit@5 from 10/12 to 12/12, and mean reciprocal
rank from 0.625 to 1.00. Earlier production-path artifacts remain unchanged for
historical reference.
