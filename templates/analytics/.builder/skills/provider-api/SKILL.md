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
  URLs, placeholders, and examples.
- `provider-api-docs` to fetch registered provider docs/spec URLs.
- `provider-api-request` to make the exact HTTP call. Credentials are injected
  server-side, private/internal URLs are blocked, and secrets are redacted.

Examples:

```bash
pnpm action provider-api-catalog --provider=hubspot

pnpm action provider-api-request --provider=hubspot --method=POST --path=/crm/v3/objects/deals/search --body='{"filterGroups":[{"filters":[{"propertyName":"products","operator":"CONTAINS_TOKEN","value":"Publish"}]}],"properties":["dealname","products","dealstage","closedate"],"limit":100}'

pnpm action provider-api-request --provider=bigquery --method=GET --path=/projects/{projectId}/datasets
```

Always cite provider, method, path, status, filters, row/sample count, and
pagination/coverage gaps in analytical answers.
