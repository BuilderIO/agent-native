# SYNTHETIC: Analytics retrieval benchmark

This deterministic benchmark compares a synthetic ranking snapshot from the
previous production catalog at revision `f2c69d7718a9204f707bef6257045a71b78be457`
with the current shared Analytics query-catalog matcher and ranker. All names,
definitions, SQL fragments, and cases are invented. These rows are not
historical chats, production data, or production end-to-end results.

The baseline candidate order was measured by running the exact previous
`rankAnalyticsQueryCatalog` implementation against these same synthetic
fixtures. The CSV records its revision and full candidate order so the
comparison is auditable and does not pretend a simplified lexical search is
the old production behavior.

The after results call `rankAnalyticsQueryCatalog` directly with fixed
fixtures. The four cases cover a built-in dictionary alias (`MRR`), a term
found only in panel SQL, semantic-scope selection, and approved versus
generated dictionary trust. The CSV marks every row `SYNTHETIC` and includes
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
