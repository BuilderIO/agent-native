---
name: data-programs
description: >-
  Save a run-code fetch/join/aggregate script as a stored, refreshable data
  source that dashboard panels bind to and render. Use when an ad-hoc
  provider-api-request or run-code analysis should become a live dashboard
  panel other users see, or when a cohort/join needs an arbitrary property
  filter, an IN-search, or a cross-provider stitch a canned action can't
  express.
---

# Data Programs

A **data program** is a named, stored, agent-authored JS script that fetches,
joins, filters, or aggregates provider or app data, and is rendered by a
dashboard panel. It is the generic answer to "I can query this once in chat —
now make it a panel other people can see, that refreshes on its own."

There is no new credential machinery here. A data program is exactly a
`run-code` script (same `providerFetch` / `providerFetchAll` /
`providerSearchAll` / `appAction` / `workspace*` globals you already use for
ad-hoc analysis) plus two things: a stored, named identity, and a small
`emit(rows, schema)` contract so the result can be cached and charted. Read
`provider-api` first if you have not already — data programs assume you know
`provider-api-catalog` / `provider-api-docs` / `provider-api-request`.

## When to reach for this vs. a canned action

- The common case (won/lost by pipeline, a standard date-range rollup) already
  has a first-class action (`hubspot-deals`, etc.) — use that.
- A one-time chat question — just query it with `run-code` or
  `provider-api-request` and answer directly. Don't save a program for
  something you'll never look at again.
- A cohort needs an arbitrary property filter, an IN-search over custom
  values, or a join against a second provider, **and** the user (or a
  dashboard) will want to see it again with fresh data — that's a data
  program.

## Authoring workflow

1. **Prototype in chat first.** Write the fetch/join/aggregate logic as a
   normal `run-code` script and confirm it returns the rows you expect.
2. **Wrap it to call `emit(rows, schema)` exactly once** at the end instead of
   returning/printing the result (see contract below).
3. **Save it** with `save-data-program`:
   ```
   save-data-program(
     name: "risk-meeting-cohort",      // stable slug, unique per your account
     title: "Risk Meeting — HubSpot cohort",
     description: "...",
     code: "<the run-code script text>",
     defaultParams: { riskStatuses: ["Churn Risk"] },  // optional
     refreshMode: "ttl",               // "ttl" | "manual"
     refreshTtlMs: 900000,             // optional, floor 60000
     background: false,                // true for slow multi-minute joins
   )
   ```
   This **dry-runs the code with `defaultParams` before persisting** and
   rejects the save with a structured error if it fails — a broken program is
   never stored. On success it returns
   `{ programId, rowCount, columns, sampleRows }`: use that as your proof the
   program actually produces the rows you expect before telling the user it's
   ready.
4. **Bind a dashboard panel to it.** Panels reference programs through the
   `"program"` source; the panel's `sql` field carries a JSON descriptor
   instead of a query string:
   ```json
   { "programId": "dp_...", "params": { "riskStatuses": ["Churn Risk"] } }
   ```
   The panel renders through the exact same chart/table components as every
   other panel source — it only ever receives `{ rows, schema }`.
5. **Iterate without re-saving** with `preview-data-program(code, params?)` —
   same dry-run path, no persisted row. Use this while tuning a script before
   calling `save-data-program` again.
6. **Refresh on demand** with `run-data-program(programId, params?,
forceRefresh?, includeRows?)` — this is what the agent calls to get a
   compact proof-of-result (`rowCount`, `columns`, `sampleRows`) without
   waiting for a panel view. Pass `includeRows: true` only when you need the
   full (capped) row set back in context.

## The sandbox surface

Inside a data program you get exactly the `run-code` globals, plus one
addition:

- `providerFetch(provider, path, init?)`, `providerFetchAll(...)`,
  `providerSearchAll(...)` — the same generic provider-access helpers used for
  ad-hoc analysis. See `provider-api` for the pagination/search option shapes.
- `appAction(name, params)`, `webFetch`, `workspace*` Resources helpers — same
  as `run-code`.
- `params` — a **frozen** global object: the params passed into this run
  (`defaultParams` merged by the caller, or whatever was passed to
  `run-data-program` / the panel descriptor). Read it, never mutate it.
