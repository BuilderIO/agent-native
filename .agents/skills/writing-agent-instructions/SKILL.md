---
name: writing-agent-instructions
description: >-
  How to write great agent instructions for an agent-native app or template:
  AGENTS.md, skills, and tool/action descriptions. Use when authoring or
  reviewing AGENTS.md, writing a SKILL.md, wording action descriptions, or
  deciding what belongs in instructions vs skills vs memory.
scope: dev
metadata:
  internal: true
---

# Writing Agent Instructions & Skills

This is a creator-facing guide. When you build an agent-native app or template,
the agent's behavior is only as good as the instructions you give it. Three
surfaces carry that guidance: `AGENTS.md` (the map), skills (the deep dives),
and action/tool descriptions (how the agent picks the right tool). Write each
one for fast retrieval, not for prose.

## Keep AGENTS.md small and skimmable

`AGENTS.md` is loaded as orientation. It should be the smallest thing that lets
the agent act correctly, with everything deep pushed into skills. Aim for these
sections and little else:

- **Purpose line** — one sentence on what the app is and the primary workflow.
- **Core rules** — the handful of invariants that must always hold (data in SQL,
  operations go through actions, AI goes through the agent chat, schema changes
  are additive). Short, imperative bullets.
- **Application-state keys** — the `navigation`/selection/focus keys the agent
  reads to know what the user is looking at, with their shape.
- **Action table** — a compact table of action name -> purpose (see below).
- **Skills index** — a list of the skills that exist and when to read each one.

If a section is growing past a screen, it belongs in a skill. `AGENTS.md`
answers "what is this app and what can I do," not "how exactly do I do the hard
thing."

```markdown
# Projects App

One workspace for projects, tasks, and notes. Agent and UI share the same SQL
data and the same actions.

## Core Rules

- Data lives in SQL via Drizzle. Use actions for all writes.
- All AI work goes through the agent chat; never call an LLM inline.
- Schema changes are additive only.

## Application State

- `navigation.view`: `home` | `project`
- `navigation.projectId`: selected project on a project page

## Actions

| Action           | Purpose                     |
| ---------------- | --------------------------- |
| `list-projects`  | List accessible projects    |
| `create-project` | Create a project            |
| `update-project` | Rename or archive a project |

## Skills

- `project-imports` — read before importing legacy CSV exports.
- `sharing` — read before exposing a project to other users.
```

## Single-source AGENTS.md (CLAUDE.md is a symlink)

Keep one canonical instructions file: `AGENTS.md`. If a client expects
`CLAUDE.md`, make it a symlink to `AGENTS.md` rather than a second copy. Two
hand-maintained files drift, and the agent ends up with contradictory rules.
One source of truth, linked where needed.

## Keep generated guidance in sync

Framework guidance is authored once in this repo and copied outward. Treat
`.agents/skills/` as the canonical source for shared skills. Generated
workspace skills in `packages/core/src/templates/workspace-core/.agents/skills/`
and first-party template copies of shared skills must stay byte-for-byte in
sync; run `pnpm sync:workspace-skills` after editing a shared skill, and
`pnpm guard:workspace-skills` before calling the guidance done.

Generated app and workspace instructions must teach the same action-first data
contract:

- Normal app data goes through `defineAction` files in `actions/`.
- React calls actions with `useActionQuery`, `useActionMutation`, or
  `callAction`; route paths are a transport detail hidden behind helpers.
- Custom `/api/*` routes are only for route-shaped protocols such as uploads,
  streaming, webhooks, OAuth callbacks, public SEO/OG endpoints, or binary
  assets.
- Do not create pass-through routes whose main job is to call, repackage, or
  re-export an action.

When documenting version history, restore, or audit trails, use actions for
full restorable snapshots (`list-<resource>-versions`,
`get-<resource>-version`, `restore-<resource>-version`). Do not copy legacy
raw-route version panels, such as document-version `/api/*` helpers, into new
features. The Plans version-history pattern is the preferred model.

## SKILL.md frontmatter must say what AND when

The `description` is the only thing the agent sees when deciding whether to read
a skill. It must answer two questions: what the skill covers, and when to
trigger it. A description that only describes the topic will not fire.

```markdown
---
name: project-imports
description: >-
  How to import projects from the legacy CSV export. Use when the user uploads
  a project CSV or asks to migrate projects from the old system.
---
```

- Lead with the capability, then add an explicit **"Use when…"** clause.
- Be slightly pushy — over-triggering beats a skill that never loads.
- Keep it under ~40 words; it is loaded into context on every conversation.

### Scope a skill to runtime vs dev

An optional `scope` field decides which agent loads the skill:

- `both` (default when omitted) — loaded by connected repo agents and the
  in-app runtime agent.
- `runtime` — loaded only by the in-app runtime agent.
- `dev` — for the human's coding agent (e.g. Claude Code) only. A `scope: dev`
  skill is invisible to the runtime agent everywhere (system-prompt skills block
  and `docs-search`).

Use `scope: dev` for internal-only guidance that should help connected repo
agents such as Codex or Claude Code, but should not influence the deployed
production agent. Do not use `metadata.internal` for this: it is catalog/package
metadata and does not control runtime visibility.

