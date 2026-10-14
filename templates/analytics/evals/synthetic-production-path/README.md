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

## Diagnostic-only v15 artifact (not a valid comparison)

The preserved v15 CSV is not valid evidence: all 46 baseline rows failed
before `find-data` ran, so it measured a broken evaluation path rather than
baseline retrieval. The comparison validator now requires at least 90% of the
runs in each phase to complete the production path. Keep this CSV only as a
record of the harness failure; use a comparison whose baseline and candidate
both meet that completion threshold.

## Latest measured v21 comparison

The v21 artifact compares the freshly fetched `origin/main` snapshot
`8961aeb5a901eb8be8e821c10b957fa9203796c7` with the Analytics PR candidate
snapshot `a92e2383750d13563ee12331ec9708e6b93cd1e9`. It uses the same
twenty-four synthetic retrieval cases, each run twice in each phase.

Top-1 retrieval rose from 44/48 (91.7%) to 48/48 (100%). Hit@5 rose from 46/48
(95.8%) to 48/48 (100%). All 96 runs completed the production path without
aborts; each made one `find-data` call and no other or failed action. The
stale-index marker appears in four rows in each phase.

Evaluated-code hashes are
`sha256:75bd47c16935eabe816f1f00ec52ddf45b537eb303674dae577e86ee886c3030`
before and
`sha256:6a91fd523eb3630b8f10e4338b3204d29595fcde9557a42bba1df49e7837b299`
after. Both phases used the same harness bytes,
`sha256:523b5b1b338cf9326f5d8739358080ef7e2f5bb3e617388bc9ce75b151a59f06`.
The validator pins the source revisions and hashes, case IDs, and harness
hash, and checks paired runs, the safe CSV schema, production-path completion,
and stale-index markers.

To reproduce the before phase, check out the pinned baseline, copy the
candidate `production-path.spec.ts` to the same relative path in that checkout,
install the workspace dependencies, build the Analytics dependencies, and run:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --filter 'analytics^...' run build
```

Then run:

```sh
ANALYTICS_EVAL_PHASE=before \
ANALYTICS_EVAL_GIT_REVISION=8961aeb5a901eb8be8e821c10b957fa9203796c7 \
ANALYTICS_EVAL_HARNESS_REVISION=a92e2383750d13563ee12331ec9708e6b93cd1e9 \
ANALYTICS_EVAL_EMIT_CSV=1 \
corepack pnpm --filter analytics exec vitest run evals/synthetic-production-path/production-path.spec.ts
```

Install workspace dependencies and build the Analytics dependencies in the
candidate checkout as well, then run the after phase from that clean checkout:

```sh
ANALYTICS_EVAL_PHASE=after \
ANALYTICS_EVAL_GIT_REVISION=a92e2383750d13563ee12331ec9708e6b93cd1e9 \
ANALYTICS_EVAL_EMIT_CSV=1 \
corepack pnpm --filter analytics exec vitest run evals/synthetic-production-path/production-path.spec.ts
```

Each invocation prints 48 CSV rows between
`ANALYTICS_PRODUCTION_PATH_CSV_BEGIN` and
`ANALYTICS_PRODUCTION_PATH_CSV_END`. The before checkout requires the candidate
harness to be the only changed file; the after checkout must be clean.

This is a deterministic synthetic in-memory evaluation. It does not call a
hosted model, Builder.io BigQuery, or a connected data source, and its
latencies are not production latency measurements. It measures retrieval over
fixture-backed catalog data, not answer quality on real user chats. The CSV
contains no prompts, tool inputs, SQL, identities, or source values. The
artifact is
[`SYNTHETIC-analytics-production-path-v21-before-after.csv`](./SYNTHETIC-analytics-production-path-v21-before-after.csv).

## Historical measured v20 comparison (superseded by v21)

The v20 artifact compares the freshly fetched `origin/main` snapshot
`217b06fdb294e8efc5ac9f0dd9f079c65307c406` with the Analytics PR candidate
snapshot `980792e5c277be349cf0198fa87d26bc41b7daac`. It uses the same
twenty-four synthetic retrieval cases, each run twice in each phase.

Top-1 retrieval rose from 44/48 (91.7%) to 48/48 (100%). Hit@5 rose from 46/48
(95.8%) to 48/48 (100%). All 96 runs completed the production path without
aborts; each made one `find-data` call and no other or failed action. The
stale-index marker appears in four rows in each phase.

Evaluated-code hashes are
`sha256:79d4f2ca0be7955b94ab26ccb27d00ae8c6106751dcbca7d51ab2fe40fa94a70`
before and
`sha256:a2effa8c701d9be272d97700c00110bd7365fa09ba47ebd2cdb4373c87fe9cc9`
after. Both phases used the same harness bytes,
`sha256:ef5ee4e5c7493cf6c0754f7f98d84ac0c685bef9f819d560a59af4302406498c`.
The validator pins the source revisions and hashes, case IDs, and harness
hash, and checks paired runs, the safe CSV schema, production-path completion,
and stale-index markers. The candidate measurement predates the follow-up
commit that adds only this CSV, validator expectations, and documentation; the
measured production source and harness bytes are unchanged.

To reproduce the before phase, check out the pinned baseline, copy the
candidate `production-path.spec.ts` to the same relative path in that checkout,
install the workspace dependencies, build the Analytics dependencies, and run:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --filter 'analytics^...' run build
```