- `emit(rows, schema?)` — call this **exactly once**, at the end, with your
  result. A second call throws. `schema` is optional —
  `{ name: string, type: string }[]` — inferred automatically from the first
  50 rows when omitted (a column is `"json"` if rows disagree on primitive
  type, otherwise `"number"` / `"string"` / `"boolean"`). `console.log` remains
  completely free for debugging; it never interferes with `emit()` parsing and
  is captured separately as a truncated log tail on the run record.

Caps enforced on every run (not configurable per-program):

| Limit                               | Value                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Max emitted rows                    | 10,000 (rows beyond this are dropped, `truncated: true`)                                                                        |
| Max emitted result size             | 4 MiB (rows dropped from the end to fit; a single row over 4 MiB is a hard `result_too_large` failure — nothing to safely keep) |
| Max active programs per app         | 200 (archive unused ones to free room)                                                                                          |
| Minimum refresh TTL                 | 60,000 ms                                                                                                                       |
| Run rows kept per (program, params) | 5 most recent (older ones are pruned automatically)                                                                             |

Truncation is always honest: a partial result comes back with
`truncated: true`, never a silent drop.

## Caching and refresh model

Every `(programId, paramsHash)` pair (params are canonicalized and hashed, so
equivalent param objects share a cache entry) has its own run history. What
happens on each call to `runDataProgram` / a panel view:

| Situation                                                                                        | Behavior                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fresh cache hit (younger than `refreshTtlMs`, or `refreshMode: "manual"` with any prior success) | Returns cached rows instantly, `cacheHit: true`                                                                                                                          |
| Cache is older than the TTL                                                                      | Re-executes synchronously (panel views get a 25s budget; agent/manual calls get 120s), replacing the cache on success                                                    |
| `refreshMode: "manual"`                                                                          | Never auto-refreshes; only `forceRefresh: true` (or `manual_refresh` from the UI) re-runs it                                                                             |
| No cache yet                                                                                     | Executes synchronously like a normal first fetch                                                                                                                         |
| `background: true` program, no fresh cache                                                       | Serves the last good run immediately with `stale: true` and enqueues a durable background execution (10-minute budget); the _next_ call finalizes it if it has completed |
| Background program, execution still running, no prior success                                    | `background_pending` failure — the panel shows an explicit "running in background" error card, never a blank chart                                                       |
| Execution fails (timeout, sandbox error, bad `emit()` shape)                                     | Failure result with a structured error code; if a previous successful run exists, it is attached as `lastGoodRun` so the panel can stale-serve instead of going blank    |
| Program was archived (`delete-data-program`)                                                     | Explicit `archived` failure — panels show "This data program was archived", never a silent blank                                                                         |

Use `background: true` only for programs that routinely take longer than the
foreground budget (multi-provider joins over large cohorts, deep pagination).
Everything else should stay foreground — it is simpler to reason about and
serves fresh data faster.

## Error codes

| Code                   | Meaning                                                                 | What to do                                                     |
| ---------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| `program_not_found`    | No program with that id                                                 | Check the id via `list-data-programs`                          |
| `access_denied`        | Caller can't see this program                                           | Don't leak existence; ask the owner to share it                |
| `archived`             | Program was soft-deleted                                                | Repoint the panel or unarchive by resaving under the same name |
| `timeout`              | Didn't finish within the run's budget                                   | Reduce scope, page in fewer items, or mark `background: true`  |
| `emit_missing`         | Script never called `emit(...)`                                         | Add the `emit(rows, schema?)` call at the end                  |
| `emit_shape_invalid`   | `emit()` args weren't `(array-of-plain-objects, optional-schema-array)` | Fix the shape; check for a stray second `emit()` call          |
| `result_too_large`     | A single row (or the whole result) exceeds the byte cap                 | Trim large string fields before emitting                       |
| `sandbox_error`        | Uncaught exception in the script                                        | Read the thrown message; guard optional provider fields        |
| `run_code_unavailable` | The run-code module isn't available in this build                       | Not something a program author can fix                         |
| `background_pending`   | Background program has no result yet                                    | Wait and retry, or check `lastGoodRun` if present              |

Every failure is a structured `{ code, message }`, never a bare string — treat
`code` as the thing to branch on, `message` as the thing to show a human.

## Security notes

