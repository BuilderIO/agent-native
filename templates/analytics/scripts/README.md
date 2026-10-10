# Analytics source index

Build an occasional, revision-stamped metadata index from dbt and tracking
source code, then upload the JSON from **Data Dictionary → Import source index**.
The index is stored in the selected organization, expires as a freshness signal
after 90 days, and remains unapproved reference metadata. It never contains
warehouse rows or copied SQL.

```sh
pnpm --dir templates/analytics exec tsx scripts/build-source-index.ts \
  --dbt-root /path/to/dbt \
  --code-root /path/to/builder-internal \
  --code-root /path/to/ai-services \
  --out .tmp/analytics-source-index.json
```

The compiler scans schema descriptions, SQL structure, and static tracking
calls. It records source revisions and content fingerprints, and omits raw
query text and row values. For Git-backed dbt roots, `generatedAt` uses the
latest root's commit committer time in UTC, so the same dbt commits produce the
same timestamp. Generation fails if any dbt root lacks Git commit metadata.
Fingerprints still change when indexed files differ from the commit.
Keep the generated JSON outside Git because it can contain internal table,
event, and column names. CI tests revisions, fingerprints, commit-time
generation, missing-commit failure, and the 90-day stale signal against
temporary synthetic repositories in the existing Analytics fast-test lane; it
never checks out or reads private source repositories. The
90-day UI signal asks an admin to rebuild and compare current source revisions;
it does not claim to detect a change in a private repository automatically.

Sigma is optional. To index only workbook elements that have been explicitly
reviewed, create a private manifest with this shape and keep it outside Git:

```json
{
  "schemaVersion": 1,
  "items": [
    {
      "workbookId": "<reviewed-workbook-id>",
      "elementIds": ["<reviewed-element-id>"]
    }
  ]
}
```

Then run the same command with `--sigma-reviewed-manifest /path/to/review.json`
and `--sigma-env-file /path/to/ai-services/.env`. The generator reads only
`SIGMA_BASE_URL`, `SIGMA_CLIENT_ID`, and `SIGMA_CLIENT_SECRET` from that named
file; it never reads `process.env` for Sigma and never writes credential values
to the index. Sigma is read through its client-credentials token exchange and
paginated workbook metadata APIs; the index keeps selected workbook/element
titles, output columns, table references, and a content fingerprint. It drops
SQL text and is never treated as canonical. The Analytics agent still checks
dbt for schema and grain and verifies a live query before reporting results.
