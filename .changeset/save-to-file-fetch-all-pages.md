---
"@agent-native/core": minor
"@agent-native/dispatch": minor
---

Add `saveToFile` and `fetchAllPages` to `provider-api-request` and `saveToFile` to `web-request`.

- `saveToFile?: string` on `provider-api-request` and `web-request`: writes full response
  body to a workspace file path instead of returning it in context. Allows up to 20 MB
  (vs normal 4 MB). Returns compact summary `{ savedToFile, savedTo, status, bytes, contentType, preview }`.
- `fetchAllPages?: { cursorPath, cursorParam, itemsPath?, maxPages? }` on `provider-api-request`:
  generic cursor pagination — re-issues requests until cursor is empty or maxPages (default 10,
  max 50) is reached; accumulates items from `itemsPath`. Combines naturally with `saveToFile`.
- `workspace-files` tool added to sandbox bridge default allowlist.
