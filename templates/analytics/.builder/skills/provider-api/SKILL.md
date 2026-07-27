---
name: provider-api
description: >
  Make arbitrary authenticated HTTP calls to configured Analytics provider APIs
  when first-class actions are too narrow.
---

# Provider API Escape Hatch

Use provider-specific actions for common jobs, but treat them as shortcuts, not
limits. When a first-class action cannot express the endpoint, filters, request
body, pagination mode, or API version needed, use:

- `provider-api-catalog` to inspect provider base URL, auth style, docs/spec
  URLs, placeholders, examples, and reusable `corpusRecipes`.
- `provider-api-docs` to fetch registered provider docs/spec URLs.
- `provider-api-request` to make the exact HTTP call. Credentials are injected
  server-side, private/internal URLs are blocked, and secrets are redacted.

## Clay

Clay is a credentialed GTM provider capability, not a messaging channel. Use
provider `clay`; the server injects `CLAY_PUBLIC_API_KEY` with the official
`clay-api-key` header and restricts requests to the exact
`https://api.clay.com` origin, with `/public/v0` as the default base path. Use
`provider-api-docs` for the registered official docs and OpenAPI spec on
`developers.clay.com`.

Clay searches are stateful company/people iterators, routines are asynchronous,
and table queries are read-only, Enterprise-only, and require a known table id.
The optional local Clay CLI/MCP browser login is separate from hosted Agent
Native credentials. Do not install or vendor that plugin by default; its public
repository currently declares no license.

Examples:

```bash
pnpm action provider-api-catalog --provider=hubspot

pnpm action provider-api-request --provider=hubspot --method=POST --path=/crm/v3/objects/deals/search --body='{"filterGroups":[{"filters":[{"propertyName":"products","operator":"CONTAINS_TOKEN","value":"Publish"}]}],"properties":["dealname","products","dealstage","closedate"],"limit":100}'

pnpm action provider-api-request --provider=bigquery --method=GET --path=/projects/{projectId}/datasets
```

Always cite provider, method, path, status, filters, row/sample count, and
pagination/coverage gaps in analytical answers.

For source-record body searches across transcripts, messages, tickets, issues,
notes, documents, or conversation logs, use the raw body endpoint or native
provider search endpoint for that record type. Parent/container metadata such as
call lists, titles, summaries, or briefs is discovery evidence only; it cannot
support a "no mentions" or complete body-text claim.

Example corpus recipe:

```bash
pnpm action provider-corpus-job --operation=start --mode=batch-search --request='{"provider":"gong","method":"POST","path":"/calls/transcript","body":{"filter":{"callIds":[]}}}' --batch='{"inputDatasetId":"<staged-call-id-dataset>","inputValuePath":"id","batchSize":20,"itemBodyPath":"filter.callIds","responseItemsPath":"callTranscripts"}' --search='{"queries":["Figma MCP","model context protocol"],"textPaths":["transcript"],"idPaths":["callId"]}'
```