Then run:

```sh
ANALYTICS_EVAL_PHASE=before \
ANALYTICS_EVAL_GIT_REVISION=217b06fdb294e8efc5ac9f0dd9f079c65307c406 \
ANALYTICS_EVAL_HARNESS_REVISION=980792e5c277be349cf0198fa87d26bc41b7daac \
ANALYTICS_EVAL_EMIT_CSV=1 \
corepack pnpm --filter analytics exec vitest run evals/synthetic-production-path/production-path.spec.ts
```

Install workspace dependencies and build the Analytics dependencies in the
candidate checkout as well, then run the after phase from that clean checkout:

```sh
ANALYTICS_EVAL_PHASE=after \
ANALYTICS_EVAL_GIT_REVISION=980792e5c277be349cf0198fa87d26bc41b7daac \
ANALYTICS_EVAL_EMIT_CSV=1 \
corepack pnpm --filter analytics exec vitest run evals/synthetic-production-path/production-path.spec.ts
```

Each invocation prints 48 CSV rows between
`ANALYTICS_PRODUCTION_PATH_CSV_BEGIN` and
`ANALYTICS_PRODUCTION_PATH_CSV_END`. The before checkout requires the candidate
harness to be the only changed file; the after checkout must be clean.

This is a deterministic synthetic in-memory evaluation. It does not call a
hosted model, Builder.io BigQuery, or a connected data source, and its
latencies are not production latency measurements. It measures retrieval over
fixture-backed catalog data, not answer quality on real user chats. The CSV
contains no prompts, tool inputs, SQL, identities, or source values. The
artifact is
[`SYNTHETIC-analytics-production-path-v20-before-after.csv`](./SYNTHETIC-analytics-production-path-v20-before-after.csv).

## Historical measured v19 comparison (superseded by v20)

The v19 artifact evaluates twenty-four synthetic retrieval cases twice per
phase through the Analytics production agent loop. Its baseline is
`origin/main` at `4715962a57720a2ff5881cb8eea39c1535518cf8`; its candidate source
snapshot is `051ebf123c26257be2058efbfb13468c9226d37a`. Both phases use the same
synthetic prompts, expected source IDs, and metadata fixtures.

Top-1 retrieval rose from 44/48 (91.7%) to 48/48 (100%). Hit@5 rose from 46/48
(95.8%) to 48/48 (100%). The baseline misses were two aliased-membership
lookups and two runs where an approved stale generated entry ranked above the
current roster. The candidate ranked the expected source first in all
twenty-four cases. All 96 runs completed the production path without aborts;
each made one `find-data` call and no other or failed action. The stale-index
marker appears in four rows in each phase.

