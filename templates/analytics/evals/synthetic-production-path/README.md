# Synthetic production-path retrieval harness

This harness runs the shared production agent loop with the Analytics
production prompt, read-only action registry, final-response guard, explicit
synthetic caller identity, and usage capture. Its deterministic in-memory
engine emits a single `find-data` call and a safe metadata-only closeout; it
does not call a hosted model.

The prompts, identities, and returned values are synthetic. Catalog metadata is
pinned to dbt schema commit
`000d5e351b5be91166610a4acf1b10fea565fcff`, including the verified model
names, columns, and grain; no model owner is inferred. Catalog reads use
fixture-backed Analytics dictionary, source-index, and dashboard storage
seams. Embedding discovery is disabled in the test so it cannot call an
embedding provider. The action allowlist contains only `find-data`; BigQuery,
dbt, Sigma, Amplitude, HubSpot, and other data providers are unavailable to
the loop. Eval results are never persisted.

Run it from the repository root. To emit the privacy-safe CSV for an exact
revision, pass `ANALYTICS_EVAL_PHASE=before` or `after`, its 40-character Git
revision in `ANALYTICS_EVAL_GIT_REVISION`, and `ANALYTICS_EVAL_EMIT_CSV=1`:

```sh
pnpm --filter analytics exec vitest run evals/synthetic-production-path/production-path.spec.ts
```

The serializer deliberately exposes only synthetic case IDs, before/after
phase, Git and code revisions, fixture revision, run number, coded score and
reason, expected rank and hit@5, action counts, completion/abort state,
aggregate token counts, and elapsed time. It rejects additional fields.
Prompts, model output, tool inputs and results, SQL, identities, and fixture
values are never serialized. Scores measure retrieval and production-path
integrity with a deterministic test engine; they do not measure hosted-model
answer quality.

The checked-in `SYNTHETIC-analytics-production-path-before-after.csv` contains
the same two metadata-only cases run twice each against `origin/main`
(`8ff15a5577e6530316d59c4e4b2aa751a8f56a63`) and the implementation commit.
Baseline retrieved the role-aware roster source at rank 2 and the monthly
aggregate at rank 1 in both runs (top-1 2/4, hit@5 4/4). The implementation
retrieved both sources at rank 1 in both runs (top-1 4/4, hit@5 4/4). All
eight production-path runs completed with the guard, owner/org context, usage,
and only the `find-data` action. The broader eight-case retrieval benchmark is
recorded separately in `../synthetic-retrieval/SYNTHETIC-analytics-retrieval.csv`.
