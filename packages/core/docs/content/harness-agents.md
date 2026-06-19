---
title: "Harness Agents"
description: "Run Claude Code, Codex, Pi, and other full coding harnesses as embedded agents inside Agent-Native, with their own loop, sandbox, native tools, and resumable SQL-backed sessions."
search: "harness agents AgentHarness ai-sdk HarnessAgent Claude Code Codex Pi Cursor Mastra embedded coding agent resolveAgentHarness startAgentHarnessRun resumable session sandbox host tools"
---

# Harness Agents

> **Who is this for:** host authors wiring a full coding runtime (Claude Code,
> Codex, Pi) into Agent-Native as the agent. Building an app? Start with
> [Creating Templates](/docs/creating-templates).

A harness agent is a full agent runtime — Claude Code, Codex, Pi, and similar —
that owns its own loop, workspace, native file tools, session state, compaction,
approval model, and sandbox behavior. Agent-Native runs these through the
**`AgentHarness`** substrate in `@agent-native/core/agent/harness`, streams their
events into the normal transcript, and persists their native session so a thread
can pause and resume.

This is different from the built-in chat agent and from bringing your own chat
runtime. The built-in agent and `AgentEngine` are for one model round trip
beneath `runAgentLoop`. A harness is not an `AgentEngine` provider — it runs its
own loop end to end, so Agent-Native drives it as a session, not as a single
model call.

## Which coding doc do I want? {#which-doc}

| You want to…                                                               | Use                                          |
| -------------------------------------------------------------------------- | -------------------------------------------- |
| Run Claude Code / Codex / Pi **as the agent**, with their own loop + tools | **Harness agents** (this page)               |
| Render a Claude-Code/Codex-style **coding workspace UI**                   | [Agent-Native Code UI](/docs/code-agents-ui) |
| Swap the backend that runs the agent's **`run-code` tool**                 | [Adapters](/docs/sandbox-adapters)           |
| Wrap a CLI tool (`gh`, `ffmpeg`) for the agent to call                     | [Adapters](/docs/sandbox-adapters)           |

