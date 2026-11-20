---
name: extending-social
description: >-
  Where new capabilities plug into Social, with email sequences as the worked
  example. Use when the user asks to add a feature to their version of Social,
  such as "let me send email sequences from here".
scope: dev
---

# Extending Social

Social is built so a new capability lands in its own module and touches the
core app in exactly three one-line registrations. Never rewrite the drafts
editor, the sidebar or existing actions to add a feature.

## The extension points

| What | Where | How |
|---|---|---|
| Nav entry, route and agent view | `shared/extensions.ts` | Add `{ view, label, description }` to `socialExtensions`. The view becomes `/<view>`, a nav button next to Write / Plan / Analyze, a `navigate` target, and its `description` is what `view-screen` reports. |
| Screen | `app/extensions/<view>/screen.tsx` | Default-export a component; register it in `app/extensions/index.ts` as `<view>: lazy(() => import("./<view>/screen"))`. |
| Data | `server/db/extension-migrations.ts` + `server/db/schema.ts` | Append additive migrations starting at version 100; mirror the tables in the Drizzle schema with `ownableColumns()`. |
| Operations | `actions/<view>-*.ts` | One `defineAction` per operation. The UI calls them with `useActionQuery` / `useActionMutation`; the agent calls the same actions. No `/api` routes, no raw fetch. |
| Agent context | `AGENTS.md` actions table + `server/plugins/agent-chat.ts` `initialToolNames` | List the new actions so the agent finds them. |

Run `pnpm typecheck` and `pnpm test` in `templates/social` after the change.

## Worked example: email sequences

Goal: "let me send email sequences from here". A sequence is an ordered set of
email steps sent to a list of recipients, each step a delay after the previous
one, and nothing is sent until the user approves it.

1. **Manifest** (`shared/extensions.ts`):
   `{ view: "sequences", label: "Sequences", description: "Email sequences: steps, schedule and approval before send." }`
2. **Tables** (`server/db/extension-migrations.ts`, version 100):
   - `social_sequences`: `id`, `name`, `status` (`draft` | `approved` | `paused`), `recipients` jsonb (emails), `created_at`, `updated_at`, plus `owner_email`, `org_id`, `visibility`.
   - `social_sequence_steps`: `id`, `sequence_id`, `position`, `delay_days`, `subject`, `body`, `status` (`pending` | `approved` | `sent` | `failed`), `sent_at`.
   - `social_sequence_shares` via `createSharesTable` so access checks match drafts.
3. **Actions** (`actions/sequences-*.ts`): `sequences-list`, `sequences-get`,
   `sequences-create`, `sequences-update` (steps and recipients, with a
   revision check like `update-draft`), `sequences-approve` (marks the
   sequence and its pending steps approved; the UI shows an explicit
   Approve button), `sequences-send-due` (sends only approved steps whose
   time has come). Reuse `identity()` and `accessFilter` from
   `server/drafts.ts`.
4. **Sending:** send through the user's Mail app, never a new SMTP or API
   client inside Social. The agent sends each approved, due step with the Mail
   app's send action in the same chat (the workspace exposes the user's apps
   as tools), then records the result with `sequences-update`. Credentials stay
   in workspace connections. Never send an unapproved step, never send to
   anyone the user did not list, and in tests use only the QA account.
5. **Screen** (`app/extensions/sequences/screen.tsx`): a list of sequences
   and, for the selected one, its recipients, numbered steps with delay
   ("Day 0", "Day 3"…), subject and body, each step's status, and the Approve
   / Pause buttons. Use the existing `@/components/ui` primitives and the
   app's CSS variables so it matches the rest of Social.
6. **A sequence from a draft:** a nice touch is a "Turn into email
   sequence" menu item in the draft editor that calls `sequences-create`
   with the draft's posts as steps. Add it as a menu item only; don't
   restructure the editor.

## Rules that still apply

- Drafts and sequences are private by default; respect access checks.
- No model calls inside actions; AI work goes through the agent chat.
- Social never publishes or schedules posts on real social networks.