- **Credentials are always the viewer's, never the author's.** When a shared
  program's panel is viewed, `providerFetch` inside it resolves auth using the
  _viewing_ user's own configured provider credentials — not the program
  author's. A teammate missing a HubSpot key sees a HubSpot auth error on that
  panel, not someone else's data.
- **Only share programs you trust.** Because execution uses the viewer's
  credentials, only bind to or view a shared data program if you trust its
  code — it runs with your own access, exactly like opening someone else's
  extension.
- **Data programs are org-internal only, never public.** Unlike dashboards,
  a data program can never be shared publicly — sharing is restricted to
  members of your org. This is a hard invariant, not a default.
- Raw provider tokens never reach the model or the browser. The only thing
  that ever leaves the sandbox is the `{ rows, schema }` your `emit()` call
  produces — the same trust boundary as every other dashboard panel source.
- The actions that execute or mutate stored code (`save-data-program`,
  `preview-data-program`, `run-data-program`, `delete-data-program`) are not
  callable from the sandboxed extensions/iframe bridge — only from the agent
  or the server-rendered panel path.

## Worked example: Risk Meeting (HubSpot x Pylon)

This is the reference example installed by the `ensure-risk-meeting-dashboard`
action (`templates/analytics/actions/ensure-risk-meeting-dashboard.ts`), which
idempotently upserts both programs below plus a two-panel "Risk Meeting"
dashboard. It demonstrates the three capabilities a hardcoded action can't
anticipate for every customer: an arbitrary HubSpot property IN-search, a
batched multi-hop association join, and a join against a second, unrelated
provider.

**`risk-meeting-cohort.js`** — HubSpot deals in a configurable `risk_status`
cohort, resolved to their company domain, joined against Pylon account
sentiment by domain:

