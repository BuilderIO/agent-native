# Agent-Native for VS Code

[Agent-Native](https://www.agent-native.com/docs) opens agent-native app surfaces
inside VS Code: visual plans, visual recaps, and Design canvases next to the
files being changed. It also connects your workspace to Agent-Native MCP apps so
agents like Claude Code, Codex, and GitHub Copilot can create and open those
surfaces directly.

Plans come from two skills — `/visual-plan` and `/visual-recap` — in the
open-source [BuilderIO/skills](https://github.com/BuilderIO/skills) repo.

## `/visual-plan`

Turn ordinary text plans into rich interactive visual plans with diagrams, file
maps, annotated code, open questions, and UI/prototype review when useful.

Solves for plans that are too important to bury in chat. The output is
scannable, commentable, and intuitive enough for a human to approve before code
changes start.

![Visual plan review surface](https://raw.githubusercontent.com/BuilderIO/skills/main/media/visual-plan.png)

## `/visual-recap`

Turn a branch, commit, or PR diff into an interactive visual recap with annotated
diffs, diagrams, API/schema summaries, file maps, UI state summaries, and focused
review notes.

Solves for diffs that hide the shape of the change. Reviewers can understand
contracts, architecture moves, schema changes, and UI impact before diving into
raw line-by-line review.

![Visual recap review surface animation](https://raw.githubusercontent.com/BuilderIO/skills/main/media/visual-recap.gif)

Visual plans and recaps are MDX, customizable with your own components, and
viewed with the [Agent-Native Plans app](https://www.agent-native.com/docs/template-plan).
[Source here](https://github.com/BuilderIO/agent-native/).

## `/visual-edit`

Open a running local app in
[Agent-Native Design](https://www.agent-native.com/docs/template-design) as
URL-backed iframe screens for visual editing, route-state review, and flow
comparison.

The extension's **Agent Native: Open Design Canvas** command starts the local
Design bridge for the current workspace and opens `https://design.agent-native.com`
in the VS Code side panel so you can choose the localhost connection directly.

## What this extension adds

Without it, an agent's plan link opens in a separate browser tab. With it:

- **Review in a side panel.** Open any plan, recap, or Design canvas in a VS
  Code webview so it stays next to the code it describes.
- **One-click handoff from any agent.** Plans tools return a
  `vscode://builder.agent-native/open?url=...` link; the extension decodes it and
  opens the app in the editor.
- **Connect your workspace to Agent-Native MCP.** A single command runs the
  `@agent-native/core` connect flow for VS Code / GitHub Copilot, so your agent
  can create plans, recaps, and Design artifacts directly.
- **Open local apps in Design.** Start the `design connect` bridge and open the
  Design app in the VS Code panel for `/visual-edit` workflows.

## Install

Install
[Agent-Native](https://marketplace.visualstudio.com/items?itemName=Builder.agent-native)
from the Visual Studio Marketplace, or run:

```bash
code --install-extension Builder.agent-native
```

To add the `/visual-plan`, `/visual-recap`, and `/visual-edit` skills to your
coding agent:

```bash
npx @agent-native/skills@latest add
```

## Commands

- **Agent Native: Open Agent Native** opens the configured default app.
- **Agent Native: Open Agent Native URL** opens any `http(s)` Agent Native app
  URL or `vscode://builder.agent-native/open?url=...` handoff link.
- **Agent Native: Connect Workspace to Agent Native MCP** runs the existing
  `@agent-native/core` connect flow for VS Code / GitHub Copilot MCP.
- **Agent Native: Open Design Canvas** starts the local Design bridge for a
  running app and opens Design in the VS Code side panel.

## Handoff URL

External agents can open a focused Agent Native app view with:

```text
vscode://builder.agent-native/open?url=https%3A%2F%2Fdesign.agent-native.com
```

The embedded URL must be `http` or `https`.

## Development

```bash
pnpm --filter agent-native build
pnpm --filter agent-native test
pnpm --filter agent-native test:e2e
```
