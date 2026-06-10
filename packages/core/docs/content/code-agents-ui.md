---
title: "Agent-Native Code UI"
description: "Build and customize Agent-Native Code surfaces with the shared UI package, Desktop host bridge, and CLI run store."
---

# Agent-Native Code UI

Agent-Native Code is the Agent-Native coding surface: a local Claude Code/Codex-style workspace for coding sessions, slash commands, migrations, audits, transcripts, run controls, and follow-ups. A bare `npx @agent-native/core@latest` command opens this workspace; `npx @agent-native/core@latest code` is the explicit subcommand for the same experience.

There are three layers:

- **CLI**: `npx @agent-native/core@latest` and `npx @agent-native/core@latest code` start, resume, inspect, and stop runs.
- **Desktop**: the left-sidebar Code tab adds native terminal launch, app webviews, and desktop deep links while using the same run model.
- **Shared UI**: `@agent-native/code-agents-ui` renders the reusable React surface.

The current split is intentionally converging: the standard agent sidebar and Agent Teams run on the core `run-manager` lifecycle, while Agent-Native Code uses local long-running sessions backed by the file-based Code run store and the shared background-run controller vocabulary.

The shared UI is host-driven. It does not know whether it is running in Electron, a browser template, or a future hosted shell. Hosts provide a `CodeAgentsHost` implementation.

