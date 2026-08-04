---
name: gong
description: >-
  Search Gong call metadata and transcript excerpts for sales-call analysis,
  customer conversations, objections, risks, and next steps.
---

# Gong

Use Gong for sales-call evidence. Call metadata alone is not enough for a deep
dive that asks what happened in customer conversations.

## Actions

- `gong-native-insights` — one provider-native qualitative synthesis operation
  (`ask_account`, `ask_deal`, or `generate_brief`) through Gong's connected MCP.
  Use it for themes, risks, summaries, and deck narrative when the native tools
  are connected. One action invocation makes at most one Gong AI request; omit
  `operation` to inspect its schemas without spending a credit request, and set
  `allowCreditRequest=true` only for the one consolidated request you intend to
  send. Paid calls also require a workspace owner to enable them once with
  `configure-gong-native-insights`; the policy defaults off and disabling it
  never blocks the raw evidence path.
- `account-deep-dive` — first choice for named account/deal deep dives that
  need HubSpot plus Gong. It searches by account/deal/company/contact domain,
  loads Gong call details, and returns compact transcript excerpts for synthesis.
- `gong-calls` — bounded convenience reads: list recent calls, search by
  company/domain/person/email, fetch a single transcript by call ID, or return
  transcript excerpts for a small matching cohort. Its `transcriptQuery` is a
  local scan after batched transcript retrieval, not Gong's server-side
  keyword search.

For broad or absence-sensitive Gong work, prefer the raw provider API surface:
use `provider-api-catalog` / `provider-api-docs`, then stage `/calls/extensive`
or another raw endpoint with `provider-api-request`. Reduce staged tracker or
call data with `query-staged-dataset` or a Data Program. Use
`provider-corpus-job` only when raw transcript bodies are required and no
native/indexed search can answer the question.

## Route Synthesis and Evidence Separately

- Use `gong-native-insights` for qualitative synthesis where Gong may retrieve
  and analyze evidence internally. Its result is provider synthesis: coverage
  is unknown and raw transcript evidence is unavailable.
- Use `gong-calls` or `provider-corpus-job` for quotes, exact counts, transcript
  records, coverage-sensitive claims, and proof that something was absent.
- Consolidate related native questions into one narrowly scoped request. Each
  native operation independently consumes Gong credits, so do not make one call
  per slide, bullet, or sub-question.
- From a sibling app, ask Analytics a natural-language question by default.
  Analytics owns Gong/HubSpot routing, source coverage, credentials, transcript
  strategy, joins, and synthesis. Use `call-agent`'s direct `action` + `input`
  mode only when a trusted integration explicitly names one stable semantic
  read contract and supplies its complete bounded input. Never use direct
  actions as a workaround for a slow or failed delegated run.

## Account Search Algorithm

Gong search pages `POST /v2/calls/extensive` directly with the requested date
window and party data (not `GET /v2/calls`, which returns no parties). Each call
is matched against both:

1. **Title variants**: the call title contains a generated search variant.
2. **External parties**: an external participant's name, email, or domain
   matches a generated search variant.

This catches calls titled "Builder <> Acme" when you search
"Acme Corp" by matching the "acme" name variant or "@acme.com" domain variant.
The lib generates variants by stripping deal suffixes (`- New Deal`, `- Fusion`),
corporate suffixes (`Group`, `Inc`, `Corp`, `LLC`), and deriving first word and
email domain — always including the raw original. Variants shorter than 3 chars
are filtered. This is why a broad company search can find more calls than an
exact-title search.

## Customer-Voice Extraction (externalMonologues)

When analyzing customer sentiment, objections, or voice of the customer:

- Use `getEnrichedTranscript` / request enriched transcripts — it maps each
  monologue to speaker identity and affiliation.
- **Only use `externalMonologues`** for customer/prospect statements. Monologues
  with `affiliation === "Internal"` are your own team's speech — never surface
  these as "what the customer said."
- The `externalMonologues` field on an enriched transcript is the pre-filtered
  customer-voice signal; use it directly.

## Patterns

For account or deal deep dives:

1. Call `account-deep-dive` first when the request also needs CRM context,
   contacts, stages, amount, close date, or an overall opportunity narrative.
2. Use `gong-calls` for targeted follow-up searches by account name, domain,
   person, or email.
3. Set `includeTranscripts=true` when the user asks for context, risks,
   objections, next steps, decision process, sentiment, or a "deep dive".
4. Use `transcriptLimit` around 3-5 for a first pass. For broad coverage of a
   named account, increase to 10-20 — the action supports up to 50. Increase
   when the returned calls don't cover the time window or key people you need.
   For a bounded "review all calls" request with at most 50 matches, make one
   call with `exhaustive=true`, `after`, `before`, and
   `includeTranscripts=true`; do not split discovery and transcripts into
   separate agent tool calls.
