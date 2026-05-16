---
title: "Agent-Native Code UI"
description: "Build and customize Agent-Native Code surfaces with the shared UI package, Desktop host bridge, CLI run store, and hidden code template."
---

# Agent-Native Code UI

Agent-Native Code is the Agent-Native coding surface: a local Claude Code/Codex-style workspace for coding sessions, slash commands, migrations, audits, transcripts, and follow-ups.

There are three layers:

- **CLI**: `npx @agent-native/core@latest code` starts and resumes runs.
- **Desktop**: the left-sidebar Code surface adds native terminal launch, app webviews, and desktop deep links.
- **Shared UI**: `@agent-native/code-agents-ui` renders the reusable React surface.

The shared UI is host-driven. It does not know whether it is running in Electron, a browser template, or a future hosted shell. Hosts provide a `CodeAgentsHost` implementation.

```ts
import { CodeAgentsApp, type CodeAgentsHost } from "@agent-native/code-agents-ui";
import "@agent-native/code-agents-ui/styles.css";

const host: CodeAgentsHost = {
  listRuns: (goalId) => listRunsSomehow(goalId),
  listCodePacks: () => listCodePacksSomehow(),
  createRun: (request) => createRunSomehow(request),
  readTranscript: (request) => readTranscriptSomehow(request),
  appendFollowUp: (request) => appendFollowUpSomehow(request),
  updateRun: (request) => updateRunSomehow(request),
  retryRun: (request) => retryRunSomehow(request),
  rerunRun: (request) => rerunRunSomehow(request),
  controlRun: (goalId, runId, command, permissionMode) =>
    controlRunSomehow({ goalId, runId, command, permissionMode }),
};

export function CodeSurface() {
  return <CodeAgentsApp apps={[]} host={host} />;
}
```

## Desktop Host

Desktop uses the shared UI but keeps privileged capabilities in Electron:

- opening a native terminal
- rendering optional app-backed surfaces with `AppWebview`
- handling `agentnative://open?...` links
- tracking local run processes
- recording steering vs queued follow-ups for active runs
- retrying and re-running native Code sessions, including `/migrate` and `/audit`
- stopping a process it started

That separation matters. The UI can be reused by templates, but native process control should stay in Desktop or CLI.

## Browser Template

The hidden `code` template is a starting point for building your own Agent-Native Code UI:

```bash
npx @agent-native/core@latest create my-code-ui --template code
cd my-code-ui
pnpm install
pnpm dev
```

Inside the framework repo, run it directly with:

```bash
cd templates/code
pnpm install
pnpm dev
```

The template wraps the local run store through normal actions:

- `list-code-agent-runs`
- `list-code-agent-packs`
- `create-code-agent-run`
- `read-code-agent-transcript`
- `append-code-agent-follow-up`
- `update-code-agent-run`
- `control-code-agent-run`

It uses `@agent-native/core/code-agents`, which exposes the same file-backed run store and executor used by the CLI.

## Run Store

Local Agent-Native Code runs are stored at:

```text
~/.agent-native/code-agents
```

Set `AGENT_NATIVE_CODE_AGENTS_HOME` to isolate a template or test run store.

```bash
AGENT_NATIVE_CODE_AGENTS_HOME=./data/code-agents pnpm dev
```

## Host Contract

`CodeAgentsHost` is intentionally small:

| Method                                                | Purpose                                                |
| ----------------------------------------------------- | ------------------------------------------------------ |
| `listRuns(goalId?)`                                   | List sessions for the selected goal                    |
| `listCodePacks?()`                                    | List `.agents/commands` and `.agents/skills`           |
| `createRun(request)`                                  | Start a new run                                        |
| `readTranscript(request)`                             | Read transcript/tool/status events                     |
| `appendFollowUp(request)`                             | Add a follow-up, either steering active work or queued |
| `updateRun(request)`                                  | Update mode or run metadata                            |
| `retryRun?(request)`                                  | Retry the selected run in place                        |
| `rerunRun?(request)`                                  | Start a new run from a previous prompt                 |
| `controlRun(goalId, runId, command, permissionMode?)` | Resume, approve, refresh, or stop                      |
| `openTerminal?(request)`                              | Optional native terminal hook                          |

Browser hosts should return a graceful `openTerminal` error instead of trying to emulate native terminal launch.

## Shared Composer

Agent-Native Code uses the same `AgentComposerFrame` + `PromptComposer` /
`TiptapComposer` stack as the framework agent sidebar. Do not fork a separate
textarea, shell, upload picker, voice button, model picker, or Enter-to-submit
implementation for Code-like surfaces. If a host needs one extra control, pass
it through the shared composer extension points so the sidebar, Code UI, and
Brain chat keep the same interaction model and visual field.

Brain's Ask route uses `AgentChatSurface`, which is already backed by the
standard sidebar composer. Code uses `PromptComposer` directly because the host
owns run creation, transcripts, and follow-up delivery.

## Slash Commands

Agent-Native Code treats migration as a capability, not a separate app category. `/migrate` can be a built-in goal, a project command, or a custom instruction pack on top of the same host contract.

Project-specific commands live in:

```text
.agents/commands/*.md
```

Use these for team workflows such as release checks, migration variants, framework upgrades, or audits.

Project skills live in:

```text
.agents/skills/*/SKILL.md
```

When the host implements `listCodePacks`, the shared UI shows project commands and skills in the rail. Command rows insert `/<command>`, and skill rows insert a focused “Use the <skill> skill…” prompt so the rail stays actionable. Built-in names such as `/migrate`, `/audit`, `/status`, and `/resume` stay reserved for the global Agent-Native Code controls.

## Follow-Ups

Follow-ups on active runs support two delivery modes:

- **Send now** records a steering prompt that the active runner applies at the next safe continuation point.
- **Queue** runs after the current turn finishes.

Inactive runs keep the compatible behavior: the follow-up is appended and the run resumes immediately.

## Styling

Import the package stylesheet:

```ts
import "@agent-native/code-agents-ui/styles.css";
```

The stylesheet uses the same shadcn-style HSL custom properties as the templates and Desktop shell. Prefer changing tokens or small class overrides in the host app before forking the shared UI.

## Limits

The browser template is local-first. It can start and resume runs while its local Node server is alive. For native process lifecycle, terminal launch, and app webviews, use Desktop.
