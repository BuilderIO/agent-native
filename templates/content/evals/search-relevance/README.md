# Search relevance eval

A committed, deterministic relevance eval for Content search. It exercises
the real `search-documents` action's public contract (query, filters,
limit) against an invented synthetic corpus (`corpus.ts`), not the search
engine's internals, so every future change behind that action — a
maintained full-text index, typo correction, semantic search — is judged
against the same fixed baseline.

The baseline was recorded on the substring scan that Content used before
the core search index. The eval runs on the index path, because Content's
tests process every pending index change before a search, and the index
has to match or beat that baseline.

## Files

- `corpus.ts` — a typed, invented corpus of ~155 documents across a
  personal space and an org space (fictional company "Meridian
  Analytics"), including near-duplicate titles, nested pages, a
  `Blog posts` collection, a `Task Priorities` collection, a few long
  (20-30 KB) bodies, a small Spanish/Japanese set, and access-control
  distractors (an outsider-owned space, `hideFromSearch` documents, and
  trashed documents).
- `cases.ts` — 43 judged queries across five classes: `known-item`,
  `passage`, `typo`, `question`, `access`. Cases reference corpus documents
  by their stable `key`, never by a generated id.
- `search-relevance.db.test.ts` — seeds a PGlite database from the corpus,
  runs every case through `search-documents.run` as the corpus owner
  (limit 10), scores the results, prints a compact table, and gates.
- `baseline.json` — the recorded metrics this eval compares against.

## Scoring

Per case, the runner resolves `expectFirst` / `acceptableTop3` corpus keys
to document ids and finds the rank (1-based, over the returned top 10) of
the first matching id in the results.

Per class and overall, it computes:

- **top-1 hit rate** — over cases that set `expectFirst` only.
- **top-3 hit rate** — over all cases in the class.
- **MRR** — mean reciprocal rank over the top 10 (0 if no relevant id is
  returned).
- **zero-result count** — cases that returned no documents at all.

"Overall" combines `known-item` + `passage` + `typo` + `question` only.
`access` is scored differently (see below) and reported separately so it
never gets averaged into a relevance number.

For the `access` class, `expectFirst` / `acceptableTop3` name the
distractor document(s) that must never appear anywhere in the returned
page — not the expected top result. A case "passes" when none of those
ids appear in the results.

## Gating

- `access` cases must always pass, unconditionally. This is not
  baseline-relative.
- `known-item` and `passage`: the test fails if the current top-3 hit rate
  or MRR drops below the recorded baseline by more than a small float
  epsilon (`0.005`).
- `typo` and `question` are report-only (`gating: false` in
  `baseline.json`) because neither the scan nor the index corrects typos
  or satisfies an AND-of-every-word match against a natural question yet.
  Later phases flip these to gating once search targets them.

## Running

```sh
corepack pnpm --filter content exec vitest run evals/search-relevance
```

or, from the `templates/content` package directory:

```sh
pnpm eval:search
```

## Updating the baseline

After an intentional search engine change, re-record the baseline:

```sh
SEARCH_EVAL_UPDATE_BASELINE=1 corepack pnpm --filter content exec vitest run evals/search-relevance
```

This writes a new `baseline.json` instead of comparing against the old
one (the `access` gate and the typo/question report still run normally).
Review the diff — a `known-item` or `passage` regression should be
justified in the PR description, not silently absorbed by re-recording.
Then run the eval once more without the env var to confirm it passes
against the freshly recorded baseline.
