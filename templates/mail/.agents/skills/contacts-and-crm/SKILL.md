---
name: contacts-and-crm
description: >-
  Resolve a name or partial address to a real email and enrich a thread with
  CRM/contact context (HubSpot, Apollo) before drafting or triaging. Use
  when the user names a person instead of an email, asks "who is this" /
  "what deals/tickets does this contact have" / "what did she send me", or
  wants to change what the person panel beside an open email shows.
---

# Contacts and CRM

## Resolving a recipient

Use `find-contact` before asking the user for someone's email address, and
before guessing a pattern like `firstinitiallastname@company.com`.

`find-contact` is backed by `loadContactsForEmail`, which merges Google People
API "connections" (boosted `count += 5`) and "other contacts" with real
send/receive history. Because it sees actual interaction history, it is strictly
better than guessing an address pattern.

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
- **Gong MCP is available to the agent after connecting it from the person
  panel's "Add to this panel" menu.** Users without a workspace can add a personal connection there. In
  a workspace, shared setup is only shown to organization owners and admins;
  Gong also requires its tech admin to register the MCP integration. Connected
  Gong tools inherit the authorizing user's Gong permissions. Use those tools
  when available for Gong questions.
- Gong, Pylon, and Apollo CRM sidebar panels still use server route handlers
  (`server/handlers/gong.ts`, `pylon.ts`, `apollo.ts`) that read the user's
  API key through `readIntegrationKey` (`server/lib/integration-keys.ts`).
  None of the three is registered in
  Mail's `MAIL_PROVIDER_API_IDS` (see
  `listProviderApiIdsForTemplateUse("mail")` in `server/lib/provider-api.ts`,
  which currently resolves to `gmail`, `google_calendar`, and `hubspot` only).
  This means:
  - There is no first-party Mail action for Gong calls, Pylon tickets, or
    Apollo person lookups.
  - `provider-api-request` will refuse `provider: "gong"`, `"pylon"`, or
    `"apollo"` in this app even though those provider ids exist in the shared
    catalog — they're enabled for other templates (e.g. Analytics), not Mail.
  - If the user asks for Gong data and no Gong MCP tools are connected, say
    plainly that Mail has no first-party Gong action; do not imply
    `provider-api-request` can reach it.
- **App API-key connections are UI-only.** Gong, Pylon, Apollo, and HubSpot
  keys are saved by the UI-only `save-integration-key` action into the
  encrypted credential store, never into `application_state` or any table the
  agent can query. `readIntegrationKey` reads the credential store first and
  falls back to a key an older version saved in `application_state`. The agent
  can read HubSpot data via `get-hubspot-contact` but cannot configure API-key
  connections on the user's behalf.
- For HubSpot data outside contact lookup (deals search, ticket creation,
  property metadata), use `provider-api-catalog` / `provider-api-docs` with
  `provider: "hubspot"`, then `provider-api-request` — `get-hubspot-contact`
  only covers the single "lookup by email" shape.

## The person panel

The panel beside an open email shows the sender (or the address the user
picked). Its "Add to this panel" menu holds three kinds of things:

- **Built-in widgets:** `notes`, `attachments` and `recent`. Read which are on
  with `get-mail-settings` (`contactPanelWidgets`) and switch them with
  `update-mail-settings` with `contactPanelWidgets: { attachments: true }`. A switch
  applies to every email, and widgets you leave out keep their state. Notes and
  Recent start on, Attachments off.
- **Connections:** HubSpot, Apollo, Gong and Pylon, set up from the same menu
  as above.
- **The user's own widgets:** extensions that declare the
  `mail.contact-sidebar.bottom` slot. Add one to the panel with
  `install-extension` and that slot id, remove it with `uninstall-extension`.
  When the user asks you to build one, create the extension, declare the slot
  with `add-extension-slot-target`, then install it so it appears. The widget
  gets `contactEmail`, `contactName`, `threadId` and `focusedEmailId`.

`list-contact-attachments --email=<address>` returns the files that person
sent, newest first, each with the `threadId`, subject and date of its email,
so you can open or cite it. It searches Gmail when an account is connected and
throws when Gmail fails; an empty list means the person really sent no files.

Notes live in Content, not Mail: one private page per person in a "Mail
notes" collection in the user's Personal space, keyed by email address.
`get-contact-note --email=<address>` reads that page (`note: null` means no
notes yet). `add-contact-note` with `email`, `text`, and the open email's
`threadId` and `subject` adds a dated line that links back to the email; the
first note creates the page, titled with `name` when you pass it. Both fail
loudly when Content can't be reached (`content_unavailable`) or the page is in
Trash (`mail_note_trashed`); say so rather than reporting no notes.

## Related Skills

- `email-drafts` — use resolved contacts and CRM context when composing.
- `draft-queue` — resolving the right `ownerEmail` teammate uses
  `list-org-members`, a separate lookup from `find-contact`.
- `actions` — the shared provider API pattern for `provider-api-request`.
