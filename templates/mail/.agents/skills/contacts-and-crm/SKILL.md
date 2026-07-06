---
name: contacts-and-crm
description: >-
  Resolve a name or partial address to a real email and enrich a thread with
  CRM/contact context (HubSpot, Apollo) before drafting or triaging. Use
  when the user names a person instead of an email, or asks "who is this"
  / "what deals/tickets does this contact have".
---

# Contacts and CRM

## Resolving a recipient

Use `find-contact` before asking the user for someone's email address, and
before guessing a pattern like `firstinitiallastname@company.com`.

- `find-contact --query="<name or partial email>" --limit=5` matches
  case-insensitively against name and email, splitting the query into
  whitespace-separated terms that must ALL match (`"jacqueline lamb"` requires
  both terms present).
- Results are sorted by `count`, an interaction-frequency score. Google People
  API "connections" (explicitly saved contacts) start at `count: 5`; "other
  contacts" (people the user has emailed but not saved) start lower. Sending
  or receiving mail increments a real `sendCount`/`receiveCount` in the
  `contact_frequency` SQL table, so the top match is usually the person the
  user actually means.
- If `find-contact` returns zero matches, tell the user — do not invent an
  email address. A wrong guess either bounces or, worse, silently reaches the
  wrong inbox.
- Results are cached per-owner for a few minutes (`contactCache` in
  `server/handlers/emails.ts`). A contact added in Google Contacts moments ago
  may not appear immediately; that's expected, not a bug to route around.

## CRM enrichment

- `get-hubspot-contact --email=<address>` is the only first-class CRM action.
  It returns contact fields (name, phone, company, title, lifecycle stage,
  lead status) plus up to 5 associated deals and up to 5 associated tickets,
  reading the user's own HubSpot API key configured in Settings. If no key is
  configured it returns `{ error: "HubSpot API key not configured" }` —
  surface that plainly rather than treating it as "no CRM data exists."
- **Gong, Pylon, and Apollo are UI-only in Mail.** They have server route
  handlers (`server/handlers/gong.ts`, `pylon.ts`, `apollo.ts`) that power the
  CRM sidebar panel in the email view, each reading its own per-session API
  key from `appStateGet`. None of the three is registered in Mail's
  `MAIL_PROVIDER_API_IDS` (see `listProviderApiIdsForTemplateUse("mail")` in
  `server/lib/provider-api.ts`, which currently resolves to `gmail`,
  `google_calendar`, and `hubspot` only). This means:
  - There is no agent action for Gong calls, Pylon tickets, or Apollo person
    lookups in Mail.
  - `provider-api-request` will refuse `provider: "gong"`, `"pylon"`, or
    `"apollo"` in this app even though those provider ids exist in the shared
    catalog — they're enabled for other templates (e.g. Analytics), not Mail.
  - If the user asks the agent to pull a Gong call or Pylon ticket from Mail,
    say plainly that integration is visible in the UI sidebar only today; do
    not fabricate a result or imply `provider-api-request` can reach it.
- For HubSpot data outside contact lookup (deals search, ticket creation,
  property metadata), use `provider-api-catalog` / `provider-api-docs` with
  `provider: "hubspot"`, then `provider-api-request` — `get-hubspot-contact`
  only covers the single "lookup by email" shape.

## Related Skills

- `email-drafts` — use resolved contacts and CRM context when composing.
- `draft-queue` — resolving the right `ownerEmail` teammate uses
  `list-org-members`, a separate lookup from `find-contact`.
- `actions` — the shared provider API pattern for `provider-api-request`.
