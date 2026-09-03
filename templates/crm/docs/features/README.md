# CRM — Features

This folder explains what CRM is for and what users can do in the product. It
describes the shipped user experience; the [CRM contract](../architecture/crm-contract.md)
and the [agent guide](../../AGENTS.md) cover implementation and operating rules.

## Shipped core

CRM gives teams one place to work with customer records, pipeline context, and
follow-up work:

- **Records and fields (F1)** — spreadsheet-style records with typed
  attributes, filtering, sorting, pagination, keyboard navigation, and value
  history.
- **Lists, pipelines, and views (F2)** — local workflow lists with entry
  fields, saved table views, and status-based boards.
- **Work and record quality (F3)** — follow-up tasks, pipeline dashboards,
  duplicate detection and merge, and approval-gated enrichment.
- **Evidence and chat (F4)** — bounded call evidence, reviewable signals, and
  agent actions that use the same product rules as the UI.

## Modes

CRM can start as a standalone system of record or as a scoped companion to a
connected CRM:

- **Native SQL** — CRM owns accounts, people, opportunities, lists, views,
  tasks, and local fields. No provider account is required.
- **HubSpot or Salesforce** — the connected provider remains authoritative for
  its own fields. CRM adds scoped record work, local lists and pipelines,
  saved views, tasks, evidence, and analysis.

In either mode, lists and their entry values remain local to CRM. Provider edits
are prepared as reviewable proposals with an exact before/after diff; the final
change is completed in the provider.

## Features

| Feature                                                                | Status | What it covers                                            |
| ---------------------------------------------------------------------- | ------ | --------------------------------------------------------- |
| [F1 — Records and fields](./f1-records-and-fields.mdx)                 | done   | Records, typed attributes, grid, record page, and history |
| [F2 — Lists, pipelines, and views](./f2-lists-pipelines-and-views.mdx) | done   | Workflow lists, boards, saved views, and stage history    |
| [F3 — Work and record quality](./f3-work-and-record-quality.mdx)       | done   | Tasks, dashboards, dedupe, merge, and enrichment          |
| [F4 — Evidence and chat](./f4-evidence-and-chat.mdx)                   | done   | Call evidence, signals, agent parity, and useful prompts  |

## First steps

1. Open **Set up CRM** and choose **Start with Native SQL**, or authorize and
   grant a HubSpot or Salesforce connection from shared Settings.
2. Add records or sync a small, recent provider cohort.
3. Create a list for the workflow you want to manage, then add records to it.
4. Save a table or board view for the way you want to return to that work.

The command menu (**⌘K**) can open records, lists, views, settings, and work
without requiring a particular navigation path.
