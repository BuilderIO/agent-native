# Forms — Agent Guide

Forms is an agent-native form builder and response workspace. The agent creates,
edits, publishes, shares, and analyzes forms through actions and SQL-backed state.
The first screen is the chat: start by helping the user build, set up, inspect,
or analyze their form workspace, then navigate into app views when a richer
editor or table is useful.

## Skills

Read relevant guides before deeper work:
- `.agents/skills/form-building/SKILL.md` — for form schema and field work.
- `.agents/skills/form-publishing/SKILL.md` — for publishing, submissions, and sharing.
- `.agents/skills/form-responses/SKILL.md` — for response review and analysis.

`.agents/skills/actions/SKILL.md`, `.agents/skills/adding-a-feature/SKILL.md`, `.agents/skills/storing-data/SKILL.md`, `.agents/skills/security/SKILL.md`,
`.agents/skills/secrets/SKILL.md`, `.agents/skills/sharing/SKILL.md`, `.agents/skills/frontend-design/SKILL.md`, `.agents/skills/shadcn-ui/SKILL.md`,
`.agents/skills/real-time-sync/SKILL.md`, `.agents/skills/context-awareness/SKILL.md`, `.agents/skills/delegate-to-agent/SKILL.md`, `.agents/skills/agent-native-docs/SKILL.md`,
`.agents/skills/agent-native-toolkit/SKILL.md`, `.agents/skills/customizing-agent-native/SKILL.md`, `.agents/skills/client-side-routing/SKILL.md`, `.agents/skills/reliable-mutations/SKILL.md`,
`.agents/skills/performance/SKILL.md`, `.agents/skills/external-agents/SKILL.md`, `.agents/skills/portability/SKILL.md`, `.agents/skills/self-modifying-code/SKILL.md`,
`.agents/skills/turn-into-skill/SKILL.md`, `.agents/skills/workspace-conventions/SKILL.md`.

## Framework Docs

Use local framework docs, not web research: `pnpm action docs-search --query "<topic>"` searches; `pnpm action docs-search --slug "<slug>"` reads a page.

## Actions

| Action | Purpose |
| --- | --- |
| `view-screen` / `navigate` | Read selection / move UI |
| `create-form` / `update-form` / `patch-form-fields` | Create/update forms and fields |
| `list-forms` / `get-form` | List/read definitions |
| `preview-form` | Show setup summary and editor link |
| `response-insights` / `show-response-insight` | Analyze responses or show a theme |
| `list-responses` / `export-responses` | Read/export submissions |

## Core Rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Use actions for form data and navigation; do not bypass ownable access checks or invent SQL.
- For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver.
- One request, one form: an open form is context, not a default write target. A prompt naming another form means `create-form`, not `update-form`.
- For response analytics and setup previews, follow `form-responses`; use `response-insights` / `preview-form` and typed results.
- If usage or product data belongs to another app, use `describe-workspace-apps` if ownership is unclear, then delegate a narrow question with `call-agent`. Analytics normally owns first-party signup, conversion, and app usage; never query another app's database.
- For publishing, follow `form-publishing`; copy the returned `publicUrl` verbatim. Public submission endpoints are intentionally public; management routes stay authenticated.
- `settings.emailOnNewResponses` sends owner notifications; conditional/hidden fields follow `form-building`. Webhook/Slack/Discord/Sheets integrations also follow `form-publishing`.
- Use framework sharing actions for forms and response resources.

## Team Roles

Reviewer reviews responses; Editor edits. Both need resource access. See `form-responses` for role policy.

## Application State

- `navigation` exposes `/home` chat, builder, published form, responses, insights, and `form.selection`; builder `activeTab` is `edit`, `responses`, `settings`, or `integrations`.
- `navigate` opens home, forms, builder, responses, insights, preview, or team/settings views. Builder tabs use `view=form`, form id, and `tab=edit|responses|settings|integrations`.

## Chat-First Workflow

- `/home` is the primary chat surface for building, setup, inspection, and analysis. The public `/` redirects to shared sign-in/signup.
- Use `navigate` for focused work: `/forms`, `/forms/:id?tab=edit|responses|settings|integrations`, `/forms/:id/responses`, or `/response-insights`.
- When asked to see responses, navigate to the response view; use the form from `view-screen` or an @-tagged id. For @-tagged forms, pass that id to `preview-form`, `response-insights`, `list-responses`, or `navigate`.
- For setup, inspect state first; use `db-status` / `db-connect` for DB/cloud setup and form actions for the rest.
- Use typed results for chat tables/charts; `response-insights` is the native path. Do not show both unless requested; iframe/MCP rendering is only a fallback for external hosts.

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read `customizing-agent-native` before adapting shared UI.

Search with `rg --hidden --follow`; read the exact linked guide before deeper work.
