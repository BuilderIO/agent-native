# Agent-Native Plan

Agent-Native Plan is structured visual plan mode for coding agents. It turns a
normal Markdown/Codex/Claude Code plan into a visual review surface with
editable rich blocks, diagrams, wireframes, prototype options, file/symbol
implementation maps, code previews, annotations, share links, feedback, and
HTML export.

## Install

Use the Agent-Native CLI. This is the recommended setup because it installs the
Plan skill instructions, registers the hosted Plan MCP connector, and runs the
client-specific auth/setup flow in one step:

```sh
npx @agent-native/core@latest skills add visual-plan
```

If you already have the CLI installed, the shorter command is equivalent:

```sh
agent-native skills add visual-plan
```

You do not need to wire the MCP server separately.

Supported aliases include:

- `npx @agent-native/core@latest skills add visual-plan`
- `npx @agent-native/core@latest skills add visual-recap`
- `npx @agent-native/core@latest skills add visual-questions`
- `npx @agent-native/core@latest skills add ui-plan`
- `npx @agent-native/core@latest skills add prototype-plan`

Restart or reload the host if the tools are not visible immediately.

## Use

Type `/visual-plan` when you want a fresh plan before the agent builds, or when
you already have a Codex, Claude Code, Markdown, or pasted plan and want the
agent to preserve it while adding a richer visual review surface.

Type `/visual-recap` when you want a high-level visual code-review recap from a
PR, commit, branch, or git diff. A recap is an aid for review, not a replacement
for reading the actual diff.

Type `/visual-questions` when you explicitly want visual intake before a plan.

Type `/ui-plan` when UI direction is the center of the work and you want
high-fidelity mockups and states reviewed before implementation details.

Type `/prototype-plan` when interaction feel matters and you want a clickable
prototype above the plan document.

Command behavior:

- `/visual-plan` creates a new rich visual plan with docs-level detail, diagrams,
  detailed wireframes/mockups when UI is involved, tradeoffs, open questions,
  file/symbol implementation details, code previews, and feedback prompts. When
  an existing plan is provided, it builds from that plan instead of starting
  over.
- `/visual-recap` creates a reverse plan from code that already changed:
  file-tree, diff, data-model, API, and columns blocks that let a
  reviewer scan the shape of a PR before reading line-by-line.
- `/visual-questions` creates a visual intake questionnaire with chip choices,
  freeform answers, mockup option tabs, sketch diagrams, and a generated answer
  summary that can feed `/visual-plan`, `/ui-plan`, or an existing plan update.
- `/ui-plan` creates a UI-first visual plan with an optional top pan/zoom
  wireframe or diagram canvas, then a refined Notion-like document with rich
  tabs, tables, sketchy diagrams, code tabs, comments, and handoff notes. When
  visual states are not useful, it stays document-only.
- `/prototype-plan` creates a prototype-first plan with a clickable live
  prototype, rough/clean and dark/light toggles, comment pins, a focused popout,
  static mocks, and implementation notes below.

## Normal Planning Flow

`/visual-plan` remains the main planning command. Agents should use their normal
planning flow first: inspect the codebase, gather context, ask clarifying
questions through the host's native ask-user-question tools when needed, then
create the visual plan.

The document should stay close to the Markdown plan a coding agent would
normally produce. Diagrams, wireframes, mockups, and annotations are additive
review aids. `/visual-questions` is the explicit command when a user wants
visual intake first.

Plans should be visual by default:

- diagrams for architecture, data flow, dependencies, and state machines
- detailed wireframes and quick mockups for UI work, including layout regions,
  controls, states, empty/loading/error paths, and copy placeholders
- tabs for multiple diagrams, wireframes, mockups, and design options so rich
  plans do not become long stacks of visuals
- prototype options when interaction or design direction is uncertain
- implementation maps for code work: files, symbols/components/functions,
  planned changes, concise code snippets, and explicit editor-open affordances
- plannotator-style comments, corrections, and annotations
- review prompts for options, open questions, risky assumptions, and choices
- README-like details when helpful: commands, MCP/link fallback, tool behavior,
  data shape, scope, and what is deferred

Review recaps use the same plan surface, but their center of gravity is
before/after review. Use `columns` as the generic side-by-side layout primitive
for structured before/after comparisons, and use split `diff` blocks for literal
code hunks. Use prose beside `data-model` or `api-endpoint` blocks when the
important change is semantic API or schema compatibility.

## Review Loop

1. The agent creates a plan and opens the MCP app inline or as a browser link.
2. The user reacts to visuals instead of reading a wall of Markdown.
3. The user annotates, corrects, chooses options, or asks for a clearer visual.
4. The agent reads structured feedback before editing and updates the plan or
   implementation.
5. The user can keep the plan local or sign in to share a private review link.

Local development can use the framework's auto-created dev account. Hosted
persistence, private sharing, reviewer links, and team feedback use account
login, with Google sign-in available when OAuth env vars are configured.

## Hosted App

The hosted MCP app is expected at:

- App: `https://plan.agent-native.com`
- MCP: `https://plan.agent-native.com/_agent-native/mcp`

The local template remains useful for development and self-hosting.

## PR Visual Recaps

PR automation can publish org-gated recap plans to the hosted Plan app when the
repository configures both secrets:

- `PLAN_RECAP_APP_URL` — the hosted Plan app base URL.
- `PLAN_RECAP_TOKEN` — a publish token for creating and replacing private recap
  plans.

The workflow should treat recap generation as informational only: it can update
a sticky PR comment with the recap link, but reviewers still own the real diff
review.
