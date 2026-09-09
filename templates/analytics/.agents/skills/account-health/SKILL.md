---
name: account-health
description: >-
  How to produce a trustworthy named-customer account health, QBR, renewal, or
  contract-usage readout. Use when a prompt names an organization or account.
---

# Account Health

Use these checks for named customer, organization, account-health, QBR,
renewal, risk, expansion, contract-utilization, or adoption questions. This is
not an ordinary metric lookup: a wrong identity or metric definition can put
another customer's data into a customer-facing decision.

## Identity lock

Treat an organization ID supplied in a prompt as a lookup key, not as proof that
the rows returned by a warehouse query belong to that customer.

1. Resolve the ID through the canonical CRM or contract source first.
2. Record the resolved customer name, organization ID, root organization ID,
   and any canonical account key.
3. Carry the same resolved identity through every usage query and check the
   returned rows against it.
4. Stop and report an identity mismatch if a result contains another customer,
   mixed organization IDs, or an unresolved ID. Do not summarize the rows or
   silently choose the most plausible customer.

## Source order and completeness

1. Use the catalog and organization data dictionary before writing warehouse
   SQL. Approved definitions and saved query shapes outrank a table name that
   merely sounds right.
2. Gather available CRM, contract, support, and conversation evidence. Treat
   that context as complementary, not as a complete usage result.
3. For account health, product usage is mandatory: query approved definitions
   for each requested product or feature dimension separately, using an explicit
   window (default 90 days for adoption unless the user asks for another one).
4. Report source, window, filters, row counts, identity join, freshness, and
   gaps. A missing source is a gap, not a reason to fill in a plausible value.

## Metric contracts

- **Contract metric** - distinguish the contracted measure from similarly named
  platform, web, content, or event metrics. Do not use a familiar synonym when
  comparing against a contract.
- **Completed-month usage** - “last month” excludes the current partial month.
  Verify the month/as-of field and freshness before using a reporting table;
  a single current-month snapshot is not last month's completed value.
- **Seats** - use the total distinct contracted/eligible users for the stated
  period when comparing with a seat contract. Do not substitute DAU, WAU, or a
  point-in-time daily active count, and label active users separately.
- **Capacity usage** - report actual usage, contracted capacity, and utilization.
  Explicitly flag utilization at or above 100% as an overage risk and potential
  renewal/expansion signal.
- **Adoption** - keep separate products or feature dimensions separate. Include
  feature adoption, active-user/session counts, and last activity only when the
  source query returns them; absence claims require complete coverage for the
  stated window.

## Known source traps

- If a saved query or dictionary entry is marked deprecated or retired, do not
  run it; use the current approved replacement and note the stale reference.
- A source that returns only one current partial-period snapshot is not proof of
  a completed-period value. Verify the period/as-of field and freshness first.
- If the dictionary does not define the requested contract metric or the
  replacement source cannot be verified, ask or report the gap instead of
  guessing from a similarly named table.

## Answer shape

Lead with the identity check, then provide a compact table of contract versus
actual usage, followed by product/feature adoption signals, account context,
risks, and next steps. Make every number traceable to one source and explicitly
say when the readout is partial.