Evaluated-code hashes are
`sha256:b8e72b194334b790ed13fefe85b4e18eb6e717176c7b337cf7f8c0e5317b7f27`
before and
`sha256:5e69fc9b513d54f13fbd789d1f21863b2122e7d4a0669d79feaaac20d4940809`
after. Both phases used the same harness bytes,
`sha256:1fd351074f83d99df7dbb0e9b67270bd1945f0c293f7db70e36cae8e77268e46`.
The validator pins the source revisions and hashes, case IDs, and harness
hash, and checks paired runs, the safe CSV schema, production-path completion,
and stale-index markers.

This is a deterministic synthetic in-memory evaluation. It does not call a
hosted model, Builder.io BigQuery, or a connected data source, and its
latencies are not production latency measurements. It measures retrieval over
fixture-backed catalog data, not answer quality on real user chats. The CSV
contains no prompts, tool inputs, SQL, identities, or source values. The
artifact is
[`SYNTHETIC-analytics-production-path-v19-before-after.csv`](./SYNTHETIC-analytics-production-path-v19-before-after.csv).

## Historical measured v18 comparison (superseded)

The v18 artifact has the same case set and completion results, measured on an
earlier candidate snapshot `1e9eb1188e5250d594d43c0a37b0eef7f177fe60`. It is
retained for historical comparison; v19 is the current measurement. Its
evaluated-code hashes were
`sha256:14d8e0b6b7400765132207c578c268605e30183307067481a91a075e7d46de5a`
before and
`sha256:f22d56316f7e06cba5aa5824bcc27e75c885f1f715f21a5786891bb025a5c912`
after, with harness hash
`sha256:16f2826b2bf9e6ebe9ab5c5311ba8b8773bba2867594ba9bcbfdc3b54ae73108`.
The artifact is
[`SYNTHETIC-analytics-production-path-v18-before-after.csv`](./SYNTHETIC-analytics-production-path-v18-before-after.csv).

## Historical measured v17 comparison (superseded)

The v17 artifact below uses older main and candidate snapshots. It is retained
for historical comparison; v18 is the current measurement.

The v17 artifact evaluates the same twenty-four synthetic retrieval cases twice
per phase through the Analytics production agent loop. Its baseline was
`origin/main` at `fadfb1b593c71e6a03282269dcb0c9df946188d1`; its candidate source
snapshot is `5a53b3d1bef1fccbfb4ea49da16babd9cb45413c`. Both phases use the same
synthetic prompts, expected source IDs, and metadata fixtures.

Top-1 retrieval rose from 44/48 (91.7%) to 48/48 (100%). Hit@5 rose from 46/48
(95.8%) to 48/48 (100%). The four baseline retrieval misses were two runs where
the aliased membership source was missing and two where an approved stale
generated entry ranked above the current roster. The candidate ranked the
expected source first for all twenty-four cases. All 96 runs completed the
production path without aborts; each made one `find-data` call and no other or
failed action. The stale-index marker appears in four rows in each phase.

Evaluated-code hashes are
`sha256:8a02bfc89d66d8c5465847c557fc03bf5319119b72c8b793de17ff3fd1cafa35`
before and
`sha256:eff504faed54f807031617dc94807db6062939095f02305bef26d8677acefb34`
after. Both phases used the same harness bytes,
`sha256:410af60f8fe7f4e33c2a06c525de18809f7184df110538d5f4806ae577f0c573`.
The checked-in validator pins both source revisions and hashes, the fixture,
case IDs, and harness hash, and checks paired runs, safe CSV fields, production
path completion, and stale-index markers.

