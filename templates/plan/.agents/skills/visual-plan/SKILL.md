---
name: visual-plan
description: >-
  Use Agent-Native Plans when coding-agent work needs a reviewable plan
  published as an interactive document — inline diagrams, annotated code
  walkthroughs, file trees, optional UI wireframes or prototypes, open-question
  forms, and comments — before implementation starts.
metadata:
  visibility: exported
---

# Agent-Native Plans

Agent-Native Plans is structured visual planning mode for coding agents. Build
the plan you would normally write in Markdown, but as a scannable document with
editable blocks mixed in: inline diagrams, code snippets,
open questions, and an optional top visual review area (wireframe canvas, live
prototype, or both in tabs). Architecture and backend plans stay document-only;
UI and product plans start with the top canvas/prototype (the Visual Surface
Choice section owns that rule).

`/visual-plan` is the packaged command and main entry point. Choose the review
mode from the task: UI-first when the work is primarily product UI and review
should start with screens, prototype-first when review should start with a
functional live prototype, design-first when review needs full-fidelity branded
screens, or visual-intake when the user explicitly wants a questionnaire before
planning. When a Codex, Claude Code, Markdown, or pasted plan already exists,
`/visual-plan` uses that source plan as the starting point and builds the review
surface from it instead of starting over.

## When To Use

Create or adapt a visual plan when work is multi-file, ambiguous, long-running,
risky, or UI-heavy, when architecture / data flow / UI direction / options /
open questions would benefit from inline diagrams or structured blocks, when the
user needs to react to a direction before you implement, or when an existing text
plan needs a richer review surface.

## Plan Discipline

- **Gate hard.** A polished visual plan is the most expensive plan form; only
  invest when a wrong direction is costly. Skip it for trivial, unambiguous work
  — typos, one-line fixes, a single well-specified function, anything whose diff
  you could describe in one sentence — and just make the change. Never pad a plan
  with filler and never ship a single-step plan.
- **Research before you draft.** Read the real files, actions, schema, and
  patterns first; name actual files, symbols, and data shapes instead of
  inventing them. Check existing `actions/` before proposing endpoints and prefer
  named client helpers over raw fetch. Delegate wide exploration to a sub-agent.
  Lead with reuse: for each step, name what it reuses — existing actions, schema,
  components, helpers — before what it adds, so the plan explains the genuinely new
  delta instead of redescribing what already exists.
- **Decide the hard-to-reverse bets first.** For non-trivial backend, data, or API
  work, sketch where the feature is headed, then call out the decisions that are
  expensive to undo once data or callers depend on them — wire format, public ids,
  data-model shape, auth and ownership boundaries — and get those right in the plan
  even if most of the feature ships later. Then scope to the smallest first cut that
  proves the approach without foreclosing it, stating both what is in and what is
  explicitly deferred.
- **Keep examples at the right altitude.** When the user's idea is a broad
  framework, product, or operating-model change, do not collapse it into the
  first concrete example, provider, or sync path they mention. Separate the core
  abstraction from motivating examples and app/provider adapters. Use examples
  to make the plan legible, but label them as examples unless they are the whole
  requested scope.
- **Publish standalone plans.** If the user pasted, referenced, or already has a
  Codex / Claude Code / Markdown plan, treat it as source material, but rewrite
  the published plan as a clean standalone proposal. Preserve the source plan's
  useful intent and codebase facts, label inferred visuals as inferred, and avoid
  revision language such as "preserve the prior plan", "do not drop the old
  idea", "unlike the previous version", or "this revision changes...". A reader
  who never saw the chat or earlier drafts should understand the plan.
- **Make the first read concrete.** If the plan is meant to be shared with
  someone outside the chat, or if the concept is abstract, lead near the top with
  one concrete product example before mode tables, architecture, or roadmaps. For
  UI-capable concepts, that usually means a top-canvas app state that shows the
  real user workflow in product terms. Do not rely on phrases that only make
  sense in conversation, and do not frame the plan as "not the old idea"; state
  the positive model directly.
- **Planning is read-only.** Make no source edits while building or reviewing the
  plan. Start editing only after the user approves the direction.
- **Clarify vs. assume.** Do not ask how to build it — explore and present the
  approach and options in the plan. Ask a clarifying question only when an
  ambiguity would change the design and you cannot resolve it from the code; use
  the host agent's normal ask-user-question flow and batch 2-4 high-leverage
  questions before finalizing. Do not call `create-visual-questions` from
  `/visual-plan`. Otherwise state the assumption explicitly and proceed, and
  keep anything unresolved in the plan's single bottom `question-form` Open
  Questions block. For complex plans, do a final open-question pass before
  handoff: if a decision would affect architecture, scope, UX, data shape, or
  rollout, either decide it in the plan with rationale or put it in that bottom
  form with a recommended default.