```js
// params: { riskStatuses?: string[], enterpriseOnly?: boolean }
const DEFAULT_RISK_STATUSES = [
  "On the Radar",
  "Churn Risk",
  "Confirmed Churn",
  "No Save Attempted",
];
const riskStatuses =
  Array.isArray(params.riskStatuses) && params.riskStatuses.length > 0
    ? params.riskStatuses
    : DEFAULT_RISK_STATUSES;
const HIGH_RISK_SENTIMENTS = ["frustrated", "high_risk_detractor"];

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

async function main() {
  // 1. Arbitrary property IN-search + open-close-date filter — not
  //    expressible through the canned hubspot-deals filters.
  const dealSearch = await providerFetchAll(
    "hubspot",
    "/crm/v3/objects/deals/search",
    {
      method: "POST",
      body: {
        filterGroups: [
          {
            filters: [
              {
                propertyName: "risk_status",
                operator: "IN",
                values: riskStatuses,
              },
              {
                propertyName: "closedate",
                operator: "GT",
                value: String(Date.now()),
              },
            ],
          },
        ],
        properties: [
          "dealname",
          "risk_status",
          "risk_summary",
          "risk_category",
          "hs_next_step",
          "churn_notes",
          "total_contract_value",
          "customer_success_owner",
          "dealstage",
          "closedate",
        ],
        limit: 100,
      },
      itemsPath: "results",
      pagination: {
        cursorBodyPath: "after",
        nextCursorPath: "paging.next.after",
        maxPages: 20,
      },
    },
  );
  const deals = dealSearch.items || [];
  const dealIds = deals.map((d) => d && d.id).filter(Boolean);

  // 2. Batched deal -> company association (100 per call). The raw
  //    association rows never leave this program.
  const companyByDeal = {};
  for (const batch of chunk(dealIds, 100)) {
    if (batch.length === 0) continue;
    const assoc = await providerFetch(
      "hubspot",
      "/crm/v3/associations/deals/companies/batch/read",
      { method: "POST", body: { inputs: batch.map((id) => ({ id })) } },
    );
    for (const r of (assoc && assoc.results) || []) {
      const dealId = r && r.from && r.from.id;
      const companyId =
        r && Array.isArray(r.to) && r.to.length > 0 ? r.to[0].id : null;
      if (dealId && companyId) companyByDeal[dealId] = companyId;
    }
  }

  // 3. Batched company -> domain lookup.
  const companyIds = Array.from(new Set(Object.values(companyByDeal))).filter(
    Boolean,
  );
  const domainByCompany = {};
  for (const batch of chunk(companyIds, 100)) {
    if (batch.length === 0) continue;
    const companies = await providerFetch(
      "hubspot",
      "/crm/v3/objects/companies/batch/read",
      {
        method: "POST",
        body: { inputs: batch.map((id) => ({ id })), properties: ["domain"] },
      },
    );
    for (const r of (companies && companies.results) || []) {
      const domain =
        r && r.properties && r.properties.domain
          ? String(r.properties.domain).toLowerCase()
          : null;
      if (r && r.id && domain) domainByCompany[r.id] = domain;
    }
  }

  // 4. A second, unrelated provider — zero bespoke glue action required.
  const pylonAccounts = await providerFetchAll("pylon", "/accounts", {
    itemsPath: "data",
    pagination: {
      cursorParam: "cursor",
      nextCursorPath: "pagination.cursor",
      maxPages: 20,
    },
  });
  const sentimentByDomain = {};
  for (const account of pylonAccounts.items || []) {
    if (!account) continue;
    const domain =
      typeof account.domain === "string" ? account.domain.toLowerCase() : null;
    if (!domain) continue;
    if (
      params.enterpriseOnly &&
      account.account_profile !== "Enterprise Active Customer"
    )
      continue;
    if (account.general_sentiment)
      sentimentByDomain[domain] = account.general_sentiment;
  }

  // 5. Join + emit. csm_name is computed HERE — never baked into a generic
  //    hubspot-deals action.
  const rows = deals.map((deal) => {
    const props = (deal && deal.properties) || {};
    const dealId = deal && deal.id;
    const companyId = dealId ? companyByDeal[dealId] : null;
    const domain = companyId ? domainByCompany[companyId] : null;
    const sentiment = domain ? sentimentByDomain[domain] || null : null;
    return {
      deal_id: dealId || null,
      deal_name: props.dealname || null,
      risk_status: props.risk_status || null,
      risk_summary: props.risk_summary || null,
      risk_category: props.risk_category || null,
      next_step: props.hs_next_step || null,
      churn_notes: props.churn_notes || null,
      arr: Number(props.total_contract_value || 0),
      csm_name: props.customer_success_owner || null,
      dealstage: props.dealstage || null,
      closedate: props.closedate || null,
      domain: domain || null,
      pylon_sentiment: sentiment,
      cross_source_flag: Boolean(
        domain && HIGH_RISK_SENTIMENTS.includes(sentiment),
      ),
    };
  });

  emit(rows, [
    { name: "deal_id", type: "string" },
    { name: "deal_name", type: "string" },
    { name: "risk_status", type: "string" },
    { name: "risk_summary", type: "string" },
    { name: "risk_category", type: "string" },
    { name: "next_step", type: "string" },
    { name: "churn_notes", type: "string" },
    { name: "arr", type: "number" },
    { name: "csm_name", type: "string" },
    { name: "dealstage", type: "string" },
    { name: "closedate", type: "string" },
    { name: "domain", type: "string" },
    { name: "pylon_sentiment", type: "string" },
    { name: "cross_source_flag", type: "boolean" },
  ]);
}

await main();
```

**`risk-meeting-pylon-early-warning.js`** — the complementary "support signal
outrunning CRM signal" view: enterprise Pylon accounts already flagged at-risk
by sentiment that have **not yet** shown up in the HubSpot cohort above (a
same-shape HubSpot domain lookup, minus the Pylon domain set — see
`templates/analytics/seeds/data-programs/risk-meeting-pylon-early-warning.js`
for the full script). This is the third validation capability: excluding one
provider's cohort from another's, entirely inside one program.

Both programs are installed and kept up to date by
`ensure-risk-meeting-dashboard` — an idempotent action that upserts each
program by its stable `name` and a two-panel "Risk Meeting" dashboard whose
panels use `source: "program"`. Installing the dashboard requires no
HubSpot/Pylon credentials up front; provider auth resolves per-viewer only
when a panel is actually rendered or `run-data-program` is called.

## Related skills

- `provider-api` — the catalog/docs/request/staging actions a data program's
  `providerFetch*` calls are built on.
- `dashboard-management` — creating and laying out the dashboard a program's
  panel lives on.
- `cross-source-analysis` — identity-stitching discipline (stable id + email,
  de-duplication, provenance) for joins like the one above.
- `security` — credential handling and access-scoping invariants this
  primitive relies on.
