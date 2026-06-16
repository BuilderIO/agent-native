---
name: analysis-workspace
description: >-
  How to use durable workspace files for large-scale multi-source analyses: chunked
  batch processing with per-item memos, run-code aggregation, saveToFile for
  big API pulls, and synthesizing across files that exceed one context window.
---

# Analysis Workspace

The analysis workspace (`workspace-files` tool) gives the agent durable
scratch storage that persists across conversations, scoped to the current org
or user. Use it to stage intermediate results that would overflow the context
window, then read them back selectively for synthesis.

## When to Use

- **Batch fan-out** with 30+ items (accounts, calls, deals, tickets, messages,
  documents, events): write a
  per-item memo file after each item, then synthesize across all memos in a
  final pass.
- **Large API payloads**: use `saveToFile` on `provider-api-request` or
  `web-request` to write a 20 MB dataset to a workspace file instead of
  returning it in context.
- **Provider-wide search/count/classification**: build a durable corpus first,
  then search or aggregate it with `run-code`. This is required when the user
  expects broad recall or when a negative answer such as "no mentions" would be
  misleading if based on a sample.
- **Multi-step analyses** that span multiple conversations or agent turns.
- **run-code aggregation**: call `workspaceRead` / `workspaceWrite` inside a
  `run-code` block to load and process data that's too large to print as output.

## Workspace File Tool

The `workspace-files` tool has the following actions:

| Action  | Required params         | Returns                                          |
|---------|------------------------|--------------------------------------------------|
| write   | path, content          | `{ ok, path, sizeBytes, updatedAt }`             |
| append  | path, content          | `{ ok, path, sizeBytes, updatedAt }`             |
| read    | path                   | `{ ok, path, content, sizeBytes, ... }`          |
| list    | —                      | `{ ok, count, files: [{path, sizeBytes, ...}] }` |
| delete  | path                   | `{ ok, deleted, path }`                          |
| grep    | pattern                | `{ ok, matches: [{path, line, text}] }`          |

- `read` supports `offset` and `maxChars` for paging large files.
- `list` supports a `path` prefix filter, e.g. `path: "analysis/q2/"`.
- Files cap at 2 MB each; total per-scope cap is 200 MB.
- Files persist across conversations — clean up temp files with `delete`.

## Chunked Batch Analysis (30+ items)

For large fan-outs (account deep dives, Gong call reviews, deal cohorts):

1. **Define cohort**: fetch the item list (e.g. `hubspot-records` for accounts).
2. **Chunk**: process 5–10 items per pass to avoid context overflow.
3. **Per-item memo**: for each item, fetch evidence and write a memo file:
   ```
   workspace-files action=write
     path="analysis/q2-churn/acme-corp.md"
     content="## Acme Corp\n\n**ARR**: $120k\n**Risk signals**: ..."
   ```
4. **Synthesize**: after all items are processed, list files and read each memo:
   ```
   workspace-files action=list path="analysis/q2-churn/"
   ```
   Then read each file and synthesize findings into the final answer or a
   saved analysis.
5. **Cleanup** (optional): delete temporary files when done.

For very large cohorts (100+ items), use agent-teams sub-agents to process
chunks in parallel — each sub-agent writes its memos independently, the
orchestrator synthesizes at the end.

## Corpus-First Provider Search

Use this workflow for arbitrary provider questions where a canned action is too
narrow, where records must be joined across systems, or where absence matters:

1. Discover the provider surface with `provider-api-catalog` and
   `provider-api-docs` when endpoint/filter/pagination details are uncertain.
2. Pull the relevant records with `provider-api-request`. Use `fetchAllPages`
   for cursor pagination, `stageAs` for queryable staged datasets, and
   `saveToFile` for large raw responses.
3. Use `run-code` to call `providerFetch` or `appAction` in loops, write
   intermediate files, normalize records, join identity fields, and aggregate.
4. Validate coverage before synthesis. Track pages fetched, records inspected,
   truncation flags, aborted calls, and records skipped for missing joins.
5. Finalize with the answer plus coverage and caveats. If coverage is partial,
   say so directly; never state "none found", "all records", or an exhaustive
   conclusion from sampled, truncated, or aborted data.

## saveToFile on Provider API Requests

Attach `saveToFile` to `provider-api-request` or `web-request` to write the
full response body to a workspace file instead of returning it in context.
Allows up to 20 MB per call.

```
provider-api-request
  provider=hubspot
  method=POST
  path=/crm/v3/objects/deals/search
  body={ filterGroups: [...], limit: 200 }
  saveToFile="analysis/hubspot-deals-2026-q2.json"
```

Returns: `{ savedToFile: true, savedTo, status, bytes, contentType, preview }`.

Then use `run-code` to process the saved file:
```javascript
const raw = await workspaceRead("analysis/hubspot-deals-2026-q2.json");
const deals = JSON.parse(raw);
// … aggregate, filter, join …
```

## fetchAllPages

Use `fetchAllPages` on `provider-api-request` to automatically paginate
cursor-based APIs. Combine with `saveToFile` to write the full dataset:

```
provider-api-request
  provider=hubspot
  path=/crm/v3/objects/deals
  query={ limit: 100 }
  fetchAllPages={
    cursorPath: "paging.next.after",
    cursorParam: "after",
    itemsPath: "results",
    maxPages: 20
  }
  saveToFile="analysis/all-deals.json"
```

Common cursor paths:
- HubSpot: `paging.next.after` / `after`
- Gong: `records.cursor` / `cursor`
- Pylon: `nextCursor` / `cursor`
- Slack: `response_metadata.next_cursor` / `cursor`
- PostHog: `next` (full URL — extract token manually if needed)

## run-code + Workspace Integration

Inside a `run-code` block you have access to workspace helpers:

```javascript
// Read a previously saved API response
const raw = await workspaceRead("analysis/deals.json");
const deals = JSON.parse(raw);

// Process data
const byStage = {};
for (const deal of deals) {
  const stage = deal.properties.dealstage ?? "unknown";
  byStage[stage] = (byStage[stage] ?? 0) + 1;
}

// Write the aggregated result back
await workspaceWrite(
  "analysis/deals-by-stage.json",
  JSON.stringify(byStage, null, 2),
  "application/json"
);
console.log(JSON.stringify(byStage, null, 2));
```

Workspace helpers: `workspaceRead(path, opts?)`, `workspaceWrite(path, content, contentType?)`,
`workspaceAppend(path, content)`, `workspaceList(prefix?)`.

## Provider API Discovery

When you need an API endpoint that isn't covered by a canned action:

1. `provider-api-catalog` — list available providers and their base URLs, auth,
   and example paths.
2. `provider-api-docs provider=<id> url=<docs-url>` — fetch any public docs or
   OpenAPI spec URL. Works for any `https://` URL.
3. `provider-api-request` — call the endpoint directly.

Use `web-request` to fetch public REST docs pages before registering a custom
provider.

## Registering Custom Providers

For APIs not in the built-in catalog, register them with
`provider-api-register` (dispatch action):

```
provider-api-register
  id="my-internal-api"
  label="My Internal API"
  baseUrl="https://api.mycompany.com"
  auth={ type: "bearer", credentialKey: "MY_API_TOKEN" }
  docsUrls=["https://docs.mycompany.com/api"]
```

Then call it with `provider-api-request provider=my-internal-api ...` and the
agent's credential system handles auth automatically.

## Learnings Flywheel

After any significant batch analysis, record discoveries to `LEARNINGS.md`
via the `resources` tool (`action: "write"`). Capture confirmed schema paths,
cursor fields, identity join keys, and pagination patterns.