- **The plan is the approval gate.** After surfacing it, ask the user to review
  and approve before you write code, and name which files/areas the work touches.
  Presenting the plan and requesting sign-off is the approval step — do not ask a
  separate "does this look good?" question.
- **The document is the source of truth, not the chat.** When scope shifts,
  update the plan with `update-visual-plan` rather than only changing course in
  chat, and make the updated document stand alone. Do not describe the update as
  a correction to an earlier draft inside the plan itself. Re-read the approved
  plan before major steps.

## Always Publish As An Agent-Native Plan — Never Inline

The deliverable is ALWAYS a published Agent-Native Plan created via the Plan
MCP connector (`plan` server, or legacy `agent-native-plans`). NEVER hand the
plan over as inline chat content — no Markdown prose, ASCII sketch, table, or
fenced wireframe. If the connector's tools are missing, do NOT fall back to
inline output: the usual cause is a connector that did not finish connecting
this session (it registers zero tools), not auth. Stop and give the user the
exact restore step for their current client: in Codex/Codex Desktop run
`npx -y @agent-native/core@latest reconnect https://plan.agent-native.com --client codex`
and start a new Codex session; in Claude Code run `/mcp` and choose
Authenticate/Reconnect (or run the same reconnect command with
`--client claude-code` and restart Claude). Auth is stored per client
config/session, so one client's reconnect does not make another running client
load tools. Never reinstall from scratch just to fix auth. Publish once the tool
is reachable. Local-files privacy mode (after Tool Guidance) is the only
exception.

## Core Workflow

1. Follow the host agent's normal planning flow: inspect the codebase, delegate
   wide exploration when useful, gather the info needed, and ask native
   clarifying questions as needed before generating the plan. If a source plan
   already exists, gather its exact text from the user's paste, a referenced
   file, or recent visible agent context; do not invent source text.
2. Call `get-plan-blocks` for the authoritative block catalog — do not author
   from memorized tags. Then call the mode-matched create tool:
   `create-visual-plan` for document-first plans (architecture, backend, data,
   refactor, API), `create-ui-plan` for UI-first plans, `create-prototype-plan`
   for prototype-first plans, `create-plan-design` for design-first plans,
   `create-visual-questions` only when the user explicitly asks for a visual
   intake questionnaire. When a source plan already exists,
   pass it as `planText` and preserve the original plan's useful intent while
   producing a standalone plan document, not a revision memo.
3. For UI/product plans, compose the top canvas first with the primary
   wireframes and annotated states, then write the document with native blocks
   (see `references/canvas.md` and `references/document-quality.md`). For
   broad product architecture plans with a user-facing implication, add a
   concrete "what this looks like in the app" visual before the abstract
   architecture or mode tables. Keep the document close to the standalone
   Markdown plan the agent would normally output. If an existing plan was
   provided, carry forward the right facts and decisions without referring to
   the previous draft or explaining how this version differs. For non-visual
   plans, skip the top visual surface (Visual Surface Choice below owns the rule)
   and put `diagram`, `data-model`,
   `api-endpoint`, `diff`, `file-tree`, `code`, and `annotated-code` blocks
   directly next to the relevant prose.
4. Surface the returned Plans link or inline MCP App and ask the user to review.
   Always include the actual URL in chat so the next step is a click in CLI or
   other text-only hosts. When the host exposes an embedded browser/preview panel
   and a tool can open arbitrary URLs there, open the returned plan URL
   automatically for convenient review — a convenience and smoke test, never the
   only handoff or the access
   model. Plans should load out of the box for the local agent and local browser
   session; if a signed-in embedded browser cannot read a local plan that an
   anonymous/tool check can read, fix the app/action ownership or access path
   rather than patching one plan by hand. For high-stakes plans (architecture,
   backend, data, multi-file, or risky), also kick off the self-review pass in
   **Self-Review Before Handoff** while the user reads, instead of blocking the
   handoff on it.
5. Call `get-plan-feedback` before editing, after review, after any long pause,
   and before the final response. Treat `anchorDetails`, resolver intent, recent
   review events, and any focused screenshots from browser handoff as the source
   of truth for exactly what changed and exactly what each comment points at.
6. Apply changes with `update-visual-plan`, preferring targeted `contentPatches`.
   Treat the top-level `content` payload as a full replacement, not a merge; do
   not send a partial `content` object to add a canvas or one block. If a full
   replacement is unavoidable, first read the complete plan source/content, carry
   forward every existing block and visual surface, and verify the source/export
   afterward so the document body was not truncated. When the user wants
   source-control friendly edits, use `patch-visual-plan-source` against the MDX
   files instead of regenerating the plan.
