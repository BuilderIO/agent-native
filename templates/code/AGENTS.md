# Agent-Native Code — Agent Guide

This hidden template is a customizable browser surface for Agent-Native Code. It imports `@agent-native/code-agents-ui` for the UI and implements a local host adapter with normal agent-native actions.

The template is intentionally local-first. It can start and resume local Agent-Native Code runs through `@agent-native/core/code-agents`, which uses the same file-backed run store as the CLI and Desktop. Native terminal launch and hard process cancellation remain Desktop responsibilities.

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
| `update-code-agent-run`       | Update run mode metadata                                      |
| `control-code-agent-run`      | Resume, refresh, or mark a run stopped                        |
| `view-screen`                 | Return current screen state                                   |
| `navigate`                    | Navigate the UI                                               |

## UI Contract

The UI receives a `CodeAgentsHost`:

```ts
interface CodeAgentsHost {
  listRuns(goalId?: string): Promise<CodeAgentRunListResult>;
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
  controlRun(
    goalId: string,
    runId: string,
    command: "resume" | "status" | "stop",
    permissionMode?: string,
  ): Promise<CodeAgentControlResult>;
}
```

Customize the app by editing the host adapter in `app/routes/_index.tsx` or replacing the action implementations. Keep UI and action parity: anything visible in the UI should remain callable as an action.

## Limits

- Browser mode cannot open a native terminal. Use Agent-Native Desktop for that.
- `stop` marks a run stopped in the store. If a separate terminal owns the process, stop that owner directly.
- Long-running work requires a local Node server. Do not deploy this template as a public hosted SaaS without replacing the background execution model.

## Development

```bash
cd templates/code
pnpm install
pnpm dev
pnpm typecheck
```
