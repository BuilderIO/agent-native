---
name: apollo
description: >
  Enrich contacts and companies via Apollo.io for prospecting and sales intelligence.
  Use this skill when the user asks about contact details, company research, or finding decision-makers.
---

# Apollo.io Integration (Contact & Company Enrichment)

## Use the shared provider API actions

Apollo has no provider-specific action, route, or server client in Analytics.
Use the shared provider API substrate:

- `provider-api-catalog` with `provider: "apollo"` to inspect the registered
  base URL, authentication, official docs, placeholders, and examples.
- `provider-api-docs` before relying on a remembered endpoint or request body.
- `provider-api-request` for the authenticated request. The server injects
  `APOLLO_API_KEY` as `x-api-key`; never pass the key in action arguments.

For large searches, pass `stageAs` and the documented pagination settings, then
use `query-staged-dataset` to filter or aggregate without loading the full
response into agent context.

## Example workflow

```bash
pnpm action provider-api-catalog --provider=apollo
pnpm action provider-api-docs --provider=apollo
pnpm action provider-api-request --provider=apollo --method=POST --path=/api/v1/mixed_people/search --body='{"q_keywords":"vp marketing","page":1,"per_page":10}'
```

## Key Patterns & Gotchas

- Apollo search and enrichment endpoints use POST; confirm current endpoint
  paths and payloads through `provider-api-docs` before calling them.
- Report the method, path, filters, returned row count, and pagination coverage.
- Do not treat a default page as complete coverage.
