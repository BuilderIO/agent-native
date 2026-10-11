# SYNTHETIC: Analytics retrieval benchmark

This deterministic benchmark compares the current shared Analytics
query-catalog matcher and ranker with the implementation in `origin/main` at
revision `bdd2cfccb528339cc47e19aeaff9bf3e367374f1`. All names, definitions,
SQL fragments, and cases are invented. These rows are not historical chats,
production data, or production end-to-end results.

The baseline candidate order was measured by importing the exact
`rankAnalyticsQueryCatalog` implementation from that `origin/main` revision
and running it against these same fixtures. `benchmark.ts` stores the measured
candidate order and the CSV records the source revision, so the comparison
does not substitute a simplified lexical search for the previous ranker.
Re-measure the baseline when changing the comparison base; do not update the
revision without running the fixtures against that commit.

The after results call `rankAnalyticsQueryCatalog` directly with fixed
fixtures. The five cases cover a built-in dictionary alias (`MRR`), a term
found only in panel SQL, semantic-scope selection, approved versus generated
dictionary trust, and off-topic `Connect` text competing with an
organization-membership entry. The CSV marks every row `SYNTHETIC` and includes
the expected candidate's rank under both methods. This measures retrieval
ranking only; it does not measure answer quality, latency, or the mounted
production chat path.

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
