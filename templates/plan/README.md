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

Restart or reload the host if the tools are not visible immediately.

## Use

It comes down to two commands: `/visual-plan` to plan before the agent builds,
and `/visual-recap` to review a change after it lands.

Type `/visual-plan` when you want a fresh plan before the agent builds, or when
you already have a Codex, Claude Code, Markdown, or pasted plan and want the
agent to preserve it while adding a richer visual review surface.

Type `/visual-recap` when you want a high-level visual code-review recap from a
PR, commit, branch, or git diff. A recap is an aid for review, not a replacement
for reading the actual diff.

Command behavior:

- `/visual-plan` creates a new rich visual plan with docs-level detail, diagrams,
  detailed wireframes/mockups when UI is involved, clickable prototypes when the
  interaction feel matters, tradeoffs, open questions, file/symbol implementation
  details, code previews, and feedback prompts. It can open with a short visual
  intake step when the direction is still open. When an existing plan is
  provided, it builds from that plan instead of starting over.
- `/visual-recap` creates a reverse plan from code that already changed:
  file-tree, diff, data-model, API, and columns blocks that let a
  reviewer scan the shape of a PR before reading line-by-line.

## Normal Planning Flow

`/visual-plan` remains the main planning command. Agents should use their normal
planning flow first: inspect the codebase, gather context, ask clarifying
questions through the host's native ask-user-question tools when needed, then
create the visual plan.

The document should stay close to the Markdown plan a coding agent would
normally produce. Diagrams, wireframes, mockups, and annotations are additive
review aids, and `/visual-plan` can open with a short visual intake step when the
direction is still open.

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