This synthetic test does not call a hosted model, Builder.io BigQuery, or a
connected data source. It measures retrieval over fixture-backed catalog data,
not answer quality on real user chats or production latency. The cache,
connection-status, and source-index truncation fixes have separate regression
tests and are not performance claims in this CSV. It contains no prompts, tool
inputs, SQL, identities, or source values. The artifact is
[`SYNTHETIC-analytics-production-path-v17-before-after.csv`](./SYNTHETIC-analytics-production-path-v17-before-after.csv).

## Historical measured v16 comparison

The v16 artifact evaluates twenty-four synthetic retrieval cases twice per
phase through the Analytics production agent loop. Its baseline was
`origin/main` at `db2f859fae3e5c9bab5ad5d1257d24a5ef152a8f`; its candidate source
snapshot is `7beae453965eb1590ddf80d0991a211aaa3aea7c`. Both phases used the
same prompts, expected tables, and synthetic membership model. The baseline
fixture omits projected-key metadata that the baseline source-index schema
could not represent; the candidate includes verified user and organization
roles for the aliased output columns.

Top-1 retrieval rose from 44/48 (91.7%) to 48/48 (100%). Hit@5 rose from 46/48
(95.8%) to 48/48 (100%). Both baseline misses were the aliased roster, which
the baseline could not identify from its renamed keys. Two other baseline
runs ranked an approved stale-index overlay above the current roster. The
candidate ranked the expected source first in both runs for all twenty-four
cases. All 96 runs completed without aborts; each made one `find-data` call and
no other or failed action. The stale-index signal appears in four rows in each
phase because that metadata is already present on the baseline branch.

Evaluated-code hashes are
`sha256:1f4a8302df8d7a73e6b2a1149052a93c5ebcf93d31beeee4994883c08ab4c7d1`
before and
`sha256:96c8192effb85af20b1109a9b525156ce9f5fbaa44d390870660e350f465a1b8`
after. Both phases use the same harness bytes,
`sha256:9bee80ec0ce2bfb05e67cb5be619c8a98b82c3ef8aee3d3945905d1e9820a73a`.
The checked-in validator pins the source revisions and hashes and verifies the
case/run pairs, safe CSV schema, completed production path, and stale-index
marker.

The harness uses a deterministic in-memory model and synthetic storage. It
does not call a hosted model, BigQuery, or a connected data source. Its
latencies are test-harness timings, not production latency measurements. The
CSV contains coded ranks, action counts, aggregate usage, and source revisions;
it contains no prompts, tool inputs, SQL, identities, or source values. The
artifact is
[`SYNTHETIC-analytics-production-path-v16-before-after.csv`](./SYNTHETIC-analytics-production-path-v16-before-after.csv).

## Historical v14 comparison (candidate snapshot `ba536105`)

The checked-in v14 artifact runs twenty-two synthetic cases twice in each
phase through the same production agent loop. The baseline is `origin/main` at
`0fb4de3ed8bd4e317543575c9b188b93db392d26`; the candidate source snapshot is
`ba53610515501c3f8657168c2c7346a713ac03df`. The added stale-index case places
an approved current workspace-assignment definition beside an old generated
roster entry. Both phases rank the approved definition first. The candidate
also labels the old entry as stale and unapproved, preserves it as a discovery
lead, and tells the agent to verify current schema and owner-approved
definitions. The explicit stale-entry marker appears in 0/44 baseline rows and
2/44 candidate rows, one for each run of that case.

Across the full case set, the baseline passed top-1 retrieval and production
path checks in 8/44 runs (18.2%) and returned the expected candidate in the top
five in 22/44 (50%). The candidate passed 44/44 (100%) on both measures. All 88
runs completed without aborts; each made one `find-data` call and no other or
failed action. Each run exercised the production prompt, caller and
organization context, final-response guard, and usage capture. The deterministic
in-memory engine does not call a hosted model, BigQuery, or a connected data
source. These scores measure synthetic retrieval and production-path
integrity, not hosted-model answer quality or production latency.

