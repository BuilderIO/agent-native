---
name: harness-agents
description: >-
  Add or use full agent harness runtimes like Claude Code, Codex, Pi, Cursor, Mastra, or ACP agents inside Agent Native.
scope: dev
---

# Harness Agents

## Rule

Full agent harnesses are not `AgentEngine` providers. Use the `AgentHarness`
substrate in `@agent-native/core/agent/harness`.

## Why

`AgentEngine` is for one model round trip beneath `runAgentLoop`. Harnesses like
Claude Code, Codex, Pi, Cursor, and Mastra own their own loop, workspace,
native tools, session state, compaction, approval model, and sandbox behavior.
Putting a harness under `AgentEngine.stream()` double-runs the loop and loses
session lifecycle semantics.

## How

1. Register or resolve a harness adapter.

```ts
import {
  registerBuiltinAgentHarnesses,
  resolveAgentHarness,
} from "@agent-native/core/agent/harness";

registerBuiltinAgentHarnesses();
const harness = resolveAgentHarness("ai-sdk-harness:codex");
```

2. Start a turn through the run-manager bridge.

```ts
import { startAgentHarnessRun } from "@agent-native/core/agent/harness";

startAgentHarnessRun({
  runId,
  threadId,
  adapter: harness,
  input: { prompt },
  createSession: {
    sessionId,
    resumeState,
    instructions,
    sandbox,
    permissionMode: "allow-reads",
  },
  ownerEmail,
  orgId,
});
```

3. Persist native session state in SQL.

Use `saveAgentHarnessSession`, `updateAgentHarnessSession`, and
`getLatestAgentHarnessSessionForThread`. The `resumeState` is opaque; Agent
Native stores it but does not inspect it.

4. Surface runs through background agents.

Harness runs are projected into the shared `BackgroundAgentRun` shape with
`createAgentHarnessBackgroundAgentController()` and are available through the
existing run routes as `goalId=agent-harness`.

## ACP Agents

Agent Native can act as an [ACP](https://agentclientprotocol.com) (Agent Client
Protocol) client and drive a local coding agent — Gemini CLI, Claude Code, or
any ACP-compliant agent — through this same substrate. This is scoped to **local
coding**: the agent is spawned as a child process speaking newline-delimited
JSON-RPC over stdio, and inherits the parent environment so it reuses the user's
local CLI login. It is not a hosted/sandboxed transport, and it is not a
chat/A2A transport.

```ts
import {
  registerBuiltinAgentHarnesses,
  resolveAgentHarness,
} from "@agent-native/core/agent/harness";

registerBuiltinAgentHarnesses();

// Built-in presets (commands overridable via the resolve config):
const gemini = resolveAgentHarness("acp:gemini");
const claude = resolveAgentHarness("acp:claude-code");

// Or any ACP agent by command:
const custom = resolveAgentHarness("acp", {
  command: "gemini",
  args: ["--experimental-acp"],
});
```

- The protocol transport (`@zed-industries/agent-client-protocol`) is an optional
  dependency loaded lazily; `installPackage` surfaces a clear install hint.
- The agent binary (e.g. `@google/gemini-cli`, `@zed-industries/claude-code-acp`)
  is a separate external CLI the user installs; presets launch it through `npx`
  by default and the command/args are overridable because agent ACP entry flags
  still evolve.
- `permissionMode` maps onto ACP `session/request_permission` using the reported
  tool-call kind: reads always run, edits run under `allow-edits`, everything
  risky prompts unless `allow-all`. Approvals surface as `approval-request`
  events; answer them through the harness session's `approve()`.
- `resumeState` carries the ACP `sessionId`; resume works when the agent
  advertises the `loadSession` capability and degrades to a fresh session
  otherwise.
- `fs/read_text_file` and `fs/write_text_file` are served against the session
  workspace and refuse paths that escape it; terminal methods are not advertised
  (the agent uses its own shell).

## Adapter Guidance

- Keep harness packages optional. Use dynamic imports in adapters and expose an
  install hint through `installPackage`.
- Use the AI SDK harness adapter as one implementation, not as Agent Native's
  public abstraction.
- For bridge-backed coding harnesses, require a real sandbox/workspace provider.
  Do not run arbitrary coding agents in the host process by default.
- Pass only a narrow, intentional set of Agent Native actions as host tools.
  Preserve `defineAction` auth, request context, timeouts, truncation, and
  read-only metadata.

## Code Execution Sandbox

- The `run-code` tool executes through a pluggable `SandboxAdapter`
  (`packages/core/src/coding-tools/sandbox/`). The default
  `LocalChildProcessAdapter` spawns a locked-down local Node child process;
  swap it via `AGENT_NATIVE_SANDBOX` or `registerSandboxAdapter()` for a
  Docker/remote backend. An adapter only runs the already-prepared, non-secret
  module source — it never sees app secrets. See the Sandbox Adapters doc;
  `agent-native add sandbox docker` emits a full Docker-adapter recipe.
- Long compute exceeds the hosted ~40s run ceiling via the built-in durable
  background backend: per-call `background: true` on `run-code` (or
  `AGENT_NATIVE_SANDBOX=background` to queue every call) enqueues to the
  `sandbox_executions` table and executes out-of-band — self-dispatched to
  `/_agent-native/sandbox/_process-execution` on serverless, in-process on
  long-lived Node — with lease-based claiming, retries, and owner-scoped
  polling via `run-code {executionId}` / `get-code-execution`.

## Sub-Agent Delegation Depth

- Sub-agent spawning is capped server-side (default depth `2`) so delegation
  chains can't fan out indefinitely. Override at deploy time with
  `AGENT_NATIVE_MAX_SUBAGENT_DEPTH` (`0` disables sub-agents; clamped to `16`).
  Enforcement is ambient via `evaluateSubagentDepth` in
  `packages/core/src/server/agent-teams.ts` — independent of any tool-level
  guard. See the Agent Teams doc for the depth model.

## Don't

- Don't add Claude Code, Codex, Cursor, Mastra, or Pi as an `AgentEngine`.
- Don't replay full Agent Native chat history into a native harness each turn.
  Resume the harness session instead.
- Don't store resume state in `application_state`; it belongs in the harness
  session SQL table.
- Don't expose every app action to every harness session by default.

## Related Skills

- `adding-a-feature` — feature parity across UI/actions/instructions/state.
- `delegate-to-agent` — background agents use run-manager infrastructure.
- `external-agents` — expose openable resources and external-agent surfaces.
- `storing-data` — durable SQL state and additive schema changes.

