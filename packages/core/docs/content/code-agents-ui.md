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
  createRun: (request) => createRunSomehow(request),
  readTranscript: (request) => readTranscriptSomehow(request),
  appendFollowUp: (request) => appendFollowUpSomehow(request),
  updateRun: (request) => updateRunSomehow(request),
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
- rendering app-backed surfaces with `AppWebview`
- handling `agentnative://open?...` links
- tracking local run processes
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

| Method                                                | Purpose                             |
| ----------------------------------------------------- | ----------------------------------- |
| `listRuns(goalId?)`                                   | List sessions for the selected goal |
| `createRun(request)`                                  | Start a new run                     |
| `readTranscript(request)`                             | Read transcript/tool/status events  |
| `appendFollowUp(request)`                             | Add a follow-up to an existing run  |
| `updateRun(request)`                                  | Update mode or run metadata         |
| `controlRun(goalId, runId, command, permissionMode?)` | Resume, refresh, or stop            |
| `openTerminal?(request)`                              | Optional native terminal hook       |

Browser hosts should return a graceful `openTerminal` error instead of trying to emulate native terminal launch.

## Slash Commands

Agent-Native Code treats migration as a capability, not a separate app category. `/migrate` can be a built-in goal, a project command, or a custom instruction pack on top of the same host contract.

Project-specific commands live in:

```text
.agents/commands/*.md
```

Use these for team workflows such as release checks, migration variants, framework upgrades, or audits.

## Styling

Import the package stylesheet:

```ts
import "@agent-native/code-agents-ui/styles.css";
```

The stylesheet uses the same shadcn-style HSL custom properties as the templates and Desktop shell. Prefer changing tokens or small class overrides in the host app before forking the shared UI.

## Limits

The browser template is local-first. It can start and resume runs while its local Node server is alive. For native process lifecycle, terminal launch, and app webviews, use Desktop.
