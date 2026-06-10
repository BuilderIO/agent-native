---
"@agent-native/core": minor
"@agent-native/dispatch": minor
---

**Custom provider registry** — register any API provider at runtime

A new `custom_api_providers` SQL table (created on first use, additive) stores
user/org-scoped provider registrations so the agent can call APIs that are not
in the 24 built-in PROVIDER_CONFIGS:

- `upsertCustomProvider`, `deleteCustomProvider`, `listCustomProviders`,
  `getCustomProvider` — CRUD helpers exported from `@agent-native/core/provider-api`.
- `validateCustomBaseUrl` — SSRF-safe URL validation for registration time.
- `createProviderApiRuntime` now accepts `getCustomProviders?: () => Promise<CustomProviderConfig[]>`.
  Custom providers are merged into the catalog after built-ins; they cannot
  shadow built-in ids.
- Auth kinds supported for custom providers: `none`, `bearer`, `basic`,
  `api-key-header`. `google-service-account` and `oauth-bearer` are not
  supported (require out-of-band setup).
- Credentials live in the existing secrets/credentials store — the provider
  row stores only credential key NAMES, never values.
- SSRF guard (`isBlockedExtensionUrlWithDns`) is enforced at registration time
  and again at every request.

**New Dispatch action: `provider-api-register`**

Register, update, delete, or list custom providers:

```
{ operation: "upsert"|"delete"|"list"|"get",
  id, label, baseUrl, auth, docsUrls?,
  allowedHostSuffixes?, defaultHeaders?, notes?, scope? }
```

**Updated Dispatch actions**

`provider-api-catalog`, `provider-api-docs`, and `provider-api-request` now
accept any provider id (built-in or custom) — the `provider` field is relaxed
from `z.enum(BUILT_IN_IDS)` to `z.string()` with runtime validation against the
merged registry. Unknown provider errors include the list of known provider ids.

---

**Open docs fetching** in `provider-api-docs`

`fetchProviderApiDocs` now allows ANY public `https`/`http` URL — not just
URLs same-origin with registered `docsUrls`/`specUrls`. The SSRF guard and
byte caps still apply. Registered docs/spec URLs remain available as curated
starting points in the catalog output. The Dispatch `provider-api-docs` action
description is updated to reflect this.

---

**New `web-search` agent tool** (`packages/core/src/extensions/web-search-tool.ts`)

Registers a `web-search` tool in dev and prod agent tool registries:

- Input: `{ query: string, count?: number (default 5, max 10) }`.
- **Pluggable backends** — at call time the first configured key wins:
  1. `BRAVE_SEARCH_API_KEY` → Brave Search API
  2. `TAVILY_API_KEY` → Tavily
  3. `EXA_API_KEY` → Exa
     Keys are resolved from the per-user/org credentials store first, then env vars.
- Returns a title / URL / snippet list with guidance to follow up via
  `web-request` or `provider-api-docs`.
- If no backend is configured, returns a helpful message listing the three keys.
- Description: "Search the public web — use to find API docs, endpoints, or
  current information, then fetch promising URLs with web-request or
  provider-api-docs."

**Framework secret registrations** (`register-framework-secrets.ts`)

`BRAVE_SEARCH_API_KEY`, `TAVILY_API_KEY`, and `EXA_API_KEY` are registered as
optional workspace-scoped secrets so they surface in the settings UI.