```markdown
---
name: release-checklist
description: >-
  Steps for cutting a release. Use when preparing or publishing a new version.
scope: dev
---
```

Omit `scope` for normal skills (the default `both` keeps them loading at
runtime — fully backward compatible). For a dev-only skill, mark it `scope: dev`
and optionally mirror it under `.claude/skills/<name>/SKILL.md` so Claude Code
picks it up while the runtime agent skips it.

## Progressive disclosure: lean SKILL.md, depth in references/

Write the SKILL.md as the lean, must-know layer: the rule, how to do it, the
do/don't list, and pointers. Push long examples, exhaustive field references,
API quirks, and edge-case tables into `references/` files the agent reads only
when it needs them.

```
.agents/skills/project-imports/
├── SKILL.md            # rule + happy path + do/don't
└── references/
    └── csv-format.md   # full column spec, encodings, edge cases
```

This keeps the always-loaded surface small and lets depth scale without bloating
context. See the **create-skill** skill for the full skill format.

## Write action-oriented tables

The agent scans tables faster than prose. Prefer a table of name -> purpose over
paragraphs describing each operation. The same applies to state keys, field
types, and any enumerable set. Tables are skimmable, diffable, and easy to keep
in sync when you add an action.

## Write clear tool/action descriptions

Action descriptions are tool descriptions — they drive tool selection. Make each
one a precise, single-purpose sentence:

- Say what it does and what it returns, not how it's implemented.
- Describe each parameter in its `.describe()` so the agent fills it correctly.
- One responsibility per action. If a description needs "and also…", split it.
- Mark read-only actions (`readOnly: true` / `http: { method: "GET" }`) so the
  agent knows they're safe to call freely.
- For provider-backed shortcuts, make clear they are convenience paths, not
  capability ceilings. If arbitrary provider endpoints/filters may matter,
  point instructions to `provider-api-catalog`, `provider-api-docs`, and
  `provider-api-request` instead of implying the shortcut is all the agent can
  do.

```ts
defineAction({
  description: "Create a project. Returns the new project id and title.",
  schema: z.object({
    title: z.string().min(1).describe("Project title shown in the sidebar"),
  }),
  // ...
});
```

## Bake in anti-fabrication and verify-before-done

App instructions should make honesty and verification the default behavior:

- **Never fabricate.** If data isn't found or an action fails, say so and recover
  — don't invent results or claim success. Read the real value via an action or
  query before reporting it.
- **Verify before declaring done.** After a change, confirm it with a read-back
  (re-query the row, re-read the screen via `view-screen`) instead of assuming
  the write worked.
- **Recover, don't give up.** On a recoverable error (a failed query, a transient
  fetch), retry or fix the input rather than abandoning the task. Keep this
  separate from the anti-fabrication rule — don't conflate "don't make things up"
  with "stop at the first error."

Put these as core rules in `AGENTS.md` so they apply to every turn.

## Bake in secrets hygiene

Instruction authors must make credential handling explicit anywhere an app,
skill, action, webhook, integration, or extension touches external services.
Write the rule in terms of values, not just files: never hardcode real API keys,
tokens, webhook URLs, signing secrets, OAuth refresh tokens, private
Builder/internal data, or customer data in source, docs, tests, fixtures,
prompts, screenshots, or generated content.

Examples may name credential keys such as `OPENAI_API_KEY` or `SLACK_WEBHOOK`,
but values must be placeholders (`<OPENAI_API_KEY>`, `${keys.SLACK_WEBHOOK}`) or
clearly fake test data. Tell agents which approved channel to use instead:
deployment env vars for deploy-level secrets, `app_secrets` /
`saveCredential` / `resolveCredential` for scoped API keys, `oauth_tokens` for
OAuth, and `${keys.NAME}` substitution for extension/automation outbound HTTP.

## What goes where

- **AGENTS.md** — applies to the whole app, every turn: purpose, core rules,
  state keys, action index, skills index.
- **Skills** — reusable how-to for a specific pattern, loaded on demand. Applies
  to everyone working in the app.
- **Memory (`memory/MEMORY.md`)** — per-user preferences and corrections, not
  authored guidance. See **capture-learnings**.

## Do

- Keep `AGENTS.md` to roughly one screen of orientation; link out for depth.
- Update the action table and skills index whenever you add an action or skill.
- Write every SKILL.md description with an explicit "Use when…".
- Use tables for any enumerable set (actions, state keys, field types).

## Don't

- Don't duplicate skill content inside `AGENTS.md` — point to the skill.
- Don't maintain two instruction files; symlink `CLAUDE.md` to `AGENTS.md`.
- Don't write vague descriptions ("helps with projects") — they won't trigger.
- Don't document niche/buried UI behaviors in instructions; let code and UI
  carry those.
- Don't paste real credentials, credential-looking dummy strings, private
  Builder/internal data, or customer data into examples. Use placeholders.

## Related Skills

- **create-skill** — The skill format and templates this guide refers to.
- **adding-a-feature** — The four-area model (UI, actions, skills/instructions,
  application state) every feature must satisfy.
- **actions** — How action descriptions become agent tools.
- **context-awareness** — Application-state keys and the `view-screen` pattern.
- **capture-learnings** — Where per-user learnings go instead of AGENTS.md.
