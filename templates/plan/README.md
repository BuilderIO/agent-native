# Agent-Native Plans

Agent-Native Plans is HTML plan mode for coding agents. It turns a normal
Markdown/Codex/Claude Code plan into a visual review surface with diagrams,
wireframes, prototype options, file/symbol implementation maps, code previews,
annotations, share links, and feedback.

## Install

Use the Agent-Native CLI:

```sh
agent-native skills add visual-plan
```

The CLI installs the Plans skills and registers the MCP app connector. You do
not need to wire the MCP server separately.

Supported aliases include:

- `agent-native skills add visual-plan`
- `agent-native skills add visual-questions`
- `agent-native skills add ui-plan`
- `agent-native skills add visualize-plan`

Restart or reload the host if the tools are not visible immediately.

## Use

Type `/visual-plan` when you want a fresh plan before the agent builds.

Type `/visual-questions` when you want to force visual intake before a plan.

Type `/ui-plan` when UI direction is the center of the work and you want
high-fidelity mockups and states reviewed before implementation details.

Type `/visualize-plan` when you already have a Codex, Claude Code, Markdown, or
pasted plan and want a richer visual companion.

Command behavior:

- `/visual-plan` creates a new rich HTML plan with docs-level detail, diagrams,
  detailed wireframes/mockups when UI is involved, tradeoffs, open questions,
  file/symbol implementation details, code previews, and feedback prompts.
- `/visual-questions` creates a visual intake questionnaire with chip choices,
  freeform answers, mockup option tabs, sketch diagrams, and a generated answer
  summary that can feed `/visual-plan`, `/ui-plan`, `/visualize-plan`, or an
  existing plan update.
- `/ui-plan` creates a UI-first HTML plan with an optional top pan/zoom
  wireframe or diagram canvas, then a refined Notion-like document with rich
  tabs, tables, sketchy diagrams, code tabs, comments, and handoff notes. When
  visual states are not useful, it stays document-only.
- `/visualize-plan` imports an existing text plan, preserves its intent, and
  adds visual structure so the user can annotate and react before implementation.

## Visual-Question Preflight

`/visual-plan` remains the main planning command. Before creating the plan, the
agent should automatically run a visual-question preflight when 2-6 visual
answers would materially change the result.

Good preflight triggers include fuzzy UI direction, form factor, layout model,
feature scope, visual style, architecture shape, or flow depth; multiple
plausible visual options; or a user request to see choices before planning.

Skip preflight for tiny or unambiguous work, when the codebase makes the answer
clear, or when the missing detail can be safely stated as an assumption in the
plan. `/visual-questions` is the manual override when a user explicitly wants
intake first.

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