7. Export with `export-visual-plan` only when the user wants a shareable receipt
   or repo-check-in artifacts.

## Self-Review Before Handoff

For high-stakes plans — architecture, backend, data-model, migration, multi-file,
or otherwise risky work — run one adversarial self-review pass before treating the
plan as final. Skip it for small, UI-only, or single-decision plans where the cost
outweighs the value. Keep the pass cheap and non-blocking:

- **Surface the plan first, review concurrently.** Post the link and let the user
  start reading, then run the review in parallel — never make the user wait on it.
- **Review the written plan; do not re-research.** Critique the plan text and its
  own blocks. The grounding was already done while drafting, so the review checks
  the output instead of re-exploring the repo.
- **Spawn one skeptical reviewer** whose only job is to find what is weak, missing,
  or wrong — not to praise. Point it at: hard-to-reverse decisions made implicitly
  or not at all (wire format, public ids, data-model shape, auth, ownership); steps
  not anchored in real files or symbols; a menu of options where the plan should
  commit to one; obvious missing decisions ("what happens when X?", "why not Y?");
  and padding or single-step filler.
- **Fix vs. ask.** Apply clear-cut fixes yourself with `update-visual-plan`
  `contentPatches` — vague non-goals, unanchored claims, an obvious missing
  decision. Route genuine judgment calls back to the user instead: add them to the
  bottom `question-form` Open Questions block or batch them into the normal
  ask-user-question flow. Do not silently decide them.
- **Do not surprise the user mid-read.** On a large plan, apply the patches before
  the editor loads; otherwise note briefly that a self-review is running so the
  plan changing under them is expected. When you next respond, summarize what the
  review changed and what it surfaced for the user to decide.

## Visual Surface Choice

Choose the surface before creating the plan or after reading the source plan. Do
not add visual chrome by default:

For UI/product plans, the top canvas is usually the primary review surface. Put
the first meaningful wireframes there, not buried as document-body blocks. Use
multiple canvas artboards when states matter, such as the default view, an
overflow menu or popover, a side panel, loading, or error. Put short annotations
beside frames with `targetId` plus `placement`; keep implementation details,
tradeoffs, file maps, data contracts, risks, and verification in the document
body below the canvas.

Keep product wireframes and explanatory/meta diagrams separate. Start with pure
screens that look like the app state under discussion, without callout prose or
architecture notes embedded inside the UI. Put arrows, labels, contracts, data
flow, and mode explanations in separate annotations, separate canvas diagrams,
or the document body.

When the plan touches an existing app, inspect the current shell/components
before drawing. The first artboard should look like the real app at the same
density: existing sidebars, toolbar placement, overflow menus, app chrome, and
framework agent chrome stay in their real places. Model secondary surfaces as
separate states, such as a top-right overflow popover, sheet, panel, loading
state, or separate AgentSidebar, rather than inventing a permanent inspector or
folding framework chrome into the product UI.

- **No visual surface** for architecture-only, backend-only, data migration,
  copy-only, or otherwise non-visual plans. Do not use the top canvas for
  architecture diagrams, dependency maps, file plans, API contracts, or
  data-flow-only reviews. Use a strong document with local inline diagrams
  only when relationships need a visual explanation, usually one spatial diagram
  per recommendation or decision. Prefer grouped regions, layers, quadrants,
  matrices, or before/after panels over a single-axis chain unless the
  relationship is truly sequential.
- **Canvas only** for one static screen, a before/after comparison, a component
  state, a small popover, or a visual direction that does not require clicking.
  Put those wireframes in `content.canvas` and omit `content.prototype`.
- **Canvas + prototype** for multi-step UI flows, onboarding, wizards,
  review/approval flows, navigation changes, or anything where the reviewer
  needs to operate the behavior. Keep the static wireframes in
  `content.canvas`, add the aligned functional prototype in
  `content.prototype`, and rely on the top visual tabs to switch between them.
- **Prototype-first** when the user asks to operate the UI or when interaction is
  the main question. Use `create-prototype-plan`, which still preserves static
  mocks where useful.

For mixed canvas + prototype plans, reuse the same real labels, app statuses,
and screen ids across both surfaces. The canvas is the inspectable static reference;
the prototype is the interactive version of that same flow, not a separate
design direction.

## Wireframe quality — read `references/wireframe.md`

