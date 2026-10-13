# SYNTHETIC: Analytics retrieval benchmark

This deterministic benchmark compares the current shared Analytics
query-catalog matcher and ranker with the implementation in `origin/main` at
revision `8ff15a5577e6530316d59c4e4b2aa751a8f56a63`. Case names, questions,
expected outcomes, panel SQL, and data values are synthetic. These rows are
not historical chats, production data, or production end-to-end results.

Every table, column, grain description, and exclusion rule in these fixtures is
invented. The cases preserve only the retrieval contrasts under test, such as
a period aggregate versus a row-level membership bridge. They do not copy
Builder.io model names, columns, or membership policies.

The baseline candidate order was measured by importing the exact
`rankAnalyticsQueryCatalog` implementation from that `origin/main` revision
and running it against these same fixtures. `benchmark.ts` stores the measured
candidate order and the CSV records the source and fixture revisions, so the
comparison does not substitute a simplified lexical search for the previous
ranker.
Re-measure the baseline when changing the comparison base; do not update the
revision without running the fixtures against that commit.

The after results call `rankAnalyticsQueryCatalog` directly with fixed
fixtures. The eight cases cover a built-in dictionary alias (`MRR`), a term
found only in panel SQL, semantic-scope selection, approved versus generated
dictionary trust, off-topic `Connect` text, a role-aware organization roster
versus a period aggregate, product activity versus membership metadata, and
preserving aggregate retrieval for a highest-count question. The synthetic
period aggregate has a daily refresh, final-day completed periods, a partial
current period, and an invented sandbox exclusion rule. The CSV marks every
row `SYNTHETIC` and includes the expected candidate's rank under both methods.
This measures retrieval ranking only; it does not measure answer quality,
latency, or the mounted production chat path.

From the repository root, regenerate the checked-in CSV with:

```sh
pnpm --dir templates/analytics exec tsx evals/synthetic-retrieval/benchmark.ts --write
```

Check that the checked-in CSV still matches the computed outputs with:

```sh
pnpm --dir templates/analytics exec tsx evals/synthetic-retrieval/benchmark.ts --check
```

The focused test also checks the CSV and expected ranking behavior:

```sh
pnpm --dir templates/analytics exec vitest run evals/synthetic-retrieval/benchmark.spec.ts
```
