# SYNTHETIC: Analytics retrieval benchmark

This deterministic benchmark compares the current shared Analytics
query-catalog matcher and ranker with the implementation in `origin/main` at
revision `8ff15a5577e6530316d59c4e4b2aa751a8f56a63`. Case names, questions,
expected outcomes, panel SQL, and data values are synthetic. These rows are
not historical chats, production data, or production end-to-end results.

Roster and monthly aggregate metadata in the fixtures is aligned with dbt
revision `000d5e351b5be91166610a4acf1b10fea565fcff`; the CSV records that
revision. No owner is inferred where dbt does not document one.

The baseline candidate order was measured by importing the exact
`rankAnalyticsQueryCatalog` implementation from that `origin/main` revision
and running it against these same fixtures. `benchmark.ts` stores the measured
candidate order and the CSV records the source revision, so the comparison
does not substitute a simplified lexical search for the previous ranker.
Re-measure the baseline when changing the comparison base; do not update the
revision without running the fixtures against that commit.

The after results call `rankAnalyticsQueryCatalog` directly with fixed
fixtures. The eight cases cover a built-in dictionary alias (`MRR`), a term
found only in panel SQL, semantic-scope selection, approved versus generated
dictionary trust, off-topic `Connect` text, a role-aware organization roster
versus a monthly aggregate, product activity versus membership metadata, and
preserving aggregate retrieval for a highest-count question. The monthly
aggregate follows dbt's daily-built snapshot semantics: completed months use
month end, while the current month is partial through today. The CSV marks
every row `SYNTHETIC` and includes the expected candidate's rank under both
methods. This measures retrieval ranking only; it does not measure answer
quality, latency, or the mounted production chat path.

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
