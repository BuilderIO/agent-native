# Provider API Integrations

Read this when an action needs to call an external provider API — HubSpot,
Gong, Slack, any credentialed third-party service — for ad hoc analysis,
querying, reporting, or cross-source research.

For provider integrations used in ad hoc analysis, querying, reporting, or
cross-source research, do not hardcode every provider endpoint as a separate
rigid action and do not encode one lookback window, filter shape, or pagination
strategy as the only path the agent can take. Expose the shared provider API
action trio instead:

- `provider-api-catalog`: lists provider base URLs, auth style, credential keys,
  docs/spec URLs, placeholders, and examples without exposing secrets.
- `provider-api-docs`: fetches public provider docs/spec/changelog URLs when
  the exact endpoint, filter operator, payload shape, or pagination contract is
  uncertain. Registered docs URLs are curated starting points. Use
  `responseMode: "markdown"` for clean readable docs, or
  `responseMode: "matches"` with `search: { query | terms | regex }` for
  compact snippets instead of flooding context with raw HTML.
- `provider-api-request`: makes a constrained authenticated HTTP request to the
  provider host, injects configured credentials, blocks private/internal URLs,
  and redacts secrets.

Use `@agent-native/core/provider-api` as the shared substrate, and build these
actions as thin factory imports rather than copying `defineAction` schemas and
handlers into each template:

```ts
import {
  createProviderApiCatalogAction,
  createProviderApiDocsAction,
  createProviderApiRequestAction,
} from "@agent-native/core/provider-api/actions/provider-api";
import {
  createDeleteStagedDatasetAction,
  createListStagedDatasetsAction,
  createQueryStagedDatasetAction,
} from "@agent-native/core/provider-api/actions/staged-datasets";
```

Pass the app's existing provider runtime to the provider factories, and pass
its app id to the staged-dataset factories. Keep app-specific descriptions,
provider allow-lists, HTTP/tool-callability settings, and credential adapters
as factory options. Only add a thin credential adapter when the app has
app-specific credential lookup rules. If the app stores a built-in provider's
OAuth grant under a narrower local provider id, use the runtime's
`oauthProviderOverrides` instead of duplicating provider config. If credentials
are stored on shareable/resource rows rather than in the shared credential or
OAuth-token stores, build a resolver that enforces those access checks before
exposing raw provider requests. Keep `provider-api-request` `http: false`
unless a separate UI permission model authorizes arbitrary provider writes.
Specific actions such as `search-records`, `search-emails`, or `sync-source`
are convenience shortcuts, not capability limits; agents should fall back to
the provider API trio when a question requires an endpoint or filter that the
shortcut does not model.

This is a framework tenet. The safety boundary should be provider host
allow-listing, credential scoping, auth injection, private-network blocking,
secret redaction, and user/org access checks, not an artificially small set of
hand-authored read actions. If the upstream provider API supports a capability,
the agent should normally be able to reach it through `provider-api-request`
with the user's configured credentials. For large responses, expose staging
(`stageAs`, `itemsPath`, pagination, and `query-staged-dataset`) or sandboxed
code execution so the agent can reduce data without flooding context.

For broad provider questions, cross-source joins, corpus-wide mention/search
work, classification, or any answer where absence matters, design the action
surface for full coverage instead of convenience-only samples. The agent should
be able to fetch every relevant page or an explicitly bounded cohort, stage or
save the raw provider response outside chat, and then use
`query-staged-dataset`, `run-code`, or provider-side search to count, join,
grep, classify, and aggregate. Tool descriptions and AGENTS.md guidance should
teach agents to report source, filters, time window, row/record counts,
pagination status, truncation, failed pages, and uncovered gaps. They must not
turn default limits, sampled rows, truncated excerpts, or aborted calls into a
confident "none found", "all records", or exhaustive conclusion.

For public web pages and docs, prefer the token-efficient path: `web-search`
to find likely URLs, `web-request` or `provider-api-docs` with clean
`responseMode` output to read a page, and `run-code` with `webRead()` /
`webFetch()` when you need to grep, aggregate, or compare many pages before
returning a small result.

For LONG compute, `run-code` supports durable background executions: pass
`background: true` and the code is enqueued to a `sandbox_executions` row and
executed out-of-band with a generous budget (default 10 min), surviving the
hosted agent run's ~40s soft timeout. The call returns
`{ executionId, status: "queued" }` immediately with polling guidance; check
progress with `run-code` `{ executionId }` (or the `get-code-execution` tool
where registered) — results persist after completion. Use background for big
cross-source joins, multi-page provider sweeps, and heavy analysis scripts;
keep quick scripts in the default foreground mode. Agents should continue
other work between polls, and on `failed`/`timed_out` split the computation or
persist intermediate progress with `workspaceWrite` and re-run.