```ts
import { CodeAgentsApp, type CodeAgentsHost } from "@agent-native/code-agents-ui";
import "@agent-native/code-agents-ui/styles.css";

const host: CodeAgentsHost = {
  listRuns: (goalId) => listRunsSomehow(goalId),
  listCodePacks: () => listCodePacksSomehow(),
  createRun: (request) => createRunSomehow(request),
  subscribeTranscript: (request, callback) =>
    subscribeToTranscriptSomehow(request, callback),
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

Hosts can mix run sources in the same list. Local Agent-Native Code sessions
can appear next to Agent Teams or other background-run adapters as long as each
entry normalizes to `CodeAgentRun`. When a host supplies `sourceLabel`,
`source`, or `kind`, the hub renders a small source label such as "Local Code"
or "Agent Teams" in the run list and selected-session header. Omit those fields
for a single-source surface; the empty state and base layout stay unchanged.

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

## Browser Host

The old hidden `code` template has been removed. To build a browser-hosted Code surface, create a normal app and mount the shared UI package with a host implementation:

```bash
npx @agent-native/core@latest create my-code-ui --template starter
cd my-code-ui
pnpm add @agent-native/code-agents-ui
pnpm install
pnpm dev
```

Your host can wrap the local run store through normal actions. These are
host-owned actions you would define yourself — they are not shipped framework
actions — mapping each `CodeAgentsHost` method onto the run store, for example:

- a "list runs" action backing `listRuns`
- a "list code packs" action backing `listCodePacks`
- a "create run" action backing `createRun`
- a "read transcript" action backing `readTranscript`
- an "append follow-up" action backing `appendFollowUp`
- an "update run" action backing `updateRun`
- a "control run" action backing `controlRun`

Each one calls `@agent-native/core/code-agents`, which exposes the same
file-backed run store and executor used by the CLI.

## CLI Run Controls

The top-level CLI behaves like Claude Code or Codex:

```bash
npx @agent-native/core@latest
npx @agent-native/core@latest "fix the failing auth tests"
npx @agent-native/core@latest code
```

Use `npx @agent-native/core@latest code` when you want the explicit namespace. Built-in slash
goals and project commands can run inside the interactive workspace or directly
from the shell:

```bash
npx @agent-native/core@latest code /migrate ./legacy-app --emit ./migration-dossier
npx @agent-native/core@latest code /audit --url https://example.com
npx @agent-native/core@latest code /release-check
```

Here `/migrate` and `/audit` are built-in goals (the built-in goals are
`task`, `migrate`, and `audit`). `/release-check` is shown as an example of a
project command — defined in `.agents/commands/`, not a built-in goal. Project
commands come from `.agents/commands/*.md`; project skills come from
`.agents/skills/*/SKILL.md`. The control commands operate on the same run
records that the Desktop Code tab and shared UI display:

```bash
npx @agent-native/core@latest code list
npx @agent-native/core@latest code status --last
npx @agent-native/core@latest code attach --last
npx @agent-native/core@latest code logs --last
npx @agent-native/core@latest code resume --last
npx @agent-native/core@latest code stop --last
npx @agent-native/core@latest code ui
```

`resume` appends context and continues a run, `status` reports the latest run
state, `stop` asks the active controller to halt work, and `ui` opens the local
Code surface. These are run controls, not a separate implementation path. If a
high-risk command pauses for approval, `approve --last` runs that one pending
command and then points you back to resume the session.

Run modes make editing policy explicit per session:

| Mode          | CLI flag | Behavior                                                                                                 |
| ------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| **Plan mode** | `--plan` | Inspect, plan, and explain without writing files or running mutations.                                   |
| **Auto mode** | `--auto` | Edit files, run checks, and pause only for genuinely destructive file, git, publish, or data operations. |

Auto mode is the default for local Agent-Native Code sessions. Use Plan mode for
assessment, architecture, review, or any task where you want a proposal before
edits.

For cross-surface lists, dashboards, or monitoring panes, prefer the shared
background-run exports from `@agent-native/core/code-agents` over reading Code
run files directly. They normalize local Code sessions into the same vocabulary
used by hosted background work: run id, status, cwd, needs-input,
needs-approval, transcript events, and artifact root.

Hosted Agent Teams are also exposed from the agent chat route for browser
hosts that need a Code hub-compatible list without direct server imports:
`GET /_agent-native/agent-chat/runs/list?goalId=agent-team` returns
`{ status: "ok", goalId, runs }`, where each run includes `kind`,
`source`, `sourceLabel`, `status`, `title`, timestamps, and task metadata.
`GET /_agent-native/agent-chat/runs/:id/background-events` returns the
shared background transcript events for an Agent Teams run.

Adapter-backed hosts may also attach source metadata:

```ts
{
  id: run.id,
  goalId: "task",
  title: run.title,
  source: "agent-teams",
  sourceLabel: "Agent Teams",
  kind: "background-run",
  status: run.status,
  createdAt: run.createdAt,
  updatedAt: run.updatedAt,
}
```

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
| `subscribeTranscript?(request, callback)`             | Push transcript updates to the shared conversation     |
| `readTranscript(request)`                             | Poll transcript events as a compatibility fallback     |
| `appendFollowUp(request)`                             | Add a follow-up, either steering active work or queued |
| `updateRun(request)`                                  | Update mode or run metadata                            |
| `retryRun?(request)`                                  | Retry the selected run in place                        |
| `rerunRun?(request)`                                  | Start a new run from a previous prompt                 |
| `controlRun(goalId, runId, command, permissionMode?)` | Resume, approve, refresh, or stop                      |
| `openTerminal?(request)`                              | Optional native terminal hook                          |

Browser hosts should return a graceful `openTerminal` error instead of trying to emulate native terminal launch.

## Shared Composer

Agent-Native Code uses the same `AgentComposerFrame` + `PromptComposer` /
`TiptapComposer` stack exported from `@agent-native/core/client/composer` as the
framework agent sidebar. Do not fork a separate
textarea, coding-tool picker, upload picker, voice button, model picker, or Enter-to-submit
implementation for Code-like surfaces. If a host needs one extra control, pass
it through the shared composer extension points so the sidebar, Code UI, and
Brain chat keep the same interaction model and visual field.

Brain's Ask route uses `AgentChatSurface`, which is already backed by the
standard sidebar composer. Code uses `PromptComposer` directly because the host
owns run creation, transcripts, and follow-up delivery.

## Shared Coding Tools

The sidebar development agent and Agent-Native Code both use the same minimal
coding-tool profile: `bash`, `read`, `edit`, and `write`. `bash` is the default
for listing/searching files, running tests, and invoking project CLIs; `read`
shows line-numbered file slices; `edit` applies exact text replacements; and
`write` is reserved for new files or intentional full rewrites. Older aliases
such as `shell`, `read-file`, `write-file`, `list-files`, and `search-files`
are compatibility-only and are not part of the default advertised surface.

Code-specific UI belongs around the composer, not inside a forked chatfield. The
shared Code UI may add slots for:

- Auto / Plan mode controls.
- The selected cwd, project picker, and run metadata.
- Host-only affordances such as opening a terminal.

Everything else stays in the shared composer: attachments, references, slash and
skill insertion, pasted-text handling, voice dictation, drafts, keyboard
shortcuts, and submission semantics.

The user-facing transcript should stay conversational. Code hosts normalize raw
transcript/status/tool events into the shared conversation renderer: assistant
text coalesces into one turn, low-signal lifecycle noise stays out of the main
surface, and tool activity renders as compact inline summaries with details
available when needed.

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

When the host implements `listCodePacks`, the shared UI shows project commands and skills in the rail. Command rows insert `/<command>`, and skill rows insert a focused “Use the <skill> skill…” prompt so the rail stays actionable. The built-in slash goals `/migrate` and `/audit` stay reserved for the global Agent-Native Code controls, as do run-control names such as `status` and `resume` — those are subcommands invoked without a slash (`npx @agent-native/core@latest code status`, `npx @agent-native/core@latest code resume`), not slash goals.

Do not create a separate slash-command registry for a new Code host. Project
commands and skills are discovered from `.agents/commands/*.md` and
`.agents/skills/*/SKILL.md`; the UI should render those packs and insert prompts
through the shared composer.

## Background Agent Run-Manager

Background coding-agent work should reuse the same run-manager foundation as the
rest of Agent-Native:

- Use the Code run store/executor for local Code sessions.
- Use the shared background-run adapter/foundation when a surface needs to list,
  inspect, or bridge local Code sessions alongside other background work.
- Use core `run-manager` for hosted agent runs so streams, aborts, heartbeats,
  resumability, soft timeouts, and stuck-run cleanup behave consistently.
- Use `agent-teams` / `spawnTask()` when the UI is delegating work to a
  background sub-agent from a normal app chat.

Do not add a parallel background-agent runner just because a new surface needs a
different layout. Build a host adapter or UI slot on top of the shared
run-manager foundation instead.

## Follow-Ups

Follow-ups on active runs support two delivery modes:

- Pressing Enter or clicking send records an immediate steering prompt that the
  active runner applies at the next safe continuation point.
- Pressing Cmd+Enter on macOS or Ctrl+Enter elsewhere queues the prompt to run
  after the current turn finishes.

Inactive runs keep the compatible behavior: the follow-up is appended and the run resumes immediately.

That gives Code the same user-facing two-way messaging shape as Agent Teams:
the user can keep talking to active work, but execution only consumes that
message at a safe continuation point. If a runner cannot steer immediately, it
must persist the follow-up as queued work rather than dropping or racing it.

## Remote Dispatch

Desktop can expose the local Code Agent runner to a deployed Dispatch relay so a
phone or Telegram chat can start, monitor, and continue sessions while the
computer is awake.

The connection is outbound-only from Desktop:

1. Desktop pairs with Dispatch and stores a device token locally.
2. Desktop long-polls `/_agent-native/integrations/remote/poll`.
3. Mobile Sessions and Telegram `/code` enqueue commands in the relay database.
4. Desktop claims commands, drives the local run store, and posts results and
   transcript events back to Dispatch.
5. Mobile reads `hosts`, `runs`, and `transcript` from Dispatch; it never talks
   directly to the desktop.

The canonical remote relay endpoints are:

| Method     | Route                                                    | Caller          | Purpose                                     |
| ---------- | -------------------------------------------------------- | --------------- | ------------------------------------------- |
| `POST`     | `/_agent-native/integrations/remote/register`            | Desktop session | Pair a desktop host and return a token once |
| `GET`      | `/_agent-native/integrations/remote/hosts`               | Mobile/session  | List paired hosts                           |
| `DELETE`   | `/_agent-native/integrations/remote/devices/:id`         | Mobile/session  | Revoke a paired host                        |
| `POST`     | `/_agent-native/integrations/remote/devices/:id/revoke`  | Mobile/session  | Revoke a paired host                        |
| `POST/GET` | `/_agent-native/integrations/remote/poll`                | Desktop token   | Claim work                                  |
| `POST`     | `/_agent-native/integrations/remote/result`              | Desktop token   | Complete or fail work                       |
| `POST`     | `/_agent-native/integrations/remote/run-events`          | Desktop token   | Mirror transcript events                    |
| `GET`      | `/_agent-native/integrations/remote/runs`                | Mobile/session  | List sessions                               |
| `GET`      | `/_agent-native/integrations/remote/runs/:id`            | Mobile/session  | Read session summary                        |
| `GET`      | `/_agent-native/integrations/remote/runs/:id/transcript` | Mobile/session  | Read mirrored transcript                    |
| `POST`     | `/_agent-native/integrations/remote/push/register`       | Mobile/session  | Register Expo/mobile push token             |

Telegram uses the same relay through Dispatch. Supported commands are:

```text
/code <prompt>
/code list
/code status <run>
/code continue <run> <text>
/code approve <id>
/code deny <id>
/code stop <run>
```

## Styling

Import the package stylesheet:

```ts
import "@agent-native/code-agents-ui/styles.css";
```

The stylesheet uses the same shadcn-style HSL custom properties as the templates and Desktop shell. Prefer changing tokens or small class overrides in the host app before forking the shared UI.

## Limits

The browser template is local-first. It can start and resume runs while its local Node server is alive. For native process lifecycle, terminal launch, and app webviews, use Desktop.