Evaluated code hashes are
`sha256:16768496b83db90ba30f74df6ea49f934c1ee11e6ba3fb8d1c7f65ee089e44ac`
before and
`sha256:70424c4be93310ac67c21eaf3af6d68e10c18d87e495bce2653c5c40b409e07c`
after. Both phases use identical harness bytes, hash
`sha256:04428dd484b504b646a93e1b6b35151fcc344568c8c1cd7780fa498822df8a93`.
The harness checked the source bytes against each pinned commit when it emitted
the CSV. The checked-in validator pins those revisions and hashes; it does not
recompute Git-object hashes.

The CSV contains only synthetic case IDs, source revisions, coded ranks and
scores, action counts, completion state, token totals, elapsed time, and the
stale-index marker. It contains no prompts, tool inputs, SQL, identities, or
source values. The v14 artifact is
[`SYNTHETIC-analytics-production-path-v14-before-after.csv`](./SYNTHETIC-analytics-production-path-v14-before-after.csv).

## Historical v13 comparison (candidate snapshot `586b87b5`)

The checked-in v13 artifact runs twenty-one synthetic cases twice in each
phase through the same production agent loop. The baseline is current
`origin/main` at `afe2ee7e45f6f3f380571a6d18918fc49d71c6e1`; the candidate
source snapshot is `586b87b50a99fe0d5023637df9c735bafb47d035`. The new case
places an approved monthly workspace-membership aggregate beside an unapproved
generated row-level membership bridge and checks that a plain membership
lookup selects the row-grain source. All prompts, models, identities, and
warehouse names are synthetic.

The baseline passed both the top-1 retrieval and production-path checks in
6/42 runs (14.3%) and retrieved the expected candidate in the top five in
20/42 runs (47.6%). The candidate passed 42/42 (100%) on both measures. All 84
runs completed without aborts; each made one `find-data` call and no other or
failed action. Each run exercised the production prompt, caller and
organization context, final-response guard, and usage capture. The deterministic
in-memory engine does not call a hosted model, BigQuery, or a connected data
source. These scores measure synthetic retrieval and production-path
integrity, not hosted-model answer quality or production latency.

Evaluated code hashes are
`sha256:5efa951a394abdcc5d39090b58d0277f1e0392a0ca1c984c96def8935cabcafe`
before and
`sha256:f1cda350256c3ec48f87bf151c7284291ecf4467b2c1f9fa5c5062e5fea8b764`
after. Both phases use identical harness bytes, hash
`sha256:91a1a65cebb864d1368b624b9dac7e2ab4c32710357e52c4a9c25c6c705a7d97`.
The harness checked the source bytes against each pinned commit when it emitted
the CSV. The checked-in validator pins those revisions and hashes; it does not
recompute Git-object hashes.

The CSV contains only synthetic case IDs, source revisions, coded ranks and
scores, action counts, completion state, token totals, and elapsed time. It
contains no prompts, tool inputs, SQL, identities, or source values. The v13
artifact is
[`SYNTHETIC-analytics-production-path-v13-before-after.csv`](./SYNTHETIC-analytics-production-path-v13-before-after.csv).

## Historical v12 comparison (candidate snapshot `35fdffa8`)

The checked-in v12 artifact runs twenty synthetic cases twice in each phase
through the same production agent loop. The baseline is `origin/main` at
`1999aef1ad68dcf9d44423fa95df1a7acb67e8c5`; the candidate is
`35fdffa8f309e2a7820d6c6e1e5decad04ebf989`. The fixture adds long exclusion
phrases and independent or negated removal clauses to the existing retrieval
cases. All prompts and identities are invented.

The baseline passed both retrieval and production-path checks in 6/40 runs
(15%) and retrieved the expected candidate in the top five in 18/40 (45%). The
candidate passed 40/40 (100%) on both measures. All 80 runs completed without
aborts; each made one `find-data` call and no other or failed action. Each run
also exercised the production prompt, caller and organization context, final
response guard, and usage capture. These are deterministic synthetic retrieval
and path-integrity scores, not hosted-model answer quality, real production
latency, or a re-run of private user transcripts.

