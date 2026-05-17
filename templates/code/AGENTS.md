# Agent-Native Code — Agent Guide

This hidden template is a customizable browser surface for Agent-Native Code. It imports `@agent-native/code-agents-ui` for the UI and implements a local host adapter with normal agent-native actions.

The template is intentionally local-first. It can start and resume local Agent-Native Code runs through `@agent-native/core/code-agents`, which uses the same file-backed run store as the CLI and Desktop. Native terminal launch and hard process cancellation remain Desktop responsibilities.

Migration is a first-class slash-command goal on the same native run store. Do not assume a separate Migration Workbench app is available; `/migrate` sessions should behave like normal Code sessions with transcripts, follow-ups, approvals, retries, and project skills.

The standard sidebar and Agent Teams use the hosted `run-manager` lifecycle.
This template uses local long-running Code sessions, but shared dashboards and
future surfaces should go through the `@agent-native/core/code-agents`
background-run adapter/foundation so local Code and hosted background work keep
converging on one lifecycle vocabulary.

## Run Store

Agent-Native Code sessions live under:

```bash
~/.agent-native/code-agents
```

Set `AGENT_NATIVE_CODE_AGENTS_HOME` to isolate a custom store while developing this template.

## Actions

| Action                        | Purpose                                                       |
| ----------------------------- | ------------------------------------------------------------- |
| `list-code-agent-runs`        | List file-backed Agent-Native Code sessions                   |
| `list-code-agent-packs`       | List project `.agents/commands` and `.agents/skills` metadata |
| `create-code-agent-run`       | Create a run and start local execution                        |
| `read-code-agent-transcript`  | Read transcript events for a run                              |
| `append-code-agent-follow-up` | Append a follow-up and resume execution                       |
| `update-code-agent-run`       | Update run mode and metadata, including sidebar pin state     |
| `control-code-agent-run`      | Resume, refresh, or mark a run stopped                        |
| `view-screen`                 | Return current screen state                                   |
| `navigate`                    | Navigate the UI                                               |

## UI Contract

The UI receives a `CodeAgentsHost`:

```ts
interface CodeAgentsHost {
  listRuns(goalId?: string): Promise<CodeAgentRunListResult>;
  listCodePacks?(): Promise<CodeAgentCodePackResult>;
  createRun(
    request: CodeAgentCreateRunRequest,
  ): Promise<CodeAgentCreateRunResult>;
  readTranscript(
    request: CodeAgentTranscriptRequest,
  ): Promise<CodeAgentTranscriptResult>;
  appendFollowUp(
    request: CodeAgentFollowUpRequest,
  ): Promise<CodeAgentFollowUpResult>;
  updateRun(
    request: CodeAgentUpdateRunRequest,
  ): Promise<CodeAgentUpdateRunResult>;
  retryRun?(
    request: CodeAgentRetryRunRequest,
  ): Promise<CodeAgentRetryRunResult>;
  rerunRun?(request: CodeAgentRerunRequest): Promise<CodeAgentRerunResult>;
  controlRun(
    goalId: string,
    runId: string,
    command: "resume" | "status" | "stop" | "approve",
    permissionMode?: string,
  ): Promise<CodeAgentControlResult>;
}
```

Customize the app by editing the host adapter in `app/routes/_index.tsx` or replacing the action implementations. Keep UI and action parity: anything visible in the UI should remain callable as an action.

Sidebar pinning is stored on each run's metadata as `pinnedAt` (ISO timestamp, or `null` to unpin). Use `update-code-agent-run` with `{ runId, metadata: { pinnedAt } }` when the agent needs to pin or unpin a session.

Project commands and skills shown in the rail should be clickable insertion shortcuts. Commands insert `/<command>`, while skills insert a prompt that tells the agent to use that skill.

Use the shared framework composer for all prompt entry. The Code UI should
reuse `AgentComposerFrame`, `PromptComposer`, and `TiptapComposer` from
`@agent-native/core/client` so it inherits the same field shell, upload, voice,
model/effort, slash/reference, and Enter-to-submit behavior as the agent
sidebar and Brain chat. Add small host-specific controls through composer slots
instead of introducing a second textarea or visual shell implementation.

The only Code-specific composer chrome should be narrow slots around the shared
field: Auto / Plan mode, selected cwd/project metadata, and optional host
actions such as opening a terminal. Slash commands and skill shortcuts must come
from `.agents/commands/*.md` and `.agents/skills/*/SKILL.md` through
`list-code-agent-packs`; do not hardcode a separate command registry in the UI.

Background coding-agent work should reuse the shared run harness. Local Code
sessions use `@agent-native/core/code-agents`; cross-surface run lists use the
background-run adapter/foundation from that package; hosted/background app
agents use core `run-manager` and `agent-teams` / `spawnTask()` so streaming,
aborts, resume, heartbeats, and stuck-run cleanup stay consistent. Do not add a
template-specific background runner for a new Code layout.

Follow-ups are two-way and durable. If an active runner can steer safely, record
the message for the next safe continuation point. Otherwise persist it as a
queued follow-up and let the run consume it after the current turn completes.

## Limits

- Browser mode cannot open a native terminal. Use Agent-Native Desktop for that.
- `approve` runs one pending destructive-command approval; keep the prompt rare and specific.
- `stop` marks a run stopped in the store. If a separate terminal owns the process, stop that owner directly.
- Long-running work requires a local Node server. Do not deploy this template as a public hosted SaaS without replacing the background execution model.

## Development

```bash
cd templates/code
pnpm install
pnpm dev
pnpm typecheck
```