Adjacent surfaces: put an agent you built elsewhere behind Agent-Native's chat
UI with [`AgentChatRuntime`](/docs/native-chat-ui#byo-agent-runtimes); let an
external MCP host call into your app via [External Agents](/docs/external-agents);
spawn background / sub-agent runs with [Custom Agents & Teams](/docs/agent-teams).

## Built-in harnesses {#built-in}

`registerBuiltinAgentHarnesses()` registers three adapters backed by the AI SDK
`HarnessAgent`:

| Name                         | Runtime     | Sandbox | Approvals |
| ---------------------------- | ----------- | ------- | --------- |
| `ai-sdk-harness:claude-code` | Claude Code | yes     | yes       |
| `ai-sdk-harness:codex`       | Codex       | yes     | no        |
| `ai-sdk-harness:pi`          | Pi          | no      | yes       |

Their runtime packages are **optional peer dependencies** and load lazily, so an
app that never uses a harness does not pay for it. Each adapter carries an
`installPackage` hint (for example `@ai-sdk/harness@canary
@ai-sdk/harness-codex@canary`); `resolveAgentHarness` throws a clear install
error if the packages are missing, and `isAgentHarnessPackageInstalled(entry)`
lets you check first.

## Codex auth: Code UI vs harness sandboxes {#codex-auth}

There are two Codex surfaces, and they authenticate differently:

- **Agent-Native Code / Desktop** runs `codex exec` on the user's machine. If
  the user has run `codex login`, this local run reuses whatever ChatGPT
  subscription or API-key auth the installed Codex CLI reports through
  `codex login status`.
- **`ai-sdk-harness:codex`** loads `@ai-sdk/harness-codex`, which drives Codex
  inside the harness sandbox through `@openai/codex-sdk`. It does not silently
  inherit the user's Desktop `~/.codex` login because the sandbox may be remote
  or isolated. For trusted/private sandboxes, opt in with `codexCliAuth: true`;
  Agent-Native copies the local Codex CLI auth file into the sandbox before the
  harness starts. For hosted or shared sandboxes, configure API-key / gateway
  auth instead.

So if someone asks which package carries the Codex OAuth path: for local coding
sessions, use `@agent-native/core` / Desktop plus the installed
`@openai/codex` CLI and `codex login`. For sandboxed `ai-sdk-harness:codex`,
use the explicit `codexCliAuth` opt-in when copying that login into the sandbox
is acceptable.

```ts
const adapter = resolveAgentHarness("ai-sdk-harness:codex", {
  codexCliAuth: true,
});
```

`codexCliAuth: true` reads `CODEX_HOME/auth.json` or `~/.codex/auth.json`. To
point at a different local login, pass
`{ codexCliAuth: { codexHome: "/path/to/.codex" } }` or
`{ codexCliAuth: { authJsonPath: "/path/to/auth.json" } }`.

## Register and resolve {#register-resolve}

```ts
import {
  registerBuiltinAgentHarnesses,
  resolveAgentHarness,
} from "@agent-native/core/agent/harness";

registerBuiltinAgentHarnesses();
const adapter = resolveAgentHarness("ai-sdk-harness:codex");
```

`resolveAgentHarness(name, config?)` returns an `AgentHarnessAdapter`. The
optional `config` is forwarded to the adapter factory — for the AI SDK adapters
that maps to `AiSdkHarnessAdapterOptions` (`label`, `description`,
`permissionMode`, `harnessOptions`, `agentOptions`, and the Codex-only
`codexCliAuth`). Use `listAgentHarnesses()` to enumerate what is registered for
a picker.

## Run a turn {#run-a-turn}

`startAgentHarnessRun` bridges a harness session into the shared run-manager
lifecycle. It creates (or reuses) the native session, persists it, streams the
turn, translates each harness event into transcript events, and detaches the
resumable state when the turn completes.

```ts
import { startAgentHarnessRun } from "@agent-native/core/agent/harness";

const run = startAgentHarnessRun({
  runId,
  threadId,
  adapter,
  input: { prompt },
  createSession: {
    sessionId,
    resumeState, // opaque value from a previous turn, if resuming
    instructions,
    sandbox, // required for sandboxed harnesses — see Sandbox Adapters
    permissionMode: "allow-reads",
    tools, // a narrow, intentional set of host tools (see below)
  },
  ownerEmail,
  orgId,
});
```

`startAgentHarnessRun` returns the `ActiveRun` from the run-manager, so the turn
shows up through the existing run routes, transcript, and cancellation just like
any other agent run. Pass an already-created `session` instead of `createSession`
to continue a session you are holding in memory.

## Sessions and resume {#sessions}

A harness owns long-lived native session state. Agent-Native persists it in SQL
so a thread can survive across turns, processes, and deploys. The `resumeState`
is **opaque** — Agent-Native stores it and hands it back, but never inspects or
interprets it.

```ts
import {
  getLatestAgentHarnessSessionForThread,
  listAgentHarnessSessions,
} from "@agent-native/core/agent/harness";

const last = await getLatestAgentHarnessSessionForThread(threadId);
// Feed last?.resumeState into createSession.resumeState on the next turn.
```

The store also exposes `saveAgentHarnessSession`, `updateAgentHarnessSession`,
`getAgentHarnessSession`, `getAgentHarnessSessionByRunId`,
`markAgentHarnessSessionStopped`, and `ensureAgentHarnessSessionTables`.
`startAgentHarnessRun` calls the save/update/stop paths for you; reach for them
directly only in a custom host.

## Host tools and permissions {#host-tools}

A harness brings its own native tools (read, edit, write, shell, and so on), so
you do **not** re-expose file editing as host tools. Pass only a **narrow,
intentional set** of Agent-Native actions through `createSession.tools` when you
want the harness to reach specific app operations — and keep `defineAction`
auth, request context, timeouts, truncation, and read-only metadata intact when
you do.

`permissionMode` gates what the harness may do without approval:

| Mode          | Meaning                                            |
| ------------- | -------------------------------------------------- |
| `allow-reads` | Default. Reads run; edits and risky actions prompt |
| `allow-edits` | Reads and edits run; other risky actions prompt    |
| `allow-all`   | No approval gating                                 |

When a harness pauses for approval it emits an `approval-request` event and the
session is marked `idle` with the pending approval recorded, so the UI can
surface it and resume on the user's decision. See
[Human Approval](/docs/human-approval) for the approval surface.

## Events {#events}

A harness session streams `AgentHarnessEvent` values, which Agent-Native
translates to the standard `AgentChatEvent` stream with
`agentHarnessEventToAgentChatEvents`. The event union covers `text-delta`,
`thinking-delta`, `activity`, `tool-start`, `tool-done` (which can carry an
`mcpApp` payload for native widgets), `approval-request`, `file-change`,
`compaction`, `usage`, `error`, and `done`. Because tool results flow through the
same translation, action-declared native widgets still render — see
[Native Chat UI](/docs/native-chat-ui).

## Background runs and the UI {#background-runs}

Harness runs project into the shared `BackgroundAgentRun` shape with
`createAgentHarnessBackgroundAgentController()` and are available through the
existing run routes as `goalId=agent-harness`. That means a long-running Claude
Code or Codex session appears in the same background-run and transcript surfaces
as Agent Teams and other adapters, with `listAgentHarnessBackgroundRuns`,
`listAgentHarnessBackgroundTranscriptEvents`, `getAgentHarnessBackgroundRun`, and
`stopAgentHarnessBackgroundRun` available for custom hosts.

## Custom adapters {#custom-adapters}

To wrap a runtime that is not one of the built-ins, implement
`AgentHarnessAdapter` and register it. The adapter declares its capabilities and
creates sessions; a session exposes `streamTurn` and optional `continueTurn`,
`approve`, `detach`, `stop`, and `destroy`.

```ts
import {
  registerAgentHarness,
  type AgentHarnessAdapter,
} from "@agent-native/core/agent/harness";

const myHarness: AgentHarnessAdapter = {
  name: "acme:my-coder",
  label: "Acme Coder",
  description: "Runs the Acme coding agent.",
  installPackage: "@acme/coder",
  capabilities: {
    sandbox: true,
    resumable: true,
    approvals: true,
    hostTools: true,
    fileEvents: true,
  },
  async createSession(opts) {
    // Build your native session and adapt it to AgentHarnessSession.
    return createAcmeSession(opts);
  },
};

registerAgentHarness({
  name: myHarness.name,
  label: myHarness.label,
  description: myHarness.description,
  installPackage: myHarness.installPackage,
  capabilities: myHarness.capabilities,
  create: () => myHarness,
});
```

Keep the runtime package optional with a dynamic import in `createSession` and an
`installPackage` hint. For bridge-backed coding harnesses, require a real
sandbox/workspace provider rather than running an arbitrary coding agent in the
host process — see [Sandbox Adapters](/docs/sandbox-adapters). The AI SDK adapter
(`createAiSdkHarnessAdapter`, backed by `HarnessAgent` from `@ai-sdk/harness`) is
one implementation of this contract, not the public abstraction.

## Don't {#donts}

- Don't add Claude Code, Codex, Cursor, Mastra, or Pi as an `AgentEngine`. They
  own their loop; running one under `AgentEngine.stream()` double-runs the loop
  and loses session lifecycle semantics.
- Don't replay full Agent-Native chat history into a harness each turn. Resume
  the harness session with its `resumeState` instead.
- Don't store `resumeState` in `application_state`. It belongs in the harness
  session SQL table.
- Don't expose every app action to every harness session by default. Hand it a
  small, intentional tool set.

## Related docs {#related-docs}

- [Native Chat UI](/docs/native-chat-ui) — put your own agent behind the chat UI with `AgentChatRuntime`.
- [Agent Surfaces](/docs/agent-surfaces) — choose headless, chat, sidecar, or full-app.
- [Agent-Native Code UI](/docs/code-agents-ui) — the reusable coding workspace surface.
- [Custom Agents & Teams](/docs/agent-teams) — background runs and sub-agent delegation.
- [Sandbox Adapters](/docs/sandbox-adapters) — pluggable execution backends for coding harnesses.
- [Human Approval](/docs/human-approval) — the approval surface harness runs use.
