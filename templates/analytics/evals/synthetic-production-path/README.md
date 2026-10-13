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
`1d82c7b94cd0ed97095c146ba3b5110e19bb0cc4`. Both runs used the same
`synthetic-analytics-retrieval-v7` fixture and the same nine cases, twice each.
The baseline harness is byte-for-byte the candidate harness copied into a clean
baseline worktree. Before-phase checks also verify all evaluated production
source files against the pinned baseline commit. After-phase checks require the
candidate source tree to be clean and every evaluated file to match the supplied
candidate commit. The evaluated code hashes are
`sha256:83ef253dce08fad14c45060b287b85fdf1c644e12b2cbbed36ee1e93bf4af372`
before and
`sha256:c7df9845d495ba9e296ecac87b2d0df0cba7a084a2858f7afcb3c67613afb957`
after.

The pinned baseline is current `origin/main`; the PR was based on
`8ff15a5577e6530316d59c4e4b2aa751a8f56a63`. Between those revisions,
`packages/core/src/agent/production-agent.ts` adds a retry for transient
provider rate-limit errors. The synthetic engine does not generate provider
errors, so that branch is not exercised in this comparison. This is an
`origin/main`-to-candidate comparison, not a same-base comparison.

Re-run the baseline from the repository root:

```sh
git worktree add --detach /tmp/analytics-eval-before 75e39e8547b408aa09605e54872d9a8ef6522df9
mkdir -p /tmp/analytics-eval-before/templates/analytics/evals/synthetic-production-path
cp templates/analytics/evals/synthetic-production-path/production-path.spec.ts \\
  /tmp/analytics-eval-before/templates/analytics/evals/synthetic-production-path/
cd /tmp/analytics-eval-before
pnpm install --frozen-lockfile
ANALYTICS_EVAL_PHASE=before \\
  ANALYTICS_EVAL_GIT_REVISION=75e39e8547b408aa09605e54872d9a8ef6522df9 \\
  ANALYTICS_EVAL_EMIT_CSV=1 \\
  pnpm --filter analytics exec vitest run evals/synthetic-production-path/production-path.spec.ts
```

Re-run the candidate on its pinned source commit in a separate clean worktree:

```sh
git worktree add --detach /tmp/analytics-eval-after 1d82c7b94cd0ed97095c146ba3b5110e19bb0cc4
cd /tmp/analytics-eval-after
pnpm install --frozen-lockfile
ANALYTICS_EVAL_PHASE=after \\
  ANALYTICS_EVAL_GIT_REVISION=1d82c7b94cd0ed97095c146ba3b5110e19bb0cc4 \\
  ANALYTICS_EVAL_EMIT_CSV=1 \\
  pnpm --filter analytics exec vitest run evals/synthetic-production-path/production-path.spec.ts
```

The combined artifact is
`SYNTHETIC-analytics-production-path-v7-before-after.csv`. Its validator checks
the exact privacy-safe schema, all nine case IDs, exactly two runs per phase,
matching before/after `(case_id, run)` pairs, fixture and code revisions,
completion state, and the one-action allowlist. To verify the committed CSV and
the validator's mismatch tests, run:

```sh
pnpm --filter analytics exec vitest run evals/synthetic-production-path/comparison-validation.spec.ts
```

## Results

Top-1 retrieval rose from 4/18 to 18/18 runs (22.2% to 100%). Hit@5 rose from
12/18 to 18/18 (66.7% to 100%). All 36 runs completed without aborts; each made
one `find-data` call and no other or failed action. Both phases recorded the
same aggregate token counts: 4,320 input and 864 output tokens. Per-run latency
is included as local harness telemetry, not as a hosted-model or production
latency claim.

The CSV serializer permits only synthetic case IDs and execution metadata:
phase, Git and code revisions, fixture revision, run number, coded score and
reason, expected rank and hit@5, action counts, completion and abort state,
aggregate token counts, and elapsed time. Prompts, model output, tool inputs and
results, SQL, identities, and fixture values are never serialized. Scores
measure retrieval and production-path integrity with a deterministic test
engine; they do not measure hosted-model answer quality or reproduce historical
user chats.

The synthetic retrieval-only benchmark is recorded separately in
`../synthetic-retrieval/SYNTHETIC-analytics-retrieval-v6.csv`. Its twelve cases
improved top-1 from 5/12 to 12/12, hit@5 from 10/12 to 12/12, and mean reciprocal
rank from 0.625 to 1.00. Earlier production-path artifacts remain unchanged for
historical reference.
