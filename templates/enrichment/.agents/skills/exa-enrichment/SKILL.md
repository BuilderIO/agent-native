---
name: exa-enrichment
description: >-
  Exa Websets for CSV enrichment — search types, enrichment descriptions,
  sizing, and troubleshooting. Use when creating websets, interpreting CSV
  columns, tuning queries, or recovering failed enrichments.
---

# Exa enrichment (Websets)

## Exa Websets overview

**Websets** are **asynchronous** collections of **verified web data** built by Exa for a batch of entities (e.g. people or companies from a CSV).

- Each **item** is typically a **URL** (a candidate page) with optional **enrichments** (fields derived from that result).
- Items move through a pipeline roughly: **find → verify → enrich** (exact stages are API-defined; think “discover candidates, validate, attach structured fields”).
- Jobs can take noticeable wall-clock time; scripts such as **`create-webset`** wait and merge; **`check-webset`** / **`get-results`** support partial progress and recovery.

## Search types

| Mode | When to use | Typical signals in CSV |
| ---- | ----------- | ---------------------- |
| **People** | Find professional identities | Person name + title + company, email local-part patterns, LinkedIn-ish columns |
| **Company** | Find org sites and firmographics | Domain, company legal name, industry |
| **Auto** | Mixed or ambiguous columns | Let the agent infer from column headers and sample rows |

**People** search targets LinkedIn-style / professional profiles. **Company** search targets corporate sites and structured company info.

## Enrichment types

- **Custom descriptions (natural language)** — Phrase what you want extracted, e.g. “Find the company’s annual revenue”, “What is this person’s current role?”. Prefer **specific, measurable** asks over vague ones (“tell me about them”).
- **Entity enrichments** — Higher-level bundles such as **company** info (workforce, headquarters, financials) or **person** info (job title, social links), depending on what the Exa integration in this app exposes.

When users ask for new columns (e.g. “LinkedIn URL”), map that to **clear enrichment descriptions** or the appropriate entity fields in code, not hand-wavy prompts.

## Best practices

1. **Specific search queries** — Narrow entities (name + company + domain) beat ultra-broad single-field searches.
2. **Include domain or URL columns** when available — Strongly improves match quality for companies and many people lookups.
3. **Limit webset size** for latency and cost — **Roughly 100–500 items** per batch is a good default; split huge CSVs when timeouts or poor quality appear.
4. **Enrichment text should be testable** — “Current employer as of 2024” beats “background info”.

## Common issues

| Symptom | Likely cause | What to try |
| ------- | ------------- | ----------- |
| Low match rate | Query too broad or under-specified | Add company/domain/title to search; tighten per-row query text |
| Missing / empty enrichments | Vague or non-extractable descriptions | Rephrase to a concrete fact; check if verify step dropped noisy URLs |
| Timeouts / stuck jobs | Webset too large or API slowness | Smaller batches; **`check-webset`** then **`get-results`**; retry merge only |

For app-specific wiring (script arguments, file paths), follow **`AGENTS.md`** and the **`scripts`** in this repo.
