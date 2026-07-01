# Content Parity Harness

This folder is the living audit for Content's agent/UI action parity. The
matrix records which visible workflows are action-backed, which have explicit
exceptions, and which gaps need follow-up.

PR 2.2 adds two executable tiers:

- Deterministic parity tests run in normal CI. They use fixture data and
  existing action tests, make no model calls, and require no private provider
  credentials.
- Gated agent evals run through `agent-native eval parity`. They are opt-in via
  `CONTENT_PARITY_EVALS=1`, capped to four initial scenarios, and should be
  reserved for manual or nightly checks.

## Deterministic Checks

```bash
cd templates/content
./node_modules/.bin/vitest --run parity
./node_modules/.bin/vitest --run actions/content-database-lifecycle.db.test.ts actions/bind-content-database-source-field.db.test.ts actions/_local-file-documents.test.ts actions/builder-source-review-gates.db.test.ts
```

The matrix rows use `coverageRefs` to point at deterministic files that prove a
capability. The meta-tests fail with the row id when a priority capability loses
coverage, so reviewers do not have to map a random test name back to the audit.

## Gated Agent Evals

```bash
cd templates/content
./node_modules/.bin/agent-native eval parity --json
CONTENT_PARITY_EVALS=1 ANTHROPIC_API_KEY=... ./node_modules/.bin/agent-native eval parity
```

With `CONTENT_PARITY_EVALS` unset, parity evals return skipped rows and do not
call the agent runner. The CLI still exits `0`, but both readable and JSON
reports mark each row with `status: "skipped"` and a `skipReason` such as
`Skipped because CONTENT_PARITY_EVALS is unset`.

With the gate set, the eval files run the four PR 2.2 scenarios:

- `database-source-scope`
- `document-search-edit`
- `local-file-source-truth`
- `builder-source-review-readonly`

The scenarios use fake or fixture data only. They must not require private
Builder, Notion, customer, or workspace credentials. The Builder scenario is
readonly/mocked by default and must not execute a live write.

## CI Posture

Normal PR CI runs deterministic parity checks through `pnpm test:content-parity`.
Live or LLM-backed parity evals are reserved for the gated eval workflow, which
can be triggered manually or by the nightly schedule. Missing provider secrets
should show as skipped in that workflow summary, not as a scored pass.

## Updating The Matrix

Edit `matrix.ts`, then regenerate:

```bash
cd templates/content
./node_modules/.bin/tsx parity/render-matrix.ts --write
```

`parity/__tests__/matrix-render-fresh.test.ts` keeps `matrix.md` synced with
the typed source.
