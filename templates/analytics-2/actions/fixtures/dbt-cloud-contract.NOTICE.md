# dbt Cloud contract fixture — attribution

`dbt-cloud-contract.fixture.json` contains **expected metadata values** derived from the
public dbt sample project:

- Source: `https://github.com/dbt-labs/jaffle_shop_duckdb` (branch `duckdb`)
- License: **Apache License 2.0** (the sample ships its `LICENSE`; GitHub reports
  `spdx_id: Apache-2.0`)
- What is kept: model/source unique ids, names, descriptions, catalog column names/types/
  descriptions, test names/column/status, freshness status and timestamp, lineage parent
  ids, and the dbt docs URL shape. These are metadata values, not the sample's SQL, macros,
  or project files.
- What is not kept: no SQL, no manifest/catalog file paths, no credentials, no real
  dbt Cloud account/project/environment ids (synthetic `42`/`77`/`9`/`5`/`9001`), no
  key-shaped values, no absolute filesystem paths.
- Mapping: the artifact database `jaffle_shop` is not a valid
  GCP project id, so the fixture declares provider project `qa-dbt-sample` with schema
  `main` and the same table identifiers. dbt unique ids, descriptions, columns, tests and
  lineage are unchanged from the public sample.

GraphQL response envelopes follow the public dbt Discovery schema
(`https://metadata.cloud.getdbt.com/graphql` introspection). The `query` fields are this
test suite's own written request documents for that public schema; they are not copied
from the sample project and contain no sample SQL, macros, or project files. All
responses are recorded fixtures; this file is not a live dbt Cloud response and no dbt
Cloud account was used.