5. Use the compact transcript excerpts returned by `includeTranscripts=true`.
   Do not fetch raw individual transcripts unless the user asks for exhaustive
   quoting, debugging, or export.
6. Ground qualitative findings in the transcript excerpts and state how many
   calls were inspected.
7. Page through calls using `cursor`/offset when you need bounded account
   coverage — do NOT stop at the first page. For broad scans, do not use
   `gong-calls(exhaustive=true)` or one blocking `provider-api-request` call as
   the analysis. Stage the raw response and reduce it with a Data Program or
   `query-staged-dataset`; use `provider-corpus-job` for checkpointed transcript
   batches when raw bodies are necessary.

Example:

```txt
gong-calls(company: "The Knot", days: 180, limit: 20, includeTranscripts: true, transcriptLimit: 10)
```

Gong search is best-effort: it matches title plus external participant names,
emails, and domains through `/calls/extensive`. Treat call details and transcript
excerpts as evidence; treat missing coverage as a gap, not proof that the topic
never came up.

Title/party matching is discovery only. Never use a title pre-filter as proof
that a phrase is absent from transcripts.

If transcript loading fails for a call, report that gap instead of inferring the
conversation content from title, date, or participants.

When a single transcript is needed, `gong-calls(transcript: "...")` returns
compact extracted text by default. Set `rawTranscript=true` only for
debugging/export, and never pass raw transcript payloads into `save-analysis`.

## Complete-Coverage Transcript Scan

When the question is "do ANY of these calls mention X?" or "how many calls across
this cohort mention X?" — where missing a single call makes the answer wrong — do
NOT conclude absence from a sampled `includeTranscripts` result. Choose the
smallest complete path for the bounded cohort:

1. **Configured keyword tracker.** If the requested term is already a Gong
   keyword tracker exposed in API results, use `provider-api-request` against
   `/calls/extensive` with `contentSelector.exposedFields.content.trackers`.
   Stage the paginated calls, then flatten and filter tracker ids, names, or
   phrases with `query-staged-dataset` or a Data Program. This is the preferred
   broad keyword path because Gong has already indexed the tracker. It does not
   answer arbitrary terms that are not configured as trackers.

2. **Named account, up to 50 calls, qualitative review.** Make one `gong-calls`
   call with `exhaustive=true`, a bounded `after`/`before` window, and
   `includeTranscripts=true`. The action discovers every matching call and
   fetches transcript excerpts in batches, returning `transcriptCoverage`. Do
   not fetch the same call IDs one at a time afterward.

3. **Bounded arbitrary mention/absence search, up to 200 calls.** Make one
   `gong-calls`
   call with `exhaustive=true`, the date window, `transcriptQuery`, and an
   adequate `transcriptScanLimit`. This is a bounded local scan after batched
   transcript retrieval. Report its coverage fields and only make an absence
   claim when coverage is complete.

4. **Larger or multi-account arbitrary corpus.** Use
   `provider-api-catalog(provider: "gong")` and its `corpusRecipes` if you need
   the exact shape. Stage call ids with the raw API, then use
   `provider-corpus-job` with `mode: "batch-search"` and 20-call transcript
   batches. The canonical request is `POST /calls/transcript` with
   `batch.itemBodyPath: "filter.callIds"`, `batch.responseItemsPath:
"callTranscripts"`, `batch.batchSize: 20`, `search.textPaths:
["transcript"]`, and `search.idPaths: ["callId"]`. Feed the staged/discovered
   call ids through `batch.inputDatasetId` + `batch.inputValuePath` or through
   `batch.items`. This is a durable full scan, not a server-side keyword query;
   do not implement it as a per-call loop in `run-code` or a delegated agent.

When delegating a corpus chunk to an Agent Teams sub-agent, include the exact
staged dataset id or `scratch/...` path and the output/checkpoint path in the
task brief. The child starts with a clean context and must read the staged
input before making any provider request. If that input is unavailable, it
must report the missing input rather than re-fetching the entire Gong corpus.

5. **Use `run-code` only for joins/reductions around the corpus path.** After
   the transcript job exists, use `run-code`, `query-staged-dataset`, or job
   results to join hits back to deals/accounts, compute variants, dedupe, and
   format evidence. A `run-code` loop over `gong-calls(transcript: id)` is a
   fallback for small or awkward sets, not the default for broad scans.

Report coverage explicitly: deals in cohort, calls discovered, calls scanned, and
matches found. Never turn "I inspected a sample" into "no call mentions X".

## Limits (Current)

| Parameter                | Default | Max     |
| ------------------------ | ------- | ------- |
| `limit` (calls returned) | 8       | 200     |
| `transcriptLimit`        | 3       | 50      |
| `transcriptMaxChars`     | 8 000   | 100 000 |

For large account deep-dives or competitive analyses spanning many calls, use
`limit: 50-200` and `transcriptLimit: 20-50`. For very large datasets, use the
checkpointed `provider-corpus-job` path rather than paging the full Gong call
list inside one agent action.
