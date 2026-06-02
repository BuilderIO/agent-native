---
name: cross-source-analysis
description: >-
  Use when an analytics question spans multiple data sources (e.g. warehouse
  events + CRM + support + first-party) and you must stitch identities, remove
  duplicates, and produce one consolidated answer with per-source provenance.
---

# Cross-Source Analysis

Most non-trivial analytics questions touch more than one source: signups in the
warehouse, deals in HubSpot, tickets in a support tool, pageviews in first-party
`analytics_events`. The failure modes are joining on the wrong key, double
counting the same entity, and presenting a blended number with no traceability.
This skill is the recipe for doing it safely.

## 1. Plan before you query (catalog-first)

Orient before fanning out:

1. Read the injected `<data-dictionary>` and check data-source status to see
   which sources are configured and what each one actually holds.
2. Map each fact in the question to the one source that owns it. Write a tiny
   plan: "identities + emails from HubSpot, usage from BigQuery, errors from
   Sentry." One source per fact; do not pull the same fact from two places.
3. Decide the join keys up front (see the safe-join rule). If no source carries
   a shared, stable key, say so — a fuzzy join is a caveat, not a silent
   assumption.

If the metric, time range, or grain is ambiguous and the choice would change the
numbers, use the `ask-question` clarifying tool once before querying. Skip it
when the dictionary or the user already answered.

## 2. Fetch per source

Query each source independently with its own provider action/skill. Convert the
requested local date range to UTC consistently across every source so the
windows line up. Keep each source's raw result (rows or row samples, counts,
and any provider errors) — you will need it for stitching, de-duplication, and
provenance.

Never invent rows to fill a gap. If a source is unconfigured or errors, record
that as a gap and continue with what you have.

## 3. Stitch identities — the safe-join rule

When joining records that represent the same person or account across sources,
**match on BOTH a stable id AND email**, not on either alone:

- IDs can be **reassigned or recycled** (a deleted user's `user_id` handed to a
  new signup; a CRM contact id reused after a merge). Matching on id alone
  silently attributes one entity's data to another.
- Emails can change, be shared (team@), or be entered differently across tools,
  so email alone over- or under-matches.
- Require agreement on a stable id **and** a normalized email (lowercase, trim)
  before treating two records as the same entity. When only one key is
  available, treat the match as low-confidence and surface it as a caveat rather
  than folding it into the headline number.
- Prefer a source's canonical/primary identifier over a display field. Note any
  field you used as a fallback.

Record match quality per join: exact (id + email agree), partial (one key,
flagged), or unmatched (kept separate, counted as a gap).

## 4. De-duplicate

After stitching, collapse duplicates before aggregating:

- One entity that appears in several sources counts **once** in any entity-level
  metric (users, accounts, deals).
- Watch for fan-out: a one-to-many join (one account, many events) multiplies
  rows. Aggregate to the right grain first, then join, so you don't inflate
  counts or sums.
- Drop exact duplicate rows that come from overlapping exports of the same
  source.

## 5. Synthesize one consolidated answer with provenance

Produce a single answer, but make every number traceable:

- State which source each figure came from, and over what time window.
- Call out match quality and any unmatched/duplicate handling.
- List gaps explicitly: sources that were unconfigured, errored, or only
  partially matched. A blended number with hidden gaps is worse than a smaller
  number that is honest about coverage.

Example provenance footer:

```markdown
## Methodology
- Identities: HubSpot contacts (joined to BigQuery on contact_id + lowercased email)
- Usage: BigQuery `analytics.events`, 2026-04-01 .. 2026-05-01 UTC
- Support: Pylon tickets, same window
- Matches: 482 exact (id+email), 31 partial (email-only, flagged), 7 unmatched
- Gaps: Stripe not configured — revenue omitted
```

When the result is worth re-running, save it via `adhoc-analysis` with
`resultData` holding the per-source evidence and the match decisions, so a
re-run reproduces the same stitch.
