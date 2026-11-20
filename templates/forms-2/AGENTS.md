# Forms — Agent Guide

Forms is a form builder: authors build a block document, publish it at `/f/:formId`, and read submissions and insights. Everything the UI does goes through actions, so the agent does the same work with the same checks. Workspaces are shared by every member of the active org.

## Skills

Search with `rg --hidden --follow`; read the exact linked guide before deeper work. `.agents/skills/forms/SKILL.md` — the form model, statuses, and the action map; read it before touching forms. `.agents/skills/adding-a-feature/SKILL.md` — cross-area feature checklist. Data: `.agents/skills/actions/SKILL.md`, `.agents/skills/storing-data/SKILL.md`, `.agents/skills/security/SKILL.md`, `.agents/skills/sharing/SKILL.md`. UI: `.agents/skills/frontend-design/SKILL.md`, `.agents/skills/shadcn-ui/SKILL.md`, `.agents/skills/client-side-routing/SKILL.md`. Framework: `.agents/skills/agent-native-docs/SKILL.md`, `.agents/skills/agent-native-toolkit/SKILL.md`, `.agents/skills/customizing-agent-native/SKILL.md`.

Use local docs only (no web research): `pnpm action docs-search --query "<topic>"` and `pnpm action docs-search --slug "<slug>"`.

## Core rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Use actions for app data; never write SQL for product behavior. Keep structured state in SQL.
- Never fabricate. Report failures and recover; verify writes by reading the row or screen. Navigation is in `<current-screen>`; use `view-screen` for fresh visible-record details.
- A form's blocks are one shared model in `shared/form-model/`. Add or extend content with `compose-form`; change existing blocks precisely with `get-form` then `save-form-draft`. Both validate the block list; never hand-write blocks to add questions. Respondents see published blocks only.
- Deleting is soft: forms, submissions and workspaces go to Trash and come back with `restore-item`. `empty-trash` is permanent; ask first.

## Key actions

| Action                                                                                                         | Purpose                                                         |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `list-workspaces` / `list-forms`                                                                               | Workspaces with form rows; forms by workspace or name substring |
| `get-form`                                                                                                     | One form: published blocks, draft blocks, settings, status      |
| `create-form` / `update-form` / `move-form` / `delete-form` / `restore-form`                                   | Form lifecycle                                                  |
| `save-form-draft` / `publish-form` / `discard-form-draft`                                                      | Edit, go live, revert a published form's edits                  |
| `update-form-settings`                                                                                         | Closed, message, limits, redirect, progress bar, theme, CSS     |
| `list-submissions` / `get-submission` / `delete-submissions` / `restore-submission` / `export-submissions-csv` | Responses                                                       |
| `get-form-insights` / `get-question-summary`                                                                   | Visits, completion, per-question answers                        |
| `list-trash` / `restore-item` / `empty-trash`                                                                  | Trash                                                           |
| `create-workspace` / `update-workspace` / `delete-workspace`                                                   | Workspaces                                                      |
| `create-folder` / `rename-folder` / `delete-folder` / `reorder-forms`                                          | Folders inside a workspace; manual form order                   |
| `list-form-versions` / `get-form-version` / `restore-form-version`                                             | Version history; a restore becomes the draft                    |
| `navigate` / `view-screen`                                                                                     | Move the UI and read the current screen                         |

Theme (preset, font, colours, layout) and custom CSS live in `settings.theme` and `settings.customCss`; set them with `update-form-settings`. They apply at once, with no draft step. Custom CSS styles Preview and `/f/:id` only, through the `.forms-*` class hooks listed in the forms skill.

Public actions (`get-public-form`, `submit-response`, `record-form-event`) serve respondents without a session; do not call them as the signed-in author.

## Application state

- `navigation` has the `view` (`home`, `workspace`, `form`, `editor`, `settings`) and, on form screens, the `formId`. Use `navigate` with a view and id or a path.

Before building common workspace or agent UI, read `agent-native-toolkit`; for supported customization, read `customizing-agent-native`.