The fixture supplies nonzero synthetic source-index scan counts to check that
the action reports omitted entries, omitted fields, truncated fields, and
unresolved tracking call sites. It does not execute `build-source-index.ts` or
measure production-index completeness. The CSV contains only case IDs,
provenance, coded scores and ranks, action counts, completion state, usage
totals, and elapsed time; it contains no prompts, tool inputs, SQL, identities,
or source values. The artifact is
[`SYNTHETIC-analytics-production-path-v12-before-after.csv`](./SYNTHETIC-analytics-production-path-v12-before-after.csv).

Evaluated code hashes are
`sha256:5bf2d8b224e03b2fb8081a0f61e6e626d420a51c2a3de60c6d6d50595063e8f7`
before and
`sha256:7b4e074cb1b62a254e00af4924c37ac923ff280dfdf74b63fb000a207d929e38`
after. Both phases use the same harness bytes, hash
`sha256:ca70d1a86c17bff2777ac22b4428f4f4370e4d71ad96e60266f22a54a6ba2792`.
The harness checks source bytes against the pinned commits when producing the
CSV. The checked-in validator checks the recorded hashes against reviewed
constants; it does not recompute Git-object hashes.

The validator keeps failed and aborted runs in the comparison with score zero,
so a regression remains reportable instead of suppressing the CSV. A separate
production-path test still fails when a candidate run does not pass.

## Historical v11 comparison (candidate snapshot `fb583843`)

This historical comparison measures candidate commit
`fb583843666f597c9eced3d7f4f297fd5cdcec26`. Later ranking and source-index
changes are not covered by its 32/32 after score. Its fixture supplies a
hard-coded synthetic source index and does not invoke `build-source-index.ts`.

The v11 comparison adds the case `negated-counts-preserve-role-detail` to cover
the review finding where a negated count request lost the following role
detail. It uses the same production path and synthetic fixtures as the earlier
v10 comparison, with sixteen cases run twice in each phase. The before phase is
pinned to `d0caebd20464a2a00ad417c78943d81438d9333a`; the after phase measures
the Analytics source changes at `fb583843666f597c9eced3d7f4f297fd5cdcec26`.

The evaluated code hashes are
`sha256:a31ae9051b291723b73c09752df3711dcea125df319de7b96483a52769def191`
before and
`sha256:2b0445b08a32d9afabc18ba1e429ee07898ad7033c4575d70e46ac6f184f9358`
after. Both phases use the candidate harness, whose hash is
`sha256:b9acd1d7c3c9758d57a4485fd56a72c7954ad2b3fefe74f128fc16fb1ca18472`.
Generation checks compare the harness and production source bytes with pinned
Git objects. The checked-in validator compares the CSV's hash fields with its
pinned constants; it does not independently read Git objects.

Top-1 retrieval rose from 6/32 to 32/32 runs (18.75% to 100%). Hit@5 rose from
18/32 to 32/32 (56.25% to 100%). The added role-detail case moved from rank 4
before to rank 1 after. All 64 runs completed without aborts; each made one
`find-data` call and no other or failed action. These scores use the
deterministic synthetic engine, so they measure retrieval and production-path
integrity rather than hosted-model answer quality or production latency. The
v11 artifact is
`SYNTHETIC-analytics-production-path-v11-before-after.csv`.

To reproduce the v11 comparison, run the harness from candidate commit
`fb583843666f597c9eced3d7f4f297fd5cdcec26` twice: once against production
source files pinned to baseline commit
`d0caebd20464a2a00ad417c78943d81438d9333a`, and once with all evaluated source
files at the candidate commit. Set `ANALYTICS_EVAL_HARNESS_REVISION` to the
candidate commit for both runs and retain the emitted CSV only after verifying
that the before/after rows share the harness hash and fixture revision.

The v10 artifact and its original provenance remain unchanged for historical
comparison; the validator continues to check both versions against their own
pinned cases and commits.

## Historical v10 reproduction

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

### Historical v10 results

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
