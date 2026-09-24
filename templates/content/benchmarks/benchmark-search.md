# Content search latency loop

Use a task-owned, schema-only Neon branch. Confirm its project, branch ID, endpoint, PostgreSQL version, region, and compute settings in Neon before writing anything. Keep the connection URL in an ignored local file; never put it in the manifest, report, shell history, or a PR. Do not use a normal PR preview database for this fixture.

After checking the branch in Neon, provision a branch-only identity sentinel in its SQL Editor before running the benchmark. Replace these obviously fake values with the verified project, branch, and pooled endpoint. The runner refuses to migrate, seed, measure, or clean up when the sentinel is absent or differs from its manifest; changing the manifest alone cannot authorize a different database.

```sql
CREATE TABLE content_search_benchmark_identity (
  id integer PRIMARY KEY CHECK (id = 1),
  project_id text NOT NULL,
  branch_id text NOT NULL,
  endpoint_host text NOT NULL
);
INSERT INTO content_search_benchmark_identity (id, project_id, branch_id, endpoint_host)
VALUES (1, 'example-project', 'br-example-task-branch', 'ep-example-pooler.example.neon.tech');
```

Create an ignored manifest such as root `.tmp/content-search-neon-manifest.json`:

```json
{
  "projectId": "example-project",
  "branchId": "br-example-task-branch",
  "branchName": "dev/content-search-latency-example",
  "endpointHost": "ep-example-pooler.example.neon.tech",
  "database": "neondb",
  "expiresAt": "2026-10-01T00:00:00.000Z",
  "ownerEmail": "benchmark-owner@example.invalid",
  "outsiderEmail": "benchmark-outsider@example.invalid",
  "spaceId": "benchmark-personal-space",
  "outsiderSpaceId": "benchmark-outsider-space",
  "fixturePrefix": "qa-content-search-example-"
}
```

From the repository root, pass the same manifest and local URL file to every command:

```sh
corepack pnpm --filter content benchmark:search inspect --manifest ../../.tmp/content-search-neon-manifest.json --url-file ../../.tmp/content-search-neon-url.txt
corepack pnpm --filter content benchmark:search migrate --manifest ../../.tmp/content-search-neon-manifest.json --url-file ../../.tmp/content-search-neon-url.txt
corepack pnpm --filter content benchmark:search seed --manifest ../../.tmp/content-search-neon-manifest.json --url-file ../../.tmp/content-search-neon-url.txt --profile A
corepack pnpm --filter content benchmark:search measure --manifest ../../.tmp/content-search-neon-manifest.json --url-file ../../.tmp/content-search-neon-url.txt --profile A --report ../../.tmp/content-search-A.json
corepack pnpm --filter content benchmark:search diagnose --manifest ../../.tmp/content-search-neon-manifest.json --url-file ../../.tmp/content-search-neon-url.txt --profile A --report ../../.tmp/content-search-plans-A.json
corepack pnpm --filter content benchmark:search cleanup --manifest ../../.tmp/content-search-neon-manifest.json --url-file ../../.tmp/content-search-neon-url.txt
```

Repeat `seed`, `measure`, `diagnose`, and `cleanup` for profile B. Run `cleanup` independently after an interrupted command, then `inspect` to verify zero. The cleanup predicate is restricted to the manifest's ID prefix, owner identities, and space IDs. The branch remains a separate task-owned resource; delete it in Neon when the review lifetime ends.

Each profile contains 10,000 authorized documents plus 2,000 private outsiders. Profile A has short bodies; B has the frozen 400/4,000/40,000/200,000 character distribution. The runner checks exact counts and the protected first result on every call. `measure` excludes five successful warmups per query, then records three sequential 30-call batches for each of four query classes. It writes raw samples even when a p95 gate fails. Every batch and class must be at or below 400 ms. `diagnose` captures the parameterized statements, per-operation wall time, and separate PostgreSQL `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` plans; it is never a timing substitute for `measure`.

Local timing includes the developer machine's network path to Neon. A hosted checkpoint uses the same fixture and code on a task-owned app configured only for this Neon branch; record its runtime, effective endpoint, and warm `Server-Timing: app` samples separately. Do not infer hosted latency from local SQL plans or subtract a network floor.

For a prebuilt Netlify checkpoint, set the task site's Functions region to the Neon branch's region before upload, then verify the deployed `server` function's region in Netlify's deploy details. A `netlify.toml` region entry did not change the region of the generated Functions in a `--no-build` upload. The Content beta/production prebuilt workflow sets and verifies the site-level region on publish; a local checkpoint must do the equivalent on its task-owned site. Keep the earlier, mismatched-region reports when comparing the result.
