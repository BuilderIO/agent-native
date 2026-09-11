---
name: commonroom
description: >
  Look up community member engagement and signals via Common Room.
  Use this skill when the user asks about community activity, member engagement, or community signals.
---

# Common Room Integration (Community)

## Use the shared provider API actions

Common Room has no provider-specific action, route, or server client in
Analytics. Use the shared provider API substrate:

- `provider-api-catalog` with `provider: "commonroom"` to inspect the
  registered base URL, authentication, official docs, and examples.
- `provider-api-docs` before relying on a remembered endpoint, filter, or
  pagination shape.
- `provider-api-request` for the authenticated request. The server injects
  `COMMONROOM_API_TOKEN` as a bearer token; never pass it in action arguments.

For broad member or activity pulls, pass `stageAs` and the documented
pagination settings, then use `query-staged-dataset` to search or aggregate the
complete staged cohort.

## Example workflow

```bash
pnpm action provider-api-catalog --provider=commonroom
pnpm action provider-api-docs --provider=commonroom
pnpm action provider-api-request --provider=commonroom --method=GET --path=/members
```

## Key Patterns & Gotchas

- Verify member-search, activity, and segment endpoints in
  `provider-api-docs`; do not rely on the removed bespoke client's assumptions.
- Report the method, path, filters, returned row count, and pagination coverage.
- Use raw activity/member evidence for exhaustive or absence-sensitive claims.