UI recap/plan wireframes must meet a strict quality bar — full-width chrome,
pinned bottom bars, real product content, before/after comparability, the right
`surface` preset, `--wf-*` tokens instead of hex, and no `<html>`/`<style>`/font
tags. Before authoring ANY wireframe / `<Screen>` / `WireframeBlock`, READ
`references/wireframe.md` in this skill directory — it is the single source of
truth for HTML wireframe quality, shared word for word with `/visual-plan`
and `/visual-recap`. Do not author wireframes from memory.

## Canvas — read `references/canvas.md`

The canvas is the single source of truth for static UI mockups: the `surface`
locks each artboard's footprint, mixed surfaces lay out
in lanes, annotations are plain-text designer notes anchored by
`targetId`/`placement`, and edits are surgical `contentPatches`. Before
authoring or editing ANY canvas, artboard, or annotation, READ
`references/canvas.md` in this skill directory — it is the single source of truth
for canvas/artboard mechanics. Do not author canvas layouts from memory.

## Document quality — read `references/document-quality.md`

The document is a serious technical plan, not marketing: outcome-first,
prose-first, self-contained, built from the right native blocks, with open
questions in a single bottom `question-form` and a pre-handoff visual check.
Before authoring the plan document, READ `references/document-quality.md` in this
skill directory — it is the single source of truth for the document quality bar.
Do not write the document from memory.

## Good vs. bad exemplar — read `references/exemplar.md`

For a worked example of the bar — a great UI-first plan and `/visual-plan`, plus
the anti-patterns to avoid — READ `references/exemplar.md` in this skill
directory before authoring a plan.

## Tool Guidance

- `create-visual-plan`: start one structured visual plan per agent task/run, or
  import an existing text plan by passing `planText`; `content` may include no
  visual surface, canvas only, or canvas + prototype.
- `create-ui-plan`: start a UI-first plan when the work is primarily product UI.
- `create-prototype-plan`: start a prototype-first plan with a functional top
  review surface.
- `create-plan-design`: start a full-fidelity branded Design-tab plan with an
  optional matching Prototype tab.
- `convert-visual-plan-to-prototype`: convert an existing HTML wireframe canvas
  into a prototype plan.
- `create-visual-questions`: use only when the user explicitly asks for a visual
  intake questionnaire, not as `/visual-plan` preflight.
- `update-visual-plan`: revise content, status, or comments with targeted
  `contentPatches` (see Core Workflow step 6).
- `read-visual-plan-source`: read the normalized plan as `plan.mdx`,
  optional `canvas.mdx`, optional `.plan-state.json`, and JSON.
- `patch-visual-plan-source`: apply granular MDX AST patches by stable block,
  artboard, annotation, component, or wireframe-node id.
- `import-visual-plan-source`: create or replace a plan from an MDX folder.
- `get-visual-plan`: read the current structured plan, exported HTML, and
  annotations; it also returns the MDX folder for source workflows.
- `get-plan-feedback`: read unconsumed human feedback. Use it frequently; it
  returns grouped threads, exact anchor details, expected resolver, and recent
  review-event payloads so agents can act only on the comments meant for them.
- `get-plan-blocks`: resolve block tags before authoring — do not memorize tags;
  call this first to get the authoritative tag names, required fields, and prop
  shapes from the live block registry.
- `export-visual-plan`: export HTML, Markdown fallback, structured JSON, and MDX
  files for repo check-in.

When the user critiques a plan's look or structure, fix the renderer or this
skill — never hand-edit one stored plan. Turn feedback into better guidance.

## Local-Files Privacy Mode

Use local-files privacy mode when the user explicitly asks for no DB writes,
no hosted Plan app, no Plan MCP publish, fully local files, offline/private
planning, or when `AGENT_NATIVE_PLANS_MODE=local-files` is set. In this mode the
plan data must never be sent to the Plan MCP server or Plan app action surface.

The local-files contract is:

- Read source context from local files and shell commands only.
- Write the plan as a local MDX folder under `plans/<slug>/`: `plan.mdx`,
  optional `canvas.mdx`, optional `prototype.mdx`, and optional
  `.plan-state.json`.
- Run `npx @agent-native/core@latest plan local preview --dir plans/<slug> --kind plan` after
  writing or updating the folder. Report the returned local URL or the
  `/local-plans/<slug>` route if the local Plan app is running with the same
  `PLAN_LOCAL_DIR`.
- Do **not** call `create-visual-plan`, `create-ui-plan`,
  `create-prototype-plan`, `create-plan-design`, `import-visual-plan-source`,
  `update-visual-plan`, `patch-visual-plan-source`, `get-plan-feedback`,
  `export-visual-plan`, or any hosted Plan tool for that plan.
