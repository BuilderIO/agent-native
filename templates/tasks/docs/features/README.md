# Tasks — Features

This folder describes **what the Tasks app is** — its product capabilities, not implementation plans.

Features are **ordered** (F1, F2, …). Read in order when learning the product.

## Shipped core

The app is **task-list-first** with agent parity:

- **Tasks** (F1) — add, edit title, mark complete / incomplete, delete, **filter completed**, **drag reorder** on the main task page
- **Inbox** (F4) — capture, edit, reorder, select, mark ready, delete
- **Chat** (F8) — task and inbox operations via actions; **capture defaults to inbox** (`create-inbox-item`)

See the repository [README](../../README.md) for implementation backlog items.

## Where work lives

| Surface                                  | What appears there                                       | Status  |
| ---------------------------------------- | -------------------------------------------------------- | ------- |
| **Main task page**                       | All **tasks**                                            | done    |
| **[F4 Inbox](./f4-inbox.mdx)**           | Not-ready **items** — capture and triage (not tasks yet) | partial |
| **[F3 Project](./f3-projects.mdx) page** | **Tasks** in that project only                           | planned |

Inbox items become tasks when **marked ready**. An item may have a project assigned before then — it still won't show on the project page until ready.

## Features (in order)

|        | Feature                                    | Status  | Description                                                                         |
| ------ | ------------------------------------------ | ------- | ----------------------------------------------------------------------------------- |
| **F1** | [Tasks](./f1-tasks.mdx)                    | partial | Core task list + bulk actions shipped; project/field assignment remains             |
| **F2** | [Custom fields](./f2-custom-fields.mdx)    | done    | Definitions, per-task values, UI, and actions shipped                               |
| **F3** | [Projects](./f3-projects.mdx)              | planned | Group tasks by area; focused project pages                                          |
| **F4** | [Inbox](./f4-inbox.mdx)                    | partial | Triage UI shipped; custom fields and project assignment on items remain             |
| **F5** | [Views](./f5-views.mdx)                    | planned | Filter, sort, group, and save list arrangements                                     |
| **F6** | [Search](./f6-search.mdx)                  | planned | Find tasks by title and projects by name                                            |
| **F7** | [First-run experience](./f7-first-run.mdx) | partial | Empty slate shipped; starter config remains                                         |
| **F8** | [Chat](./f8-chat.mdx)                      | partial | Task, inbox, and custom-field parity shipped; extended parity with F3/F5/F6 remains |

## What Tasks is

Tasks is a **task-list-first to-do app**. Users capture and manage work on the main list and [inbox](./f4-inbox.mdx) through the UI or chat. Planned additions: [projects](./f3-projects.mdx), [custom fields](./f2-custom-fields.mdx), [saved views](./f5-views.mdx), and [search](./f6-search.mdx). The app ships increasingly pre-configured ([F7](./f7-first-run.mdx)). **Chat** (F8) stays at parity with the UI at every stage.

## Status flags

Each capability is **planned**, **partial**, or **done**. Flags apply to a whole file or to a section within a file.

### File-level

```yaml
---
id: F1
title: Tasks
status: partial
order: 1
---
```

### Section-level

```md
<!-- status: done -->

## Task list filter
```

```md
<!-- status: todo -->

## Bulk actions
```

| Value     | Meaning                              |
| --------- | ------------------------------------ |
| `planned` | Described but not yet in the product |
| `partial` | Some sections shipped                |
| `done`    | Shipped and matches the description  |

## Adding a capability

Pick the next `F{n}`, set `order`, add `f{n}-<slug>.mdx`, and a row in the table above.
