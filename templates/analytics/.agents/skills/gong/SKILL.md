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

- `account-deep-dive` — first choice for named account/deal deep dives that
  need HubSpot plus Gong. It searches by account/deal/company/contact domain,
  loads Gong call details, and returns compact transcript excerpts for synthesis.
- `gong-calls` — list recent calls, search by company/domain/person/email, fetch
  a single transcript by call ID, or return transcript excerpts for matching
  calls.

## Two-Pass Search Algorithm

Gong search uses `POST /v2/calls/extensive` (not `GET /v2/calls` — that returns
no parties). The search works in two passes:

1. **Title match first**: filter calls whose title contains any search variant
   directly.
2. **Party/email-domain match second**: for calls that did not title-match,
   fetch party data via the extensive endpoint and match against external
   participant names, emails, and email domains.

This two-pass approach catches calls titled "Builder <> Acme" when you search
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
5. Use the compact transcript excerpts returned by `includeTranscripts=true`.
   Do not fetch raw individual transcripts unless the user asks for exhaustive
   quoting, debugging, or export.
6. Ground qualitative findings in the transcript excerpts and state how many
   calls were inspected.
7. Page through calls using `cursor`/offset when you need broad coverage — for
   large accounts with many calls, do NOT stop at the first page. For very large
   pulls (100+ calls), prefer chunked background processing rather than a single
   blocking fetch.

Example:

```txt
gong-calls(company: "The Knot", days: 180, limit: 20, includeTranscripts: true, transcriptLimit: 10)
```

Gong search is best-effort: it matches title plus external participant names,
emails, and domains through `/calls/extensive`. Treat call details and transcript
excerpts as evidence; treat missing coverage as a gap, not proof that the topic
never came up.

If transcript loading fails for a call, report that gap instead of inferring the
conversation content from title, date, or participants.

When a single transcript is needed, `gong-calls(transcript: "...")` returns
compact extracted text by default. Set `rawTranscript=true` only for
debugging/export, and never pass raw transcript payloads into `save-analysis`.

## Complete-Coverage Transcript Scan (corpus-first)

When the question is "do ANY of these calls mention X?" or "how many calls across
this cohort mention X?" — where missing a single call makes the answer wrong — do
NOT rely on `includeTranscripts` excerpts. They load only the newest few calls,
truncated, and concluding "not mentioned" from that sample is how you ship a false
negative. Use this two-step pattern:

1. **Discover every call (cheap, metadata only).** For each account/deal, call
   `gong-calls` with `exhaustive: true` and a bounded window via `after` (e.g. the
   deal's closed-won date) and optionally `before`. This returns ALL matching
   calls — not just `limit` — and never auto-loads transcripts, so it stays under
   the function timeout. Collect the full `calls[]` (IDs + titles) across the cohort.

2. **Batch-search the raw transcript endpoint.** Prefer `provider-corpus-job`
   with `mode: "batch-search"` over one-call-at-a-time loops. Use
   `provider-api-catalog(provider: "gong")` and its `corpusRecipes` if you need
   the exact shape. The canonical request is `POST /calls/transcript` with
   `batch.itemBodyPath: "filter.callIds"`, `batch.responseItemsPath:
"callTranscripts"`, `batch.batchSize: 20`, `search.textPaths:
["transcript"]`, and `search.idPaths: ["callId"]`. Feed the staged/discovered
   call IDs through `batch.inputDatasetId` + `batch.inputValuePath` or through
   `batch.items`.

3. **Use `run-code` only for joins/reductions around the corpus path.** After
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
`limit: 50-200` and `transcriptLimit: 20-50`. For very large datasets, the
`provider-api-request` escape hatch can page through the full Gong call list.