- Treat feedback as file or chat feedback: update the MDX files directly, rerun
  the local preview command, and summarize the new local URL/path. Hosted
  comments, sharing, history, and publish/export receipts are unavailable until
  the user explicitly opts into publishing.

Local-files mode prevents plan content from going to the Agent-Native Plan
database. It does not by itself make the coding agent's language model local;
for that stronger privacy boundary, the host agent/model must also be local or
otherwise approved by the user.

## Interpreting comment anchors

`get-plan-feedback` returns rich anchors — read them before acting on any comment.

- **Coordinate frames.** `targetX`/`targetY` are percentages *within* the
  element named by `targetSelector`/`targetKind`. Bare `x`/`y` are percentages
  of the whole plan document. `canvasX`/`canvasY` are raw board-world pixels on
  the design canvas (board size given when available).
- **Wireframe pins.** Anchors on wireframes include `targetNodeId` and
  `targetNodePath` (e.g. `card > list > listItem "Acme Inc"`) identifying the
  exact kit node. Use `targetNodeId` directly with wireframe node patch ops;
  use `data-design-id` values from design artboards with
  `update-design-element-style`. Prefer the node id/path over raw coordinates;
  fall back to coordinates plus the focused screenshot (red ring marks the exact
  point) only when no node id is present.
- **Text quotes.** Resolve `textQuote` against current prose using
  `contextBefore`/`contextAfter` for disambiguation. If `ambiguous: true`, ask
  the user — do not guess which occurrence is meant.
- **Detached comments.** `get-plan-feedback` flags threads whose quoted text no
  longer exists as `detached` (in `detachedThreads`). Reconcile these against
  rewritten content — never silently drop them.
- **Routing.** `resolutionTarget` is the only routing signal: act on `agent`,
  treat `human` as context only. `@mentions` are people to notify, never a
  routing signal.
- **Two-axis state.** Mark every ingested comment as consumed
  (`consumedCommentIds` on `update-visual-plan`). Set `status=resolved` only on
  agent-targeted comments you actually addressed; leave human-targeted comments
  open.

## Visibility & Sharing

Use `set-resource-visibility` to change who can see a plan (e.g. public, login,
or org-scoped). Use `share-resource` to grant specific users or roles access
by email or role. Gate visibility before sharing any plan that covers
unreleased or private work — default to the narrowest scope that meets the
review need.

## Setup & Authentication

There are two ways into Plans.

**Coding agent (CLI).** Install once with the Agent-Native CLI. The command
installs the Plans skills, registers the hosted Plans MCP connector, and runs
auth/setup for the selected local client(s) in the same step (a one-time browser
sign-in at setup — this is intended), so the first tool call in that client does
not hit an OAuth wall:

```bash
npx @agent-native/core@latest skills add visual-plan
```

After that, `/visual-plan` and `/visual-recap` are the two installed slash
commands. The other planning modes (`create-ui-plan`, `create-prototype-plan`,
`create-plan-design`, `create-visual-questions`) are MCP tools reachable from
`/visual-plan`, not separate slash commands. Pass `--no-connect` to register
the connector without authenticating, then run
`npx @agent-native/core@latest connect https://plan.agent-native.com --client all`
whenever you are ready, or choose a narrower `--client`. Auth and MCP tool
loading are per client config/session.

**Browser (people you share with).** Open the Plans editor and create & edit
with no sign-up — you work as a guest. Sign in only when you want to save or
share; signing in claims the plans you made as a guest into your account.

Sharing and commenting require an account: public/shared plans are viewable by
anyone with the link, but commenting on them needs an agent-native account.

For fully offline, no-account use, run the Plans app locally and sync plans to
your repo as MDX. This local mode is a separate advanced path, not the default
hosted flow.

If a Plans tool returns `needs auth`, `Unauthorized`, or `Session terminated`,
do not keep retrying the tool. Stop and give the user the reconnect step for the
client they are using: Codex/Codex Desktop should run
`npx -y @agent-native/core@latest reconnect https://plan.agent-native.com --client codex`
and start a new Codex session; Claude Code should run `/mcp` and choose
Authenticate/Reconnect for the plan connector, or run the reconnect command with
`--client claude-code` and restart Claude. To refresh every local client config
that already has the Plan entry, use `--client all`, then restart/reload each
client. Reconnect re-authenticates WITHOUT reinstalling and finds the entry by
URL regardless of connector name. Never reinstall from scratch just to fix auth.
Continue once the connector is available.

Hosted default: connect `https://plan.agent-native.com/_agent-native/mcp`. Do
not put shared secrets in skill files.
