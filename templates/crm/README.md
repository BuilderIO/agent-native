# CRM

An agent-native CRM built around a typed, bitemporal record grid. It runs as its
own system of record on plain SQL, or as a scoped, field-policy-aware companion
to a connected HubSpot or Salesforce workspace — without making you pick one up
front, and without the connected mode limiting what you can model locally.

Everything the UI does, the agent does, through the same actions and the same
SQL. `AGENTS.md` is the single source of truth for how the app behaves; the
`crm` skill is the workflow depth behind it. This README describes the product.

## What it is

- **A spreadsheet grid over typed attributes.** Seventeen attribute types —
  text, number, checkbox, currency, date, timestamp, rating, status, select,
  record and actor references, location, domain, email, phone, and two
  system-owned ones. Filtering, multi-key sorting, and pagination all run in
  SQL, so a filtered page is the real result set rather than one page narrowed
  after the fact. Keyboard navigation and TSV copy/paste work the way a
  spreadsheet does.
- **Every value keeps its history.** A field write closes the old row and opens
  a new one with the actor and the time, so a record's stage history _is_ its
  value history — no separate audit table, no "who changed this?" dead end. A
  write that changes nothing stores nothing, so a sync does not inflate history.
- **Lists and pipelines that are always yours.** A list is a workflow overlay
  over one object type with its own entry attributes. Lists, entries, and entry
  values are local-authoritative on every backend, HubSpot and Salesforce
  included — so you can run a pipeline over connected records without needing a
  single provider write. Time-in-stage falls out of the entry's own history.
- **Saved views, as tables or boards.** Filter, sort, columns, and audience are
  saved together; a board view groups by any status attribute. `@currentUser` in
  a filter resolves per viewer, so one shared view is everyone's own pipeline.
- **A record page, not a form.** Typed attribute panel with per-value
  provenance, every list the record belongs to with that entry's own values, its
  interactions and evidence, and a change history for any single value.
- **Duplicates you can see the reason for.** Detection scores candidates on
  email, company domain, shared root domain, and normalized name, and says which
  one matched. Merge is explicit: you choose the survivor, values the survivor
  lacks are promoted, both sides' entries/tasks/evidence/relationships move
  over, and the loser is tombstoned and linked rather than deleted.
- **Enrichment behind a two-phase spend gate.** A free verify pass gathers
  evidence; the paid pass runs only over records a human approved, and its input
  set is built from those approvals rather than filtered down to them. Costs are
  estimated per line item and quoted before anything is spent, and a failed
  provider slot is reported as a failure, never as an empty answer.
- **Call evidence and reviewable signals.** Attach a bounded quote and source
  reference from a Clips recording; run keyword detectors locally and delegate
  smart moments and summaries through the agent chat. Every stored signal cites
  an exact evidence row and waits for a human to confirm or dismiss it.
- **Command menu and shortcuts.** ⌘K ranks records, lists, and commands
  together, so getting anywhere is one search away rather than a click path.
- **Admin in the app.** Settings has Connection, Fields, Lists, Intelligence,
  and Advanced tabs — the attribute schema and its managed options are edited
  where the data lives, not in a config file.

## Modes

- **Native SQL** — CRM is the system of record for accounts, people,
  opportunities, relationships, lists, views, tasks, cadence, and every local
  field. No provider, no sync job, no token. Portable across SQLite, Postgres,
  and D1.
- **Connected (HubSpot / Salesforce)** — the source CRM stays authoritative for
  its own fields. CRM is a scoped companion for record work, lists, views,
  tasks, evidence, and analysis. HubSpot maps companies/contacts/deals;
  Salesforce maps Account/Contact/Opportunity.

Either way, local attributes, lists, and entry values are yours. The `hybrid`
mode is deprecated: per-attribute authority expresses everything it promised.

### Provider writes are a handoff, and say so

CRM prepares a provider change as a reviewable proposal, shows the exact
before/after diff, and opens the record in HubSpot or Salesforce to finish it.
It does not complete upstream writes and never reports one as applied. That is
the intended flow, not an error — a proposal awaiting completion is presented as
the next step, not as a failure.

## Guardrails

Provider credentials live only in workspace Connections; CRM never accepts,
stores, or returns a token. The mirror holds configured cohorts and allow-listed
fields — unknown fields are remote-only, sensitive fields default to redacted.
Raw provider payloads, transcripts, media, and base64 bodies never enter SQL;
evidence is a URL or id plus a bounded quote. Ownership, amount, stage,
deletion, bulk scope, and external side effects always require an exact preview
and approval. Email and domain are matching signals, never identity keys.

Full detail: [`AGENTS.md`](AGENTS.md) for the operating rules, the
[`crm` skill](.agents/skills/crm/SKILL.md) for workflows, and
[the CRM contract](docs/architecture/crm-contract.md) for identity, field
policy, access scope, and the write-policy matrix.

## Set up

1. Open **Set up CRM** and choose **Start with Native SQL** to use CRM with no
   external service.
2. To connect a provider, authorize HubSpot or Salesforce in shared **Settings →
   Connections** and grant it to CRM. OAuth and refresh tokens stay in workspace
   Connections. Salesforce production is the default; for a sandbox use
   **Authorize the sandbox directly** on Set up CRM, and the chosen login
   environment is retained for token refresh.
3. Pick the granted connection and a recent history window. HubSpot may be
   narrowed to deal pipeline IDs; Salesforce starts with recently updated
   Accounts, Contacts, and Opportunities.
4. CRM mirrors that cohort and its allow-listed fields only. Confirm the
   connection actor's access before relying on a mirrored record.

## Local development

```bash
pnpm install
pnpm dev
```

Set `DATABASE_URL` for persistent deployment storage. Native SQL needs no
external credentials. Connect providers from the workspace Connections surface;
never put provider secrets in `.env`.

For live testing, use an already-authorized shared Connection, choose a small
recent cohort, verify the resulting records and access scope, then exercise a
proposal without completing the provider change. Record only connection labels,
counts, and non-sensitive results.
