---
name: pylon
description: >
  Look up customer support tickets and account history via Pylon.
  Use this skill when the user asks about support tickets, customer issues, or support history.
---

# Pylon Integration (Support)

Pylon access uses the shared provider API runtime. Do not add a separate Pylon
client. `/api/pylon/issues` remains only as a thin compatibility route for an
existing dashboard and delegates to the same action/provider runtime.

## Access Paths

- Use `provider-api-catalog`, `provider-api-docs`, and
  `provider-api-request` with provider `pylon` for bounded account, contact,
  and issue queries.
- Use a data program with `providerFetchAll("pylon", ...)` for reusable joins,
  exhaustive support-ticket analysis, or dashboard sources. Existing risk
  meeting programs demonstrate the HubSpot-to-Pylon domain join.
- Stage large responses and reduce them with `query-staged-dataset` or
  `run-code` before returning results to chat.
- For issue corpora, prefer `POST /issues/search` with the created-at filter and
  body cursor. The older `GET /issues` endpoint has a 30-day window and should
  not be used for broad dashboard coverage.

Authentication is resolved from the current viewer's scoped Pylon credential
through the shared provider runtime.

## Key Patterns & Gotchas

- Confirm the current endpoint, time-window, filter, and cursor contract with
  `provider-api-docs`; do not impose a fixed lookback window in a wrapper.
- Report inspected issue/account counts, pagination coverage, failed pages, and
  truncation. A sampled response cannot support an exhaustive absence claim.
- Query Pylon directly unless the user explicitly asks for a warehouse copy.
